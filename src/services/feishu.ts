import type { MonitorConfig } from "../types";

export async function pushToFeishu(config: MonitorConfig, text: string): Promise<void> {
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
