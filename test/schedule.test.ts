import { describe, expect, it } from "vitest";
import { getScheduledSummaryLabel, shouldStartScheduledSummaryRun } from "../src/lib/schedule";

describe("getScheduledSummaryLabel", () => {
  it("describes the three fixed China-time summary slots", () => {
    expect(getScheduledSummaryLabel()).toBe("07:00 / 12:00 / 19:00 (Asia/Shanghai)");
  });
});

describe("shouldStartScheduledSummaryRun", () => {
  it("starts 15 minutes before the 07:00 China-time summary when that slot is still unsent", () => {
    expect(
      shouldStartScheduledSummaryRun("2026-05-04T19:05:00+08:00", new Date("2026-05-05T06:45:00+08:00"))
    ).toBe(true);
  });

  it("does not start before the prefetch window opens", () => {
    expect(
      shouldStartScheduledSummaryRun("2026-05-04T19:05:00+08:00", new Date("2026-05-05T06:30:00+08:00"))
    ).toBe(false);
  });

  it("waits until 11:45 China time for the noon summary after the morning slot was already sent", () => {
    expect(
      shouldStartScheduledSummaryRun("2026-05-05T07:02:00+08:00", new Date("2026-05-05T11:30:00+08:00"))
    ).toBe(false);
    expect(
      shouldStartScheduledSummaryRun("2026-05-05T07:02:00+08:00", new Date("2026-05-05T11:45:00+08:00"))
    ).toBe(true);
  });

  it("does not restart after the evening summary slot has already been satisfied", () => {
    expect(
      shouldStartScheduledSummaryRun("2026-05-05T19:01:00+08:00", new Date("2026-05-05T20:00:00+08:00"))
    ).toBe(false);
  });
});
