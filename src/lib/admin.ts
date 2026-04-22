export interface AdminAuthResult {
  ok: boolean;
  status: number;
  error?: string;
}

export function readBearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

export function authorizeAdminRequest(request: Request, expectedToken: string | undefined): AdminAuthResult {
  const configured = expectedToken?.trim() ?? "";
  if (!configured) {
    return { ok: false, status: 503, error: "manual trigger is not configured" };
  }
  const presented = readBearerToken(request);
  if (!presented) {
    return { ok: false, status: 401, error: "missing bearer token" };
  }
  if (presented !== configured) {
    return { ok: false, status: 403, error: "invalid bearer token" };
  }
  return { ok: true, status: 200 };
}
