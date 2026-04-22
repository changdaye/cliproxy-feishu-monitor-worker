import { parseQuotaWindows, deriveStatus } from "../lib/quota";
import { cleanString, firstValue } from "../lib/value";
import type { AuthItem, MonitorConfig, QuotaReport } from "../types";

const WHAM_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const WHAM_HEADERS = {
  Authorization: "Bearer $TOKEN$",
  "Content-Type": "application/json",
  "User-Agent": "codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal"
};

export class CliProxyClient {
  constructor(private readonly config: MonitorConfig) {}

  async loadCodexAuths(): Promise<AuthItem[]> {
    const payload = await this.fetchJson(`${this.config.baseUrl}/v0/management/auth-files`);
    const files = Array.isArray(payload.files) ? payload.files : [];
    return files
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => item as Record<string, unknown>)
      .filter((entry) => cleanString(firstValue(entry.provider, entry.type)).toLowerCase() === "codex")
      .map((entry) => ({
        authIndex: cleanString(firstValue(entry.auth_index, entry.authIndex)),
        accountId: cleanString(firstValue(entry.chatgpt_account_id, entry.chatgptAccountId, entry.account_id, entry.accountId)),
        name: cleanString(firstValue(entry.email, entry.name, entry.auth_name, entry.authName)) || "unknown",
        disabled: Boolean(firstValue(entry.disabled, entry.is_disabled, entry.isDisabled)),
        planType: cleanString(firstValue(entry.plan_type, entry.planType, entry.account_type, entry.accountType)) || "unknown"
      }));
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

    report.planType = cleanString(firstValue(parsedBody.plan_type, parsedBody.planType, report.planType)) || report.planType;
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
