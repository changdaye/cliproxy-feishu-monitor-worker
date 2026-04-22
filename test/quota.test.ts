import { describe, expect, it } from "vitest";
import { deriveStatus, parseTokenUsageByAuth } from "../src/lib/quota";
import { mapAuthEntry } from "../src/services/cliproxy";
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

describe("mapAuthEntry", () => {
  it("extracts account id and plan type from id_token metadata", () => {
    expect(
      mapAuthEntry({
        auth_index: "abc",
        email: "a@example.com",
        disabled: false,
        status: "active",
        id_token: {
          chatgpt_account_id: "acc-123",
          plan_type: "free"
        }
      })
    ).toEqual({
      authIndex: "abc",
      accountId: "acc-123",
      name: "a@example.com",
      disabled: false,
      planType: "free"
    });
  });
});

describe("parseTokenUsageByAuth", () => {
  it("aggregates token usage by auth index from nested tokens payloads", () => {
    const result = parseTokenUsageByAuth({
      usage: {
        apis: {
          codex: {
            models: {
              "gpt-5.4": {
                details: [
                  { auth_index: "a", timestamp: "2026-04-22T00:00:00.000Z", tokens: { total_tokens: 10 } },
                  { auth_index: "a", timestamp: "2026-04-22T01:00:00.000Z", tokens: { input_tokens: 12, output_tokens: 3, reasoning_tokens: 5 } }
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
