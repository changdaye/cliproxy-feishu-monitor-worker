import { describe, expect, it } from "vitest";
import { chunkItems } from "../src/lib/chunk";

describe("chunkItems", () => {
  it("splits arrays by requested size", () => {
    expect(chunkItems([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
