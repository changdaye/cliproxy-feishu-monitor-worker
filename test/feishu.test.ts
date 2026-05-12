import { describe, expect, it } from "vitest";
import { buildPayload } from "../src/services/feishu";

describe("buildPayload", () => {
  it("builds concise emoji-colored plain text payloads", async () => {
    const payload = await buildPayload([
      "📊 账号12 | 🟢可用11 | 🟩充足3 | 🟦高2 | 🟨中4 | 🟧低1 | 🟥耗尽1 | ⚫️禁用1",
      "📈 7d免费等效68% | 🟣7h 1,234"
    ].join("\n"), "");

    expect(payload.msg_type).toBe("text");
    expect(payload.content.text).toContain("📊 账号12");
    expect(payload.content.text).toContain("🟣7h 1,234");
  });
});
