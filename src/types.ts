export interface Env {
  MONITOR_DB: D1Database;
  MONITOR_QUEUE: Queue<MonitorChunkMessage>;
  CPA_BASE_URL: string;
  CPA_MANAGEMENT_KEY: string;
  FEISHU_WEBHOOK: string;
  FEISHU_SECRET?: string;
  CHUNK_SIZE?: string;
  REQUEST_TIMEOUT_MS?: string;
  FAILURE_ALERT_THRESHOLD?: string;
  HEARTBEAT_INTERVAL_HOURS?: string;
  SUMMARY_INTERVAL_HOURS?: string;
  STARTUP_NOTIFICATION_ENABLED?: string;
  RUN_SUMMARY_ON_STARTUP?: string;
}

export interface MonitorConfig {
  baseUrl: string;
  managementKey: string;
  feishuWebhook: string;
  feishuSecret: string;
  chunkSize: number;
  requestTimeoutMs: number;
  failureAlertThreshold: number;
  heartbeatIntervalHours: number;
  summaryIntervalHours: number;
  startupNotificationEnabled: boolean;
  runSummaryOnStartup: boolean;
}

export interface AuthItem {
  authIndex: string;
  accountId: string;
  name: string;
  disabled: boolean;
  planType: string;
}

export interface MonitorChunkMessage {
  runId: string;
  chunkId: string;
  chunkIndex: number;
  baseUrl: string;
  accountItems: AuthItem[];
  scheduledAt: string;
}

export interface QuotaWindow {
  id: string;
  label: string;
  usedPercent?: number;
  remainingPercent?: number;
  resetLabel: string;
  exhausted: boolean;
}

export interface QuotaReport {
  name: string;
  authIndex: string;
  accountId: string;
  planType: string;
  disabled: boolean;
  status: string;
  windows: QuotaWindow[];
  additionalWindows: QuotaWindow[];
  error: string;
}

export interface TokenUsageSummary {
  available: boolean;
  allTime: number;
  last7Hours: number;
  last24Hours: number;
  last7Days: number;
  historyStart?: string;
  historyEnd?: string;
  complete7Hours: boolean;
  complete24Hours: boolean;
  complete7Days: boolean;
}

export interface Summary {
  accounts: number;
  statusCounts: Record<string, number>;
  planCounts: Record<string, number>;
  freeEquivalent7D: number;
  plusEquivalent7D: number;
  tokenUsage: TokenUsageSummary;
}

export interface TokenUsageResult {
  byAuth: Record<string, TokenUsageSummary>;
  historyStart?: string;
  historyEnd?: string;
  complete7Hours: boolean;
  complete24Hours: boolean;
  complete7Days: boolean;
}

export interface MonitorRunRecord {
  id: string;
  status: string;
  triggerType: string;
  startedAt: string;
  finishedAt?: string;
  authCount: number;
  chunkCount: number;
  usagePayloadJson?: string;
  summaryJson?: string;
  feishuMessageText?: string;
  errorMessage?: string;
}

export interface RuntimeStatus {
  lastSummaryAt?: string;
  lastHeartbeatAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  consecutiveFailures: number;
  startupNotifiedAt?: string;
}
