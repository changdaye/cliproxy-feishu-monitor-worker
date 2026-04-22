import { parseQuotaWindows, deriveStatus } from "../lib/quota";
import { cleanString, firstValue } from "../lib/value";
import type { AuthItem, MonitorConfig, QuotaReport } from "../types";

const WHAM_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const WHAM_HEADERS = {
  Authorization: "Bearer $TOKEN$",
  "Content-Type": "application/json",
  "User-Agent": "codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal"
};

function decodeBase64Url(value: string): string {
  const normalized = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=").replace(/-/g, "+").replace(/_/g, "/");
  return atob(normalized);
}

function parseJwtLike(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  const text = cleanString(value);
  if (!text) return undefined;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const parts = text.split(".");
    if (parts.length < 2) return undefined;
    try {
      return JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
}

function nestedObject(source: Record<string, unknown>, ...keys: string[]): unknown {
  let current: unknown = source;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function parseAccountId(entry: Record<string, unknown>): string {
  const candidates = [
    nestedObject(entry, "id_token", "chatgpt_account_id"),
    nestedObject(entry, "id_token", "https://api.openai.com/auth"),
    entry.id_token,
    nestedObject(entry, "metadata", "id_token")
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const id = cleanString((candidate as Record<string, unknown>).chatgpt_account_id);
      if (id) return id;
    }
    const payload = parseJwtLike(candidate);
    if (!payload) continue;
    const id = cleanString(payload.chatgpt_account_id);
    if (id) return id;
    const authInfo = payload["https://api.openai.com/auth"];
    if (authInfo && typeof authInfo === "object" && !Array.isArray(authInfo)) {
      const nestedId = cleanString((authInfo as Record<string, unknown>).chatgpt_account_id);
      if (nestedId) return nestedId;
    }
  }
  return "";
}

function parsePlanType(entry: Record<string, unknown>): string {
  return cleanString(
    firstValue(
      nestedObject(entry, "id_token", "plan_type"),
      entry.plan_type,
      entry.planType,
      nestedObject(entry, "metadata", "plan_type"),
      entry.account_type,
      entry.accountType
    )
  ).toLowerCase();
}

function isAuthDisabled(entry: Record<string, unknown>): boolean {
  return Boolean(entry.disabled) || cleanString(entry.status).toLowerCase() === "disabled";
}

function authName(entry: Record<string, unknown>): string {
  return cleanString(firstValue(entry.email, entry.account, entry.label, entry.name, entry.id)) || "unknown";
}

export function mapAuthEntry(entry: Record<string, unknown>): AuthItem {
  return {
    authIndex: cleanString(firstValue(entry.auth_index, entry.authIndex)),
    accountId: parseAccountId(entry),
    name: authName(entry),
    disabled: isAuthDisabled(entry),
    planType: parsePlanType(entry)
  };
}

export class CliProxyClient {
  constructor(private readonly config: MonitorConfig) {}

  async loadCodexAuths(): Promise<AuthItem[]> {
    const payload = await this.fetchJson(`${this.config.baseUrl}/v0/management/auth-files`);
    const files = Array.isArray(payload.files) ? payload.files : [];
    return files
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => item as Record<string, unknown>)
      .filter((entry) => cleanString(firstValue(entry.provider, entry.type)).toLowerCase() === "codex")
      .map(mapAuthEntry);
  }

  async fetchUsagePayload(): Promise<Record<string, unknown>> {
    return this.fetchJson(`${this.config.baseUrl}/v0/management/usage`);
  }

  async queryQuota(item: AuthItem): Promise<QuotaReport> {
    const report: QuotaReport = {
      name: item.name || "unknown",
      authIndex: item.authIndex,
      accountId: item.accountId,
      planType: item.planType,
      disabled: item.disabled,
      status: "unknown",
      windows: [],
      additionalWindows: [],
      error: ""
    };

    if (report.disabled) {
      report.status = deriveStatus(report);
      return report;
    }
    if (!report.authIndex || !report.accountId) {
      report.error = "missing auth_index or chatgpt_account_id";
      report.status = deriveStatus(report);
      return report;
    }

    const response = await this.postJson(`${this.config.baseUrl}/v0/management/api-call`, {
      auth_index: report.authIndex,
      method: "GET",
      url: WHAM_USAGE_URL,
      header: {
        ...WHAM_HEADERS,
        "Chatgpt-Account-Id": report.accountId
      }
    });

    const statusCode = typeof response.status_code === "number" ? response.status_code : Number(response.statusCode ?? 0);
    const body = response.body;
    const parsedBody = typeof body === "string" ? JSON.parse(body) as Record<string, unknown> : (body as Record<string, unknown> | null);
    if (!statusCode || statusCode < 200 || statusCode >= 300 || !parsedBody) {
      report.error = typeof body === "string" ? body.trim() : `HTTP ${statusCode}`;
      report.status = deriveStatus(report);
      return report;
    }

    report.planType = cleanString(firstValue(parsedBody.plan_type, parsedBody.planType, report.planType)).toLowerCase() || report.planType;
    const { windows, additionalWindows } = parseQuotaWindows(parsedBody);
    report.windows = windows;
    report.additionalWindows = additionalWindows;
    report.status = deriveStatus(report);
    return report;
  }

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.config.managementKey}`
      },
      signal: AbortSignal.timeout(this.config.requestTimeoutMs)
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`management API HTTP ${response.status}: ${text.trim()}`);
    }
    return JSON.parse(text) as Record<string, unknown>;
  }

  private async postJson(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.managementKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.requestTimeoutMs)
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`management API HTTP ${response.status}: ${text.trim()}`);
    }
    return JSON.parse(text) as Record<string, unknown>;
  }
}
