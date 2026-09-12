import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./env", () => ({ env: { CRON_SECRET: undefined as string | undefined } }));

import { verifyCronAuth } from "./cron-auth";
import { env } from "./env";

beforeEach(() => {
  (env as { CRON_SECRET?: string }).CRON_SECRET = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeRequest(authHeader?: string): Request {
  return new Request("https://example.com/api/cron/x", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe("verifyCronAuth — critère d'acceptation Lot 3 (audit master prompt §65)", () => {
  it("CRON_SECRET configuré + en-tête correct : autorisé", () => {
    (env as { CRON_SECRET?: string }).CRON_SECRET = "s3cr3t";
    const result = verifyCronAuth(makeRequest("Bearer s3cr3t"));
    expect(result.authorized).toBe(true);
  });

  it("CRON_SECRET configuré + en-tête absent ou incorrect : refusé (401)", () => {
    (env as { CRON_SECRET?: string }).CRON_SECRET = "s3cr3t";
    expect(verifyCronAuth(makeRequest()).authorized).toBe(false);
    expect(verifyCronAuth(makeRequest("Bearer mauvais")).authorized).toBe(false);
    expect(verifyCronAuth(makeRequest()).status).toBe(401);
  });

  it("CRON_SECRET absent EN PRODUCTION : refuse (fail-safe, jamais d'exécution non authentifiée)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = verifyCronAuth(makeRequest());
    expect(result.authorized).toBe(false);
    expect(result.status).toBe(503);
  });

  it("CRON_SECRET absent HORS production (dev/démo) : autorisé avec avertissement, ne bloque pas un environnement de démo", () => {
    vi.stubEnv("NODE_ENV", "development");
    const result = verifyCronAuth(makeRequest());
    expect(result.authorized).toBe(true);
  });
});
