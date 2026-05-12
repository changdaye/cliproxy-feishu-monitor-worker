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
  it("matches the multi-line summary layout used in the reference screenshot", () => {
    const text = buildSummaryText(makeSummary(), "https://example.com", new Date("2026-04-23T10:00:00.000Z"));
    const lines = text.split("\n");

    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe("- 📊 状态概况");
    expect(lines[1]).toBe("- 📦 账号总数 12 | 🟢 可用 11 | 🟩 充足 3 | 🟦 高 2 | 🟨 中 4 | 🟧 低 1 | 🟥 耗尽 1 | ⚫️ 禁用 1");
    expect(lines[2]).toBe("- 📈 汇总");
    expect(lines[3]).toBe("- 🧮 7日免费等效: 68%");
    expect(lines[4]).toBe("- 🟣 7小时 Token 用量: 1,234");
    expect(lines[5]).toBe("- 🔵 24小时 Token 用量: 5,678");
    expect(lines[6]).toBe("- 🟦 7天 Token 用量: 9,012 | 📚 累计 Token 用量: 123,456");
    expect(text).not.toContain("来源:");
    expect(text).not.toContain("时间:");
  });

  it("shows a multi-line unavailable-token hint instead of misleading zeros", () => {
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

    expect(text).toContain("- 📈 汇总");
    expect(text).toContain("- 🧮 7日免费等效: 68%");
    expect(text).toContain("- ⚪ Token 用量: 暂无可用数据");
    expect(text).not.toContain("7小时 Token 用量: 0");
  });
});
