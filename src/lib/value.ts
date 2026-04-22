export function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

export function firstValue<T = unknown>(...values: unknown[]): T | undefined {
  return values.find((value) => value !== undefined && value !== null) as T | undefined;
}

export function numberFromAny(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function boolFromAny(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return ["1", "true", "yes"].includes(value.trim().toLowerCase());
  return false;
}

export function clampFloat(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatNumberWithCommas(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export function normalizeBaseUrl(raw: string): string {
  let value = cleanString(raw);
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  try {
    const parsed = new URL(value);
    for (const suffix of ["/v0/management/auth-files", "/v0/management/api-call", "/v0/management/usage", "/v0/management", "/management.html", "/login"]) {
      if (parsed.pathname.endsWith(suffix)) {
        parsed.pathname = parsed.pathname.slice(0, -suffix.length) || "/";
      }
    }
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/\/$/, "");
  }
}

export function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function toInt(value: string | undefined, fallback: number, min = 1): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, parsed);
}
