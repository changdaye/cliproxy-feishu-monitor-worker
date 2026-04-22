import type { Env, MonitorConfig } from "./types";
import { normalizeBaseUrl, toBoolean, toInt } from "./lib/value";

export function parseConfig(env: Env): MonitorConfig {
  if (!env.CPA_BASE_URL) throw new Error("missing CPA_BASE_URL");
  if (!env.CPA_MANAGEMENT_KEY) throw new Error("missing CPA_MANAGEMENT_KEY");
  if (!env.FEISHU_WEBHOOK) throw new Error("missing FEISHU_WEBHOOK");
  return {
    baseUrl: normalizeBaseUrl(env.CPA_BASE_URL),
    managementKey: env.CPA_MANAGEMENT_KEY.trim(),
    feishuWebhook: env.FEISHU_WEBHOOK.trim(),
    feishuSecret: env.FEISHU_SECRET?.trim() ?? "",
    chunkSize: toInt(env.CHUNK_SIZE, 20, 1),
    requestTimeoutMs: toInt(env.REQUEST_TIMEOUT_MS, 30_000, 1),
    failureAlertThreshold: toInt(env.FAILURE_ALERT_THRESHOLD, 3, 1),
    heartbeatIntervalHours: toInt(env.HEARTBEAT_INTERVAL_HOURS, 3, 1),
    summaryIntervalHours: toInt(env.SUMMARY_INTERVAL_HOURS, 6, 1),
    startupNotificationEnabled: toBoolean(env.STARTUP_NOTIFICATION_ENABLED, true),
    runSummaryOnStartup: toBoolean(env.RUN_SUMMARY_ON_STARTUP, true)
  };
}
