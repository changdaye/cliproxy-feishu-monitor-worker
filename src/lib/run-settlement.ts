export type RunSettlementAction = "wait" | "finalize" | "fail";

const ACTIVE_CHUNK_STATUSES = ["pending", "queued", "running"] as const;

export function shouldRetryChunk(attempts: number, maxRetries: number): boolean {
  return attempts < maxRetries;
}

export function getRunSettlementAction(counts: Record<string, number>): RunSettlementAction {
  const hasActiveChunks = ACTIVE_CHUNK_STATUSES.some((status) => (counts[status] ?? 0) > 0);
  if (hasActiveChunks) return "wait";
  if ((counts.failed ?? 0) > 0) return "fail";
  return "finalize";
}
