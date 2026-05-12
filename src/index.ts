import { parseConfig } from "./config";
import { chunkItems } from "./lib/chunk";
import { buildFailureAlertText, buildHeartbeatText, buildStartupText, buildSummaryText } from "./lib/message";
import { getRunSettlementAction, shouldRetryChunk } from "./lib/run-settlement";
import { shouldStartScheduledSummaryRun } from "./lib/schedule";
import { parseStoredTokenUsage, parseTokenUsageByAuth, parseUsageQueueRecords, summarizeReports, summarizeUsageRecords } from "./lib/quota";
import { authorizeAdminRequest } from "./lib/admin";
import { getRuntimeStatus, setRuntimeStatus, getIncompleteRun, getRunById, createRun, createChunks, markRunRunning, markRunAggregatingIfRunning, countChunkStatuses, listReportsForRun, finalizeRun, markChunkRunning, markChunkQueuedForRetry, replaceQuotaReports, markChunkCompleted, markChunkFailed, markRunFailed, insertUsageRecords, listUsageRecords } from "./db";
import { CliProxyClient, ManagementApiError } from "./services/cliproxy";
import { pushToFeishu, isRateLimitError } from "./services/feishu";
import type { Env, MonitorChunkMessage } from "./types";

const CHUNK_MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isoNow(now = new Date()): string {
  return now.toISOString();
}

function shouldSendByInterval(last: string | undefined, hours: number, now = new Date()): boolean {
  if (!last) return true;
  const previous = new Date(last);
  if (Number.isNaN(previous.getTime())) return true;
  return now.getTime() >= previous.getTime() + hours * 60 * 60 * 1000;
}

async function finalizeRunRecord(env: Env, runId: string, outcome: "finalize" | "fail", now = new Date()): Promise<{ handled: boolean; state: string; runId?: string }> {
  const run = await getRunById(env.MONITOR_DB, runId);
  if (!run) return { handled: false, state: "idle" };
  if (outcome === "fail") {
    await markRunFailed(env.MONITOR_DB, run.id, "one or more chunks failed", now);
    return { handled: true, state: "run_failed", runId: run.id };
  }
  const reports = await listReportsForRun(env.MONITOR_DB, run.id);
  const tokenUsage = parseStoredTokenUsage(run.usagePayloadJson, now);
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

async function maybeSettleRun(env: Env, runId: string, now = new Date()): Promise<{ handled: boolean; state: string; runId?: string }> {
  const run = await getRunById(env.MONITOR_DB, runId);
  if (!run) return { handled: false, state: "idle" };
  const counts = await countChunkStatuses(env.MONITOR_DB, run.id);
  const outcome = getRunSettlementAction(counts);
  if (outcome === "wait") {
    return { handled: true, state: "waiting_for_chunks", runId: run.id };
  }
  if (run.status !== "aggregating") {
    const locked = await markRunAggregatingIfRunning(env.MONITOR_DB, run.id);
    if (!locked) {
      return { handled: true, state: "waiting_for_settlement", runId: run.id };
    }
  }
  return finalizeRunRecord(env, run.id, outcome, now);
}

async function maybeFinalizeRun(env: Env, now = new Date()): Promise<{ handled: boolean; state: string; runId?: string }> {
  const run = await getIncompleteRun(env.MONITOR_DB);
  if (!run) return { handled: false, state: "idle" };
  return maybeSettleRun(env, run.id, now);
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

async function syncPersistedTokenUsage(env: Env, client: CliProxyClient, now = new Date()): Promise<void> {
  try {
    const usageRecords = parseUsageQueueRecords(await client.fetchUsageQueueRecords());
    await insertUsageRecords(env.MONITOR_DB, usageRecords, now);
    return;
  } catch (queueError) {
    if (queueError instanceof ManagementApiError && queueError.kind === "html") {
      throw queueError;
    }
  }
}

async function currentTokenUsage(env: Env, client: CliProxyClient, now = new Date()) {
  const persisted = summarizeUsageRecords(await listUsageRecords(env.MONITOR_DB), now);
  if (Object.keys(persisted.byAuth).length > 0) {
    return persisted;
  }

  try {
    const usagePayload = await client.fetchUsagePayload();
    return parseTokenUsageByAuth(usagePayload, now);
  } catch (legacyError) {
    if (legacyError instanceof ManagementApiError && legacyError.kind === "html") {
      throw legacyError;
    }
  }
  return persisted;
}

async function startRun(env: Env, client: CliProxyClient, triggerType: string, now = new Date(), force = false): Promise<{ started: boolean; runId?: string; authCount?: number; chunkCount?: number }> {
  const config = parseConfig(env);
  const runtime = await getRuntimeStatus(env.MONITOR_DB);
  if (!force && !shouldStartScheduledSummaryRun(runtime.lastSummaryAt, now) && !(config.runSummaryOnStartup && !runtime.lastSummaryAt)) {
    return { started: false };
  }
  const auths = await client.loadCodexAuths();
  const tokenUsage = await currentTokenUsage(env, client, now);
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
    usagePayloadJson: JSON.stringify(tokenUsage),
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
  if (runtime.consecutiveFailures >= config.failureAlertThreshold && !isRateLimitError(error)) {
    await pushToFeishu(config, buildFailureAlertText(runtime, config.failureAlertThreshold, runtime.lastError));
  }
}

async function processChunkMessage(env: Env, message: MonitorChunkMessage, now = new Date()): Promise<void> {
  const client = new CliProxyClient(parseConfig(env));
  await markChunkRunning(env.MONITOR_DB, message.chunkId, now);
  const reports = [];
  for (const item of message.accountItems) {
    reports.push(await client.queryQuota(item));
  }
  await replaceQuotaReports(env.MONITOR_DB, message.runId, message.chunkId, reports, now);
  await markChunkCompleted(env.MONITOR_DB, message.chunkId, now);
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
    if (result.startupSent) await sleep(1500);
  }
  if (options.includeHeartbeat) {
    result.heartbeatSent = await maybeSendHeartbeat(env, now);
    if (result.heartbeatSent) await sleep(1500);
  }

  await syncPersistedTokenUsage(env, client, now);

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
        await maybeSettleRun(env, message.body.runId);
        message.ack();
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (shouldRetryChunk(message.attempts, CHUNK_MAX_RETRIES)) {
          await markChunkQueuedForRetry(env.MONITOR_DB, message.body.chunkId, text);
          message.retry();
          continue;
        }
        await markChunkFailed(env.MONITOR_DB, message.body.chunkId, text);
        await maybeSettleRun(env, message.body.runId);
        message.ack();
      }
    }
  }
};
