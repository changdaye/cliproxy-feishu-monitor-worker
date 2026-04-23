import type { MonitorConfig } from "../types";

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /\b11232\b/.test(error.message) || /HTTP 429\b/.test(error.message);
}

export async function pushToFeishu(config: MonitorConfig, text: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await sendOnce(config, text);
      return;
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || attempt === MAX_RETRIES) throw error;
      await sleep(BASE_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError;
}

async function sendOnce(config: MonitorConfig, text: string): Promise<void> {
  const payload = await buildPayload(text, config.feishuSecret);
  const response = await fetch(config.feishuWebhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`feishu webhook HTTP ${response.status}: ${raw.trim()}`);
  }
  if (!raw) return;
  const body = JSON.parse(raw) as { code?: number; msg?: string; message?: string };
  if ((body.code ?? 0) !== 0) {
    throw new Error(`feishu webhook error ${body.code}: ${body.msg ?? body.message ?? "unknown"}`);
  }
}

async function buildPayload(text: string, secret: string) {
  const payload: Record<string, unknown> = {
    msg_type: "text",
    content: { text }
  };
  if (!secret) return payload;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(`${timestamp}\n${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new Uint8Array());
  const bytes = Array.from(new Uint8Array(signature));
  payload.timestamp = timestamp;
  payload.sign = btoa(String.fromCharCode(...bytes));
  return payload;
}
