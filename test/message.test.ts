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
  it("keeps account statistics compact on a single line", () => {
    const text = buildSummaryText(makeSummary(), "https://example.com", new Date("2026-04-23T10:00:00.000Z"));
    const lines = text.split("\n");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("📊 账号12 | 🟢可用11 | 🟩充足3 | 🟦高2 | 🟨中4 | 🟧低1 | 🟥耗尽1 | ⚫️禁用1");
    expect(lines[1]).toBe("📈 7d免费等效68% | 🟣7h 1,234 | 🔵24h 5,678 | 🟦7d 9,012 | 📚累计 123,456");
    expect(text).not.toContain("来源:");
    expect(text).not.toContain("时间:");
  });

  it("shows a compact unavailable-token hint instead of misleading zeros", () => {
    const text = buildSummaryText({
      ...makeSummary(),
      tokenUsage: {
        available: false,
        allTime: 0,
        last7Hours: 0,
        last24Hours: 0,
        last7Days: 0,
        complete7Hours: false,
        complete24Hours: false,
        complete7Days: false
      }
    }, "https://example.com", new Date("2026-04-23T10:00:00.000Z"));

    expect(text).toContain("📈 7d免费等效68% | ⚪ Token暂无数据");
    expect(text).not.toContain("7小时 Token 用量: 0");
  });
});
