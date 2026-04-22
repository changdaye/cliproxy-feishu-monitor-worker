import type { AuthItem, MonitorChunkMessage, MonitorRunRecord, QuotaReport, RuntimeStatus, Summary } from "./types";

function nowIso(now = new Date()): string {
  return now.toISOString();
}

function mapRun(row: Record<string, unknown>): MonitorRunRecord {
  return {
    id: String(row.id),
    status: String(row.status),
    triggerType: String(row.trigger_type),
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : undefined,
    authCount: Number(row.auth_count ?? 0),
    chunkCount: Number(row.chunk_count ?? 0),
    usagePayloadJson: row.usage_payload_json ? String(row.usage_payload_json) : undefined,
    summaryJson: row.summary_json ? String(row.summary_json) : undefined,
    feishuMessageText: row.feishu_message_text ? String(row.feishu_message_text) : undefined,
    errorMessage: row.error_message ? String(row.error_message) : undefined
  };
}

export async function getRuntimeStatus(db: D1Database): Promise<RuntimeStatus> {
  const row = await db.prepare("SELECT value_json FROM runtime_state WHERE key = ?").bind("monitor_state").first<{ value_json: string }>();
  if (!row?.value_json) return { consecutiveFailures: 0 };
  return JSON.parse(row.value_json) as RuntimeStatus;
}

export async function setRuntimeStatus(db: D1Database, status: RuntimeStatus, now = new Date()): Promise<void> {
  await db
    .prepare(`INSERT INTO runtime_state (key, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
    .bind("monitor_state", JSON.stringify(status), nowIso(now))
    .run();
}

export async function getIncompleteRun(db: D1Database): Promise<MonitorRunRecord | undefined> {
  const row = await db
    .prepare("SELECT * FROM monitor_runs WHERE status IN ('pending', 'running', 'aggregating') ORDER BY started_at DESC LIMIT 1")
    .first<Record<string, unknown>>();
  return row ? mapRun(row) : undefined;
}

export async function createRun(db: D1Database, input: { id: string; triggerType: string; authCount: number; chunkCount: number; usagePayloadJson: string; now?: Date }): Promise<void> {
  const timestamp = nowIso(input.now);
  await db
    .prepare(`INSERT INTO monitor_runs (id, status, trigger_type, started_at, auth_count, chunk_count, usage_payload_json)
      VALUES (?, 'pending', ?, ?, ?, ?, ?)`)
    .bind(input.id, input.triggerType, timestamp, input.authCount, input.chunkCount, input.usagePayloadJson)
    .run();
}

export async function createChunks(db: D1Database, runId: string, chunks: MonitorChunkMessage[], now = new Date()): Promise<void> {
  const timestamp = nowIso(now);
  const statements = chunks.map((chunk) =>
    db
      .prepare(`INSERT INTO monitor_chunks (id, run_id, chunk_index, status, account_count, started_at, attempt_count)
        VALUES (?, ?, ?, 'queued', ?, ?, 0)`)
      .bind(chunk.chunkId, runId, chunk.chunkIndex, chunk.accountItems.length, timestamp)
  );
  await db.batch(statements);
}

export async function markRunRunning(db: D1Database, runId: string): Promise<void> {
  await db.prepare("UPDATE monitor_runs SET status = 'running' WHERE id = ?").bind(runId).run();
}

export async function markRunFailed(db: D1Database, runId: string, errorMessage: string, now = new Date()): Promise<void> {
  await db
    .prepare("UPDATE monitor_runs SET status = 'failed', finished_at = ?, error_message = ? WHERE id = ?")
    .bind(nowIso(now), errorMessage, runId)
    .run();
}

export async function markChunkRunning(db: D1Database, chunkId: string, now = new Date()): Promise<void> {
  await db
    .prepare("UPDATE monitor_chunks SET status = 'running', started_at = ?, attempt_count = attempt_count + 1 WHERE id = ?")
    .bind(nowIso(now), chunkId)
    .run();
}

export async function markChunkCompleted(db: D1Database, chunkId: string, now = new Date()): Promise<void> {
  await db
    .prepare("UPDATE monitor_chunks SET status = 'completed', finished_at = ?, error_message = NULL WHERE id = ?")
    .bind(nowIso(now), chunkId)
    .run();
}

export async function markChunkFailed(db: D1Database, chunkId: string, errorMessage: string, now = new Date()): Promise<void> {
  await db
    .prepare("UPDATE monitor_chunks SET status = 'failed', finished_at = ?, error_message = ? WHERE id = ?")
    .bind(nowIso(now), errorMessage, chunkId)
    .run();
}

export async function replaceQuotaReports(db: D1Database, runId: string, chunkId: string, reports: QuotaReport[], now = new Date()): Promise<void> {
  const deleteStmt = db.prepare("DELETE FROM quota_reports WHERE run_id = ? AND chunk_id = ?").bind(runId, chunkId);
  const insertStatements = reports.map((report) =>
    db
      .prepare(`INSERT INTO quota_reports (
        id, run_id, chunk_id, auth_index, account_id, name, plan_type, disabled, status, windows_json, additional_windows_json, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        runId,
        chunkId,
        report.authIndex,
        report.accountId,
        report.name,
        report.planType,
        report.disabled ? 1 : 0,
        report.status,
        JSON.stringify(report.windows),
        JSON.stringify(report.additionalWindows),
        report.error,
        nowIso(now)
      )
  );
  await db.batch([deleteStmt, ...insertStatements]);
}

export async function countChunkStatuses(db: D1Database, runId: string): Promise<Record<string, number>> {
  const rows = await db.prepare("SELECT status, COUNT(*) AS count FROM monitor_chunks WHERE run_id = ? GROUP BY status").bind(runId).all<{ status: string; count: number }>();
  const counts: Record<string, number> = {};
  for (const row of rows.results) counts[row.status] = Number(row.count);
  return counts;
}

export async function listReportsForRun(db: D1Database, runId: string): Promise<QuotaReport[]> {
  const rows = await db.prepare("SELECT * FROM quota_reports WHERE run_id = ? ORDER BY name ASC").bind(runId).all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    name: String(row.name),
    authIndex: row.auth_index ? String(row.auth_index) : "",
    accountId: row.account_id ? String(row.account_id) : "",
    planType: row.plan_type ? String(row.plan_type) : "",
    disabled: Number(row.disabled ?? 0) === 1,
    status: String(row.status),
    windows: JSON.parse(String(row.windows_json ?? "[]")),
    additionalWindows: JSON.parse(String(row.additional_windows_json ?? "[]")),
    error: row.error_message ? String(row.error_message) : ""
  }));
}

export async function finalizeRun(db: D1Database, runId: string, summary: Summary, message: string, now = new Date()): Promise<void> {
  await db
    .prepare("UPDATE monitor_runs SET status = 'completed', finished_at = ?, summary_json = ?, feishu_message_text = ?, error_message = NULL WHERE id = ?")
    .bind(nowIso(now), JSON.stringify(summary), message, runId)
    .run();
}
