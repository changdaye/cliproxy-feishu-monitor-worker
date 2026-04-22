import type { MonitorConfig, RuntimeStatus, Summary } from "../types";
import { formatNumberWithCommas } from "./value";

export function buildSummaryText(summary: Summary, baseUrl: string, now = new Date()): string {
  const lines = [
    "状态概览",
    `来源: ${baseUrl}`,
    `时间: ${now.toISOString().replace("T", " ").slice(0, 19)} UTC`,
    "",
    buildSnapshotLine(summary),
    "",
    "汇总",
    `7日免费等效: ${summary.freeEquivalent7D.toFixed(0)}%`,
    `7小时 Token 用量: ${formatNumberWithCommas(summary.tokenUsage.last7Hours)}`,
    `24小时 Token 用量: ${formatNumberWithCommas(summary.tokenUsage.last24Hours)}`,
    `7天 Token 用量: ${formatNumberWithCommas(summary.tokenUsage.last7Days)}`,
    `累计 Token 用量: ${formatNumberWithCommas(summary.tokenUsage.allTime)}`
  ];
  return lines.join("\n");
}

export function buildHeartbeatText(state: RuntimeStatus, intervalHours: number): string {
  const lines = ["健康心跳"];
  if (state.lastSuccessAt) lines.push(`上次成功: ${state.lastSuccessAt}`);
  if (state.lastSummaryAt) lines.push(`上次汇总: ${state.lastSummaryAt}`);
  lines.push(`心跳间隔: ${intervalHours}h`);
  lines.push(`连续失败: ${state.consecutiveFailures}`);
  if (state.lastError) lines.push(`最近错误: ${state.lastError}`);
  return lines.join("\n");
}

export function buildStartupText(config: MonitorConfig): string {
  return [
    "服务启动成功",
    `汇总推送间隔: ${config.summaryIntervalHours}h`,
    `心跳间隔: ${config.heartbeatIntervalHours}h`,
    `启动后立即汇总: ${config.runSummaryOnStartup}`,
    `启动通知: ${config.startupNotificationEnabled}`
  ].join("\n");
}

export function buildFailureAlertText(state: RuntimeStatus, threshold: number, error: string): string {
  return [
    "监控异常提醒",
    `连续失败: ${state.consecutiveFailures}`,
    `失败阈值: ${threshold}`,
    `最近错误: ${error}`,
    `上次成功: ${state.lastSuccessAt ?? "无"}`
  ].join("\n");
}

function buildSnapshotLine(summary: Summary): string {
  const disabled = summary.statusCounts.disabled ? ` | 禁用 ${summary.statusCounts.disabled}` : "";
  const abnormal = (summary.statusCounts.error ?? 0) + (summary.statusCounts.missing ?? 0) > 0
    ? ` | 异常 ${(summary.statusCounts.error ?? 0) + (summary.statusCounts.missing ?? 0)}`
    : "";
  return `账号总数 ${summary.accounts} | 充足 ${summary.statusCounts.full ?? 0} | 高 ${summary.statusCounts.high ?? 0} | 中 ${summary.statusCounts.medium ?? 0} | 低 ${summary.statusCounts.low ?? 0} | 耗尽 ${summary.statusCounts.exhausted ?? 0}${disabled}${abnormal}`;
}
