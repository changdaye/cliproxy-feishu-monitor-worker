import { parseConfig } from "./config";
import { chunkItems } from "./lib/chunk";
import { buildFailureAlertText, buildHeartbeatText, buildStartupText, buildSummaryText } from "./lib/message";
import { parseTokenUsageByAuth, summarizeReports } from "./lib/quota";
import { authorizeAdminRequest } from "./lib/admin";
import { getRuntimeStatus, setRuntimeStatus, getIncompleteRun, createRun, createChunks, markRunRunning, countChunkStatuses, listReportsForRun, finalizeRun, markChunkRunning, replaceQuotaReports, markChunkCompleted, markChunkFailed, markRunFailed } from "./db";
import { CliProxyClient } from "./services/cliproxy";
import { pushToFeishu } from "./services/feishu";
import type { Env, MonitorChunkMessage } from "./types";

function isoNow(now = new Date()): string {
  return now.toISOString();
}

function shouldSendByInterval(last: string | undefined, hours: number, now = new Date()): boolean {
  if (!last) return true;
  const previous = new Date(last);
  if (Number.isNaN(previous.getTime())) return true;
  return now.getTime() >= previous.getTime() + hours * 60 * 60 * 1000;
}

async function maybeFinalizeRun(env: Env, now = new Date()): Promise<{ handled: boolean; state: string; runId?: string }> {
  const run = await getIncompleteRun(env.MONITOR_DB);
  if (!run) return { handled: false, state: "idle" };
  const counts = await countChunkStatuses(env.MONITOR_DB, run.id);
  if ((counts.pending ?? 0) > 0 || (counts.queued ?? 0) > 0 || (counts.running ?? 0) > 0) {
    return { handled: true, state: "waiting_for_chunks", runId: run.id };
  }
  if ((counts.failed ?? 0) > 0) {
    await markRunFailed(env.MONITOR_DB, run.id, "one or more chunks failed", now);
    return { handled: true, state: "run_failed", runId: run.id };
  }
  const reports = await listReportsForRun(env.MONITOR_DB, run.id);
  const usagePayload = run.usagePayloadJson ? JSON.parse(run.usagePayloadJson) as Record<string, unknown> : {};
  const tokenUsage = parseTokenUsageByAuth(usagePayload, now);
  const summary = summarizeReports(reports, tokenUsage);
  const config = parseConfig(env);
  const message = buildSummaryText(summary, config.baseUrl, now);
  await pushToFeishu(config, message);
  await finalizeRun(env.MONITOR_DB, run.id, summary, message, now);
  const runtime = await getRuntimeStatus(env.MONITOR_DB);
  runtime.lastSummaryAt = isoNow(now);
  runtime.lastSuccessAt = runtime.lastSummaryAt;
  runtime.lastError = undefined;
  runtime.consecutiveFailures = 0;
  await setRuntimeStatus(env.MONITOR_DB, runtime, now);
  return { handled: true, state: "finalized", runId: run.id };
}

async function maybeSendStartup(env: Env, now = new Date()): Promise<boolean> {
  const config = parseConfig(env);
  if (!config.startupNotificationEnabled) return false;
  const runtime = await getRuntimeStatus(env.MONITOR_DB);
  if (runtime.startupNotifiedAt) return false;
  await pushToFeishu(config, buildStartupText(config));
  runtime.startupNotifiedAt = isoNow(now);
  await setRuntimeStatus(env.MONITOR_DB, runtime, now);
  return true;
}

async function maybeSendHeartbeat(env: Env, now = new Date()): Promise<boolean> {
  const config = parseConfig(env);
  const runtime = await getRuntimeStatus(env.MONITOR_DB);
  if (!shouldSendByInterval(runtime.lastHeartbeatAt, config.heartbeatIntervalHours, now)) return false;
  await pushToFeishu(config, buildHeartbeatText(runtime, config.heartbeatIntervalHours));
  runtime.lastHeartbeatAt = isoNow(now);
  await setRuntimeStatus(env.MONITOR_DB, runtime, now);
  return true;
}

async function startRun(env: Env, client: CliProxyClient, triggerType: string, now = new Date(), force = false): Promise<{ started: boolean; runId?: string; authCount?: number; chunkCount?: number }> {
  const config = parseConfig(env);
  const runtime = await getRuntimeStatus(env.MONITOR_DB);
  if (!force && !shouldSendByInterval(runtime.lastSummaryAt, config.summaryIntervalHours, now) && !(config.runSummaryOnStartup && !runtime.lastSummaryAt)) {
    return { started: false };
  }
  const auths = await client.loadCodexAuths();
  const usagePayload = await client.fetchUsagePayload();
  const chunks = chunkItems(auths, config.chunkSize);
  const runId = crypto.randomUUID();
  const messages: MonitorChunkMessage[] = chunks.map((chunk, index) => ({
    runId,
    chunkId: crypto.randomUUID(),
    chunkIndex: index,
    baseUrl: config.baseUrl,
    accountItems: chunk,
    scheduledAt: isoNow(now)
  }));

  await createRun(env.MONITOR_DB, {
    id: runId,
    triggerType,
    authCount: auths.length,
    chunkCount: messages.length,
    usagePayloadJson: JSON.stringify(usagePayload),
    now
  });
  await createChunks(env.MONITOR_DB, runId, messages, now);
  for (const message of messages) {
    await env.MONITOR_QUEUE.send(message);
  }
  await markRunRunning(env.MONITOR_DB, runId);
  return { started: true, runId, authCount: auths.length, chunkCount: messages.length };
}

async function handleFailure(env: Env, error: unknown, now = new Date()): Promise<void> {
  const config = parseConfig(env);
  const runtime = await getRuntimeStatus(env.MONITOR_DB);
  runtime.consecutiveFailures += 1;
  runtime.lastFailureAt = isoNow(now);
  runtime.lastError = error instanceof Error ? error.message : String(error);
  await setRuntimeStatus(env.MONITOR_DB, runtime, now);
  if (runtime.consecutiveFailures >= config.failureAlertThreshold) {
    await pushToFeishu(config, buildFailureAlertText(runtime, config.failureAlertThreshold, runtime.lastError));
  }
}

async function processChunkMessage(env: Env, message: MonitorChunkMessage, now = new Date()): Promise<void> {
  const client = new CliProxyClient(parseConfig(env));
  await markChunkRunning(env.MONITOR_DB, message.chunkId, now);
  try {
    const reports = [];
    for (const item of message.accountItems) {
      reports.push(await client.queryQuota(item));
    }
    await replaceQuotaReports(env.MONITOR_DB, message.runId, message.chunkId, reports, now);
    await markChunkCompleted(env.MONITOR_DB, message.chunkId, now);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    await markChunkFailed(env.MONITOR_DB, message.chunkId, text, now);
    throw error;
  }
}

async function runTick(env: Env, options: { forceStart: boolean; includeStartup: boolean; includeHeartbeat: boolean; triggerType: string }, now = new Date()) {
  const client = new CliProxyClient(parseConfig(env));
  const result = {
    startupSent: false,
    heartbeatSent: false,
    action: "noop",
    runId: undefined as string | undefined,
    authCount: undefined as number | undefined,
    chunkCount: undefined as number | undefined
  };

  if (options.includeStartup) {
    result.startupSent = await maybeSendStartup(env, now);
  }
  if (options.includeHeartbeat) {
    result.heartbeatSent = await maybeSendHeartbeat(env, now);
  }

  const finalized = await maybeFinalizeRun(env, now);
  if (finalized.handled) {
    result.action = finalized.state;
    result.runId = finalized.runId;
    return result;
  }

  const started = await startRun(env, client, options.triggerType, now, options.forceStart);
  if (started.started) {
    result.action = "started";
    result.runId = started.runId;
    result.authCount = started.authCount;
    result.chunkCount = started.chunkCount;
    return result;
  }

  return result;
}

function jsonError(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      const runtime = await getRuntimeStatus(env.MONITOR_DB);
      return Response.json({ ok: true, runtime });
    }

    if (request.method === "POST" && url.pathname === "/admin/tick") {
      const auth = authorizeAdminRequest(request, parseConfig(env).manualTriggerToken);
      if (!auth.ok) {
        return jsonError(auth.status, auth.error ?? "unauthorized");
      }
      try {
        const result = await runTick(env, {
          forceStart: true,
          includeStartup: false,
          includeHeartbeat: false,
          triggerType: "manual"
        });
        return Response.json({ ok: true, ...result });
      } catch (error) {
        await handleFailure(env, error);
        return jsonError(500, error instanceof Error ? error.message : String(error));
      }
    }

    return jsonError(404, "not found");
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      await runTick(env, {
        forceStart: false,
        includeStartup: true,
        includeHeartbeat: true,
        triggerType: "scheduled"
      });
    } catch (error) {
      await handleFailure(env, error);
      throw error;
    }
  },

  async queue(batch: MessageBatch<MonitorChunkMessage>, env: Env, _ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processChunkMessage(env, message.body);
        message.ack();
      } catch {
        message.retry();
      }
    }
  }
};
