import { describe, it, expect, beforeEach, vi } from "vitest";

describe("checkRateLimit — repli quand Upstash n'est pas configuré", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it("n'importe jamais UPSTASH_REDIS_REST_URL/TOKEN absents comme un blocage — retourne null (requête autorisée)", async () => {
    const { checkRateLimit } = await import("./rate-limit");
    const result = await checkRateLimit("webhook", "1.2.3.4");
    expect(result).toBeNull();
  });

  it("avertit une seule fois (pas à chaque appel) quand non configuré", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { checkRateLimit } = await import("./rate-limit");

    await checkRateLimit("webhook", "1.2.3.4");
    await checkRateLimit("auth", "5.6.7.8");
    await checkRateLimit("webhook", "1.2.3.4");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("les cinq types de clé (webhook/auth/waitlist/affiliate_click/booking) passent par le même repli ouvert", async () => {
    const { checkRateLimit } = await import("./rate-limit");
    expect(await checkRateLimit("webhook", "id-1")).toBeNull();
    expect(await checkRateLimit("auth", "id-2")).toBeNull();
    expect(await checkRateLimit("waitlist", "id-3")).toBeNull();
    expect(await checkRateLimit("affiliate_click", "id-4")).toBeNull();
    expect(await checkRateLimit("booking", "id-5")).toBeNull();
  });
});

describe("Q33 : drapeau RATE_LIMIT_REQUIRED et panne Redis (audit RL1/RL2)", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.RATE_LIMIT_REQUIRED;
  });

  it("drapeau actif sans Upstash : requêtes limitées refusées (retry-after), webhooks laissés ouverts", async () => {
    process.env.RATE_LIMIT_REQUIRED = "true";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { checkRateLimit } = await import("./rate-limit");
    expect(await checkRateLimit("auth", "x")).toBe(60);
    expect(await checkRateLimit("assistant", "u")).toBe(60);
    expect(await checkRateLimit("webhook", "ip")).toBeNull();
    expect(errSpy).toHaveBeenCalledTimes(1); // alerte limitée dans le temps
    errSpy.mockRestore();
  });

  it("drapeau absent (défaut) : repli ouvert inchangé", async () => {
    const { checkRateLimit } = await import("./rate-limit");
    expect(await checkRateLimit("auth", "x")).toBeNull();
  });

  it("panne Redis : repli ouvert + alerte, jamais d'exception", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.invalid";
    process.env.UPSTASH_REDIS_REST_TOKEN = "t";
    vi.doMock("@upstash/ratelimit", () => {
      const Ratelimit = class { limit() { return Promise.reject(new Error("redis down")); } static slidingWindow() { return {}; } };
      return { Ratelimit };
    });
    vi.doMock("@upstash/redis", () => ({ Redis: class {} }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { checkRateLimit } = await import("./rate-limit");
    expect(await checkRateLimit("auth", "x")).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
    vi.doUnmock("@upstash/ratelimit");
    vi.doUnmock("@upstash/redis");
  });
});
