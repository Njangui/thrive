import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `vi.mock` est hoisté au-dessus de tout le fichier par Vitest — une
// `const` normale déclarée avant lui serait donc encore dans sa "temporal
// dead zone" au moment où la factory ci-dessous s'exécute (`Cannot
// access 'mockEnv' before initialization`, confirmé à la fusion).
// `vi.hoisted()` est hoisté au même niveau que `vi.mock`, dans le même
// ordre relatif : c'est le mécanisme prévu par Vitest pour ce cas.
const mockEnv = vi.hoisted(() => ({ CRON_SECRET: undefined as string | undefined }));
vi.mock("@/lib/env", () => ({ env: mockEnv }));

import { checkCronAuth } from "./cron-auth";

const ROUTE_NAME = "/api/cron/test-route";
const originalNodeEnv = process.env.NODE_ENV;

function setNodeEnv(value: string) {
  // NODE_ENV est en lecture seule dans certains typings — cast local
  // pour ce seul fichier de test, jamais dans le code applicatif.
  (process.env as Record<string, string>).NODE_ENV = value;
}

describe("checkCronAuth — Lot 1 (section 65 : fail-safe production)", () => {
  beforeEach(() => {
    delete mockEnv.CRON_SECRET;
  });

  afterEach(() => {
    setNodeEnv(originalNodeEnv ?? "test");
  });

  it("laisse passer (retourne null) si CRON_SECRET est configuré et l'en-tête Authorization correspond", () => {
    mockEnv.CRON_SECRET = "le-secret";
    const request = new Request("https://example.com/api/cron/test-route", {
      headers: { authorization: "Bearer le-secret" },
    });

    expect(checkCronAuth(request, ROUTE_NAME)).toBeNull();
  });

  it("refuse (401) si CRON_SECRET est configuré mais l'en-tête Authorization est absent", async () => {
    mockEnv.CRON_SECRET = "le-secret";
    const request = new Request("https://example.com/api/cron/test-route");

    const result = checkCronAuth(request, ROUTE_NAME);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("refuse (401) si CRON_SECRET est configuré mais l'en-tête Authorization est incorrect", () => {
    mockEnv.CRON_SECRET = "le-secret";
    const request = new Request("https://example.com/api/cron/test-route", {
      headers: { authorization: "Bearer mauvais-secret" },
    });

    const result = checkCronAuth(request, ROUTE_NAME);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("FAIL-SAFE (503) : refuse en production quand CRON_SECRET n'est pas configuré, plutôt que d'exécuter sans protection", () => {
    setNodeEnv("production");
    const request = new Request("https://example.com/api/cron/test-route");

    const result = checkCronAuth(request, ROUTE_NAME);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(503);
  });

  it("laisse passer hors production quand CRON_SECRET n'est pas configuré (dev/démo)", () => {
    setNodeEnv("development");
    const request = new Request("https://example.com/api/cron/test-route");

    expect(checkCronAuth(request, ROUTE_NAME)).toBeNull();
  });

  it("laisse passer en environnement de test (vitest) quand CRON_SECRET n'est pas configuré", () => {
    setNodeEnv("test");
    const request = new Request("https://example.com/api/cron/test-route");

    expect(checkCronAuth(request, ROUTE_NAME)).toBeNull();
  });
});
