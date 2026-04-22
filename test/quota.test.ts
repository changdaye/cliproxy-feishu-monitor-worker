import { describe, expect, it } from "vitest";
import { deriveStatus, parseTokenUsageByAuth } from "../src/lib/quota";
import type { QuotaReport } from "../src/types";

function baseReport(): QuotaReport {
  return {
    name: "test",
    authIndex: "1",
    accountId: "acc",
    planType: "free",
    disabled: false,
    status: "unknown",
    windows: [{ id: "code-7d", label: "Code 7d", remainingPercent: 25, resetLabel: "-", exhausted: false }],
    additionalWindows: [],
    error: ""
  };
}

describe("deriveStatus", () => {
  it("maps remaining percentage to low", () => {
    expect(deriveStatus(baseReport())).toBe("low");
  });
});

describe("parseTokenUsageByAuth", () => {
  it("aggregates token usage by auth index", () => {
    const result = parseTokenUsageByAuth({
      usage: {
        apis: {
          codex: {
            models: {
              gpt: {
                details: [
                  { auth_index: "a", timestamp: "2026-04-22T00:00:00.000Z", total_tokens: 10 },
                  { auth_index: "a", timestamp: "2026-04-22T01:00:00.000Z", total_tokens: 20 }
                ]
              }
            }
          }
        }
      }
    }, new Date("2026-04-22T02:00:00.000Z"));

    expect(result.byAuth.a.allTime).toBe(30);
    expect(result.byAuth.a.last7Hours).toBe(30);
  });
});
