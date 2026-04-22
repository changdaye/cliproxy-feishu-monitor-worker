import { parseConfig } from "./config";
import { chunkItems } from "./lib/chunk";
import { buildFailureAlertText, buildHeartbeatText, buildStartupText, buildSummaryText } from "./lib/message";
import { parseTokenUsageByAuth, summarizeReports } from "./lib/quota";
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

async function maybeFinalizeRun(env: Env, client: CliProxyClient, now = new Date()): Promise<boolean> {
  const run = await getIncompleteRun(env.MONITOR_DB);
  if (!run) return false;
  const counts = await countChunkStatuses(env.MONITOR_DB, run.id);
  if ((counts.pending ?? 0) > 0 || (counts.queued ?? 0) > 0 || (counts.running ?? 0) > 0) {
    return true;
  }
  if ((counts.failed ?? 0) > 0) {
    await markRunFailed(env.MONITOR_DB, run.id, "one or more chunks failed", now);
    return true;
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
  return true;
}

async function maybeSendStartup(env: Env, now = new Date()): Promise<void> {
  const config = parseConfig(env);
  if (!config.startupNotificationEnabled) return;
  const runtime = await getRuntimeStatus(env.MONITOR_DB);
  if (runtime.startupNotifiedAt) return;
  await pushToFeishu(config, buildStartupText(config));
  runtime.startupNotifiedAt = isoNow(now);
  await setRuntimeStatus(env.MONITOR_DB, runtime, now);
}

async function maybeSendHeartbeat(env: Env, now = new Date()): Promise<void> {
  const config = parseConfig(env);
  const runtime = await getRuntimeStatus(env.MONITOR_DB);
  if (!shouldSendByInterval(runtime.lastHeartbeatAt, config.heartbeatIntervalHours, now)) return;
  await pushToFeishu(config, buildHeartbeatText(runtime, config.heartbeatIntervalHours));
  runtime.lastHeartbeatAt = isoNow(now);
  await setRuntimeStatus(env.MONITOR_DB, runtime, now);
}

async function startRun(env: Env, client: CliProxyClient, triggerType: string, now = new Date()): Promise<void> {
  const config = parseConfig(env);
  const runtime = await getRuntimeStatus(env.MONITOR_DB);
  if (!shouldSendByInterval(runtime.lastSummaryAt, config.summaryIntervalHours, now) && !(config.runSummaryOnStartup && !runtime.lastSummaryAt)) {
    return;
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

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    const runtime = await getRuntimeStatus(env.MONITOR_DB);
    return Response.json({ ok: true, runtime });
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const client = new CliProxyClient(parseConfig(env));
    const now = new Date();
    try {
      await maybeSendStartup(env, now);
      await maybeSendHeartbeat(env, now);
      const hasActiveRun = await maybeFinalizeRun(env, client, now);
      if (!hasActiveRun) {
        await startRun(env, client, "scheduled", now);
      }
    } catch (error) {
      await handleFailure(env, error, now);
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
