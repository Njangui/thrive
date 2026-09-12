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

  it("les trois types de clé (webhook/auth/waitlist) passent par le même repli ouvert", async () => {
    const { checkRateLimit } = await import("./rate-limit");
    expect(await checkRateLimit("webhook", "id-1")).toBeNull();
    expect(await checkRateLimit("auth", "id-2")).toBeNull();
    expect(await checkRateLimit("waitlist", "id-3")).toBeNull();
  });
});
