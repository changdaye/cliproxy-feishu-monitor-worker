import { describe, expect, it } from "vitest";
import { getRunSettlementAction, shouldRetryChunk } from "../src/lib/run-settlement";

describe("shouldRetryChunk", () => {
  it("keeps queue messages retryable before they hit the terminal max-retries attempt", () => {
    expect(shouldRetryChunk(1, 3)).toBe(true);
    expect(shouldRetryChunk(2, 3)).toBe(true);
  });

  it("treats the max-retries attempt as terminal", () => {
    expect(shouldRetryChunk(3, 3)).toBe(false);
    expect(shouldRetryChunk(4, 3)).toBe(false);
  });
});

describe("getRunSettlementAction", () => {
  it("waits while queued or running chunks still exist", () => {
    expect(getRunSettlementAction({ queued: 1, completed: 2 })).toBe("wait");
    expect(getRunSettlementAction({ running: 1, completed: 2 })).toBe("wait");
  });

  it("finalizes when all chunks completed without terminal failures", () => {
    expect(getRunSettlementAction({ completed: 3 })).toBe("finalize");
  });

  it("fails only after terminal failed chunks remain and no active chunks are left", () => {
    expect(getRunSettlementAction({ failed: 1, completed: 2 })).toBe("fail");
  });
});
