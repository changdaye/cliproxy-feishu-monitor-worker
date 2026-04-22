import { cleanString, clampFloat, firstValue, numberFromAny, boolFromAny } from "./value";
import type { QuotaReport, QuotaWindow, Summary, TokenUsageResult, TokenUsageSummary } from "../types";

const WINDOW_5H_SECONDS = 5 * 60 * 60;
const WINDOW_7D_SECONDS = 7 * 24 * 60 * 60;

function firstMap(source: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = source[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return undefined;
}

function buildWindow(id: string, label: string, window?: Record<string, unknown>, limitReached?: unknown, allowed?: unknown): QuotaWindow | undefined {
  if (!window) return undefined;
  const used = firstValue(window.used_percent, window.usedPercent);
  const usedPercent = used == null ? ((boolFromAny(limitReached) || allowed === false) && formatResetLabel(window) !== "-" ? 100 : undefined) : clampFloat(numberFromAny(used), 0, 100);
  const remainingPercent = usedPercent == null ? undefined : clampFloat(100 - usedPercent, 0, 100);
  return {
    id,
    label,
    usedPercent,
    remainingPercent,
    resetLabel: formatResetLabel(window),
    exhausted: (usedPercent ?? 0) >= 100
  };
}

function formatResetLabel(window: Record<string, unknown>): string {
  const resetAt = numberFromAny(firstValue(window.reset_at, window.resetAt));
  if (resetAt > 0) {
    return new Date(resetAt * 1000).toISOString().slice(5, 16).replace("T", " ");
  }
  const afterSeconds = numberFromAny(firstValue(window.reset_after_seconds, window.resetAfterSeconds));
  if (afterSeconds > 0) {
    return new Date(Date.now() + afterSeconds * 1000).toISOString().slice(5, 16).replace("T", " ");
  }
  return "-";
}

function findQuotaWindows(rateLimit?: Record<string, unknown>) {
  if (!rateLimit) return { fiveHour: undefined, weekly: undefined };
  const primary = firstMap(rateLimit, "primary_window", "primaryWindow");
  const secondary = firstMap(rateLimit, "secondary_window", "secondaryWindow");
  const candidates = [primary, secondary].filter(Boolean) as Record<string, unknown>[];
  let fiveHour = candidates.find((entry) => numberFromAny(firstValue(entry.limit_window_seconds, entry.limitWindowSeconds)) === WINDOW_5H_SECONDS);
  let weekly = candidates.find((entry) => numberFromAny(firstValue(entry.limit_window_seconds, entry.limitWindowSeconds)) === WINDOW_7D_SECONDS);
  if (!fiveHour) fiveHour = primary;
  if (!weekly) weekly = secondary;
  return { fiveHour, weekly };
}

export function parseQuotaWindows(payload: Record<string, unknown>): { windows: QuotaWindow[]; additionalWindows: QuotaWindow[] } {
  const rateLimit = firstMap(payload, "rate_limit", "rateLimit");
  const { fiveHour, weekly } = findQuotaWindows(rateLimit);
  const limitReached = rateLimit ? firstValue(rateLimit.limit_reached, rateLimit.limitReached) : undefined;
  const allowed = rateLimit?.allowed;
  const windows = [
    buildWindow("code-5h", "Code 5h", fiveHour, limitReached, allowed),
    buildWindow("code-7d", "Code 7d", weekly, limitReached, allowed)
  ].filter(Boolean) as QuotaWindow[];

  const rawAdditional = firstValue<unknown[]>(payload.additional_rate_limits, payload.additionalRateLimits) ?? [];
  const additionalWindows: QuotaWindow[] = [];
  rawAdditional.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const item = entry as Record<string, unknown>;
    const subRate = firstMap(item, "rate_limit", "rateLimit");
    if (!subRate) return;
    const name = cleanString(firstValue(item.limit_name, item.limitName, item.metered_feature, item.meteredFeature)) || `additional-${index + 1}`;
    const primary = buildWindow(`${name}-primary`, `${name} 5h`, firstMap(subRate, "primary_window", "primaryWindow"), firstValue(subRate.limit_reached, subRate.limitReached), subRate.allowed);
    const secondary = buildWindow(`${name}-secondary`, `${name} 7d`, firstMap(subRate, "secondary_window", "secondaryWindow"), firstValue(subRate.limit_reached, subRate.limitReached), subRate.allowed);
    if (primary) additionalWindows.push(primary);
    if (secondary) additionalWindows.push(secondary);
  });

  return { windows, additionalWindows };
}

export function deriveStatus(report: QuotaReport): string {
  if (report.disabled) return "disabled";
  if (report.error) return "error";
  if (!report.authIndex || !report.accountId) return "missing";
  const window7d = report.windows.find((window) => window.id === "code-7d");
  const remaining = window7d?.remainingPercent;
  if (remaining == null) return "unknown";
  if (remaining <= 0) return "exhausted";
  if (remaining <= 30) return "low";
  if (remaining <= 70) return "medium";
  if (remaining < 100) return "high";
  return "full";
}

function parseTimestamp(input: unknown): Date | undefined {
  const text = cleanString(input);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function tokenTotalFromDetail(detail: Record<string, unknown>): number {
  const tokens = detail.tokens && typeof detail.tokens === "object" && !Array.isArray(detail.tokens)
    ? detail.tokens as Record<string, unknown>
    : detail;
  const input = numberFromAny(firstValue(tokens.input_tokens, tokens.inputTokens, tokens.prompt_tokens, tokens.promptTokens));
  const output = numberFromAny(firstValue(tokens.output_tokens, tokens.outputTokens, tokens.completion_tokens, tokens.completionTokens));
  const reasoning = numberFromAny(firstValue(tokens.reasoning_tokens, tokens.reasoningTokens));
  const total = numberFromAny(firstValue(tokens.total_tokens, tokens.totalTokens));
  return total > 0 ? total : input + output + reasoning;
}

export function parseTokenUsageByAuth(payload: Record<string, unknown>, now = new Date()): TokenUsageResult {
  const usage = payload.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return { byAuth: {}, complete7Hours: false, complete24Hours: false, complete7Days: false };
  }
  const apis = (usage as Record<string, unknown>).apis;
  if (!apis || typeof apis !== "object" || Array.isArray(apis)) {
    return { byAuth: {}, complete7Hours: false, complete24Hours: false, complete7Days: false };
  }
  const byAuth: Record<string, TokenUsageSummary> = {};
  let historyStart: Date | undefined;
  let historyEnd: Date | undefined;
  const last7Hours = new Date(now.getTime() - 7 * 60 * 60 * 1000);
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  for (const apiValue of Object.values(apis as Record<string, unknown>)) {
    if (!apiValue || typeof apiValue !== "object" || Array.isArray(apiValue)) continue;
    const models = (apiValue as Record<string, unknown>).models;
    if (!models || typeof models !== "object" || Array.isArray(models)) continue;
    for (const modelValue of Object.values(models as Record<string, unknown>)) {
      if (!modelValue || typeof modelValue !== "object" || Array.isArray(modelValue)) continue;
      const details = ((modelValue as Record<string, unknown>).details ?? []) as unknown[];
      for (const detailValue of details) {
        if (!detailValue || typeof detailValue !== "object" || Array.isArray(detailValue)) continue;
        const detail = detailValue as Record<string, unknown>;
        const authIndex = cleanString(firstValue(detail.auth_index, detail.authIndex));
        const timestamp = parseTimestamp(detail.timestamp);
        if (!authIndex || !timestamp) continue;
        historyStart = !historyStart || timestamp < historyStart ? timestamp : historyStart;
        historyEnd = !historyEnd || timestamp > historyEnd ? timestamp : historyEnd;
        const total = tokenTotalFromDetail(detail);
        const current = byAuth[authIndex] ?? {
          available: true,
          allTime: 0,
          last7Hours: 0,
          last24Hours: 0,
          last7Days: 0,
          complete7Hours: false,
          complete24Hours: false,
          complete7Days: false
        };
        current.allTime += total;
        if (timestamp >= last7Hours) current.last7Hours += total;
        if (timestamp >= last24Hours) current.last24Hours += total;
        if (timestamp >= last7Days) current.last7Days += total;
        byAuth[authIndex] = current;
      }
    }
  }

  const result: TokenUsageResult = {
    byAuth,
    historyStart: historyStart?.toISOString(),
    historyEnd: historyEnd?.toISOString(),
    complete7Hours: !!historyStart && historyStart <= last7Hours,
    complete24Hours: !!historyStart && historyStart <= last24Hours,
    complete7Days: !!historyStart && historyStart <= last7Days
  };

  Object.values(byAuth).forEach((value) => {
    value.historyStart = result.historyStart;
    value.historyEnd = result.historyEnd;
    value.complete7Hours = result.complete7Hours;
    value.complete24Hours = result.complete24Hours;
    value.complete7Days = result.complete7Days;
  });

  return result;
}

export function summarizeReports(reports: QuotaReport[], tokenUsage: TokenUsageResult): Summary {
  const summary: Summary = {
    accounts: reports.length,
    statusCounts: {},
    planCounts: {},
    freeEquivalent7D: 0,
    plusEquivalent7D: 0,
    tokenUsage: {
      available: false,
      allTime: 0,
      last7Hours: 0,
      last24Hours: 0,
      last7Days: 0,
      historyStart: tokenUsage.historyStart,
      historyEnd: tokenUsage.historyEnd,
      complete7Hours: tokenUsage.complete7Hours,
      complete24Hours: tokenUsage.complete24Hours,
      complete7Days: tokenUsage.complete7Days
    }
  };

  for (const report of reports) {
    summary.statusCounts[report.status] = (summary.statusCounts[report.status] ?? 0) + 1;
    const plan = report.planType || "unknown";
    summary.planCounts[plan] = (summary.planCounts[plan] ?? 0) + 1;
    const window7d = report.windows.find((window) => window.id === "code-7d");
    if (window7d?.remainingPercent != null) {
      if (report.planType.toLowerCase() === "free") summary.freeEquivalent7D += window7d.remainingPercent;
      if (report.planType.toLowerCase() === "plus") summary.plusEquivalent7D += window7d.remainingPercent;
    }
    const usage = tokenUsage.byAuth[report.authIndex];
    if (usage) {
      summary.tokenUsage.available = true;
      summary.tokenUsage.allTime += usage.allTime;
      summary.tokenUsage.last7Hours += usage.last7Hours;
      summary.tokenUsage.last24Hours += usage.last24Hours;
      summary.tokenUsage.last7Days += usage.last7Days;
    }
  }

  return summary;
}
