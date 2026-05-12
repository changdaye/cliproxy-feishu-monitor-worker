import type { MonitorConfig, RuntimeStatus, Summary } from "../types";
import { formatNumberWithCommas } from "./value";
import { getScheduledSummaryLabel } from "./schedule";

export function buildSummaryText(summary: Summary, baseUrl: string, now = new Date()): string {
  const lines = [
    "- 📊 状态概况",
    buildSnapshotLine(summary),
    "- 📈 汇总",
    `- 🧮 7日免费等效: ${summary.freeEquivalent7D.toFixed(0)}%`
  ];
  if (!summary.tokenUsage.available) {
    lines.push("- ⚪ Token 用量: 暂无可用数据");
    return lines.join("\n");
  }
  lines.push(
    `- 🟣 7小时 Token 用量: ${formatNumberWithCommas(summary.tokenUsage.last7Hours)}`,
    `- 🔵 24小时 Token 用量: ${formatNumberWithCommas(summary.tokenUsage.last24Hours)}`,
    `- 🟦 7天 Token 用量: ${formatNumberWithCommas(summary.tokenUsage.last7Days)} | 📚 累计 Token 用量: ${formatNumberWithCommas(summary.tokenUsage.allTime)}`
  );
  return lines.join("\n");
}

export function buildHeartbeatText(state: RuntimeStatus, intervalHours: number): string {
  const parts = ["💓 心跳", `⏱️${intervalHours}h`, `⚠️失败${state.consecutiveFailures}`];
  if (state.lastSuccessAt) parts.push(`✅成功 ${state.lastSuccessAt}`);
  if (state.lastSummaryAt) parts.push(`📨汇总 ${state.lastSummaryAt}`);
  if (state.lastError) parts.push(`🧯${state.lastError}`);
  return parts.join(" | ");
}

export function buildStartupText(config: MonitorConfig): string {
  return `🚀 启动成功 | 📅${getScheduledSummaryLabel()} | ⏱️${config.heartbeatIntervalHours}h | ▶️立即汇总 ${config.runSummaryOnStartup}`;
}

export function buildFailureAlertText(state: RuntimeStatus, threshold: number, error: string): string {
  return `🚨 异常 | ⚠️连续失败${state.consecutiveFailures} | 🧱阈值${threshold} | ✅上次成功 ${state.lastSuccessAt ?? "无"}\n🧯 ${error}`;
}

function buildSnapshotLine(summary: Summary): string {
  const available = (summary.statusCounts.full ?? 0)
    + (summary.statusCounts.high ?? 0)
    + (summary.statusCounts.medium ?? 0)
    + (summary.statusCounts.low ?? 0)
    + (summary.statusCounts.exhausted ?? 0);
  const abnormalCount = (summary.statusCounts.error ?? 0) + (summary.statusCounts.missing ?? 0) + (summary.statusCounts.unavailable ?? 0);
  const abnormal = abnormalCount > 0
    ? ` | 🚨 异常 ${abnormalCount}`
    : "";
  const disabledText = summary.statusCounts.disabled ? ` | ⚫️ 禁用 ${summary.statusCounts.disabled}` : "";
  return `- 📦 账号总数 ${summary.accounts} | 🟢 可用 ${available} | 🟩 充足 ${summary.statusCounts.full ?? 0} | 🟦 高 ${summary.statusCounts.high ?? 0} | 🟨 中 ${summary.statusCounts.medium ?? 0} | 🟧 低 ${summary.statusCounts.low ?? 0} | 🟥 耗尽 ${summary.statusCounts.exhausted ?? 0}${disabledText}${abnormal}`;
}
