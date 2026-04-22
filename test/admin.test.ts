import { describe, expect, it } from "vitest";
import { authorizeAdminRequest, readBearerToken } from "../src/lib/admin";

describe("readBearerToken", () => {
  it("extracts bearer tokens from the authorization header", () => {
    const request = new Request("https://example.com/admin/tick", {
      method: "POST",
      headers: { Authorization: "Bearer secret-token" }
    });

    expect(readBearerToken(request)).toBe("secret-token");
  });
});

describe("authorizeAdminRequest", () => {
  it("rejects when the token is missing", () => {
    const request = new Request("https://example.com/admin/tick", { method: "POST" });

    expect(authorizeAdminRequest(request, "secret-token")).toEqual({
      ok: false,
      status: 401,
      error: "missing bearer token"
    });
  });

  it("accepts a matching token", () => {
    const request = new Request("https://example.com/admin/tick", {
      method: "POST",
      headers: { Authorization: "Bearer secret-token" }
    });

    expect(authorizeAdminRequest(request, "secret-token")).toEqual({
      ok: true,
      status: 200
    });
  });
});
