import { describe, expect, it } from "vitest";
import { buildSummaryText } from "../src/lib/message";
import type { Summary } from "../src/types";

function makeSummary(): Summary {
  return {
    accounts: 12,
    statusCounts: {
      full: 3,
      high: 2,
      medium: 4,
      low: 1,
      exhausted: 1,
      disabled: 1
    },
    planCounts: {},
    freeEquivalent7D: 68,
    plusEquivalent7D: 0,
    tokenUsage: {
      available: true,
      allTime: 123456,
      last7Hours: 1234,
      last24Hours: 5678,
      last7Days: 9012,
      complete7Hours: true,
      complete24Hours: true,
      complete7Days: true
    }
  };
}

describe("buildSummaryText", () => {
  it("omits source and time so the summary starts with account totals", () => {
    const text = buildSummaryText(makeSummary(), "https://example.com", new Date("2026-04-23T10:00:00.000Z"));
    const lines = text.split("\n");

    expect(lines[0]).toBe("状态概况");
    expect(lines[1]).toBe("账号总数 12 | 充足 3 | 高 2 | 中 4 | 低 1 | 耗尽 1 | 禁用 1");
    expect(text).not.toContain("来源:");
    expect(text).not.toContain("时间:");
  });
});
