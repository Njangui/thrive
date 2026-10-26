import { describe, it, expect, afterEach, vi } from "vitest";
import { buildCsp, supabaseHostFromEnv } from "./csp";

describe("CSP (audit SEC1/QA3)", () => {
  it("aucun joker *.supabase.co : seul l'hôte du projet est autorisé", () => {
    const csp = buildCsp({ supabaseHost: "abcd.supabase.co" });
    expect(csp).toContain("https://abcd.supabase.co");
    expect(csp).not.toContain("*.supabase.co");
    expect(buildCsp({})).not.toContain("supabase");
  });
  it("mode nonce : plus de 'unsafe-inline' pour les scripts", () => {
    const csp = buildCsp({ nonce: "abc123" });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp.split("; ").find((d) => d.startsWith("script-src"))).not.toContain("unsafe-inline");
  });
  it("hôte Supabase lu depuis l'URL (https uniquement)", () => {
    expect(supabaseHostFromEnv("https://abcd.supabase.co")).toBe("abcd.supabase.co");
    expect(supabaseHostFromEnv("http://abcd.supabase.co")).toBeNull();
    expect(supabaseHostFromEnv(undefined)).toBeNull();
  });
});

describe("next.config.mjs reste synchrone avec buildCsp (mode statique)", () => {
  afterEach(() => { vi.resetModules(); vi.unstubAllEnvs(); });
  it("même CSP", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd.supabase.co");
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://media.example.com");
    vi.stubEnv("CSP_NONCE", "");
    vi.resetModules();
    const cfg = (await import(/* @vite-ignore */ "../../next.config" + ".mjs" as string)).default as { headers: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>> };
    const rules = await cfg.headers();
    const csp = rules[0]!.headers.find((h) => h.key === "Content-Security-Policy")!.value;
    expect(csp).toBe(buildCsp({ supabaseHost: "abcd.supabase.co", r2Origin: "https://media.example.com" }));
  });
  it("mode nonce : next.config n'émet pas de CSP (le proxy s'en charge)", async () => {
    vi.stubEnv("CSP_NONCE", "true");
    vi.resetModules();
    const cfg = (await import(/* @vite-ignore */ "../../next.config" + ".mjs" as string)).default as { headers: () => Promise<Array<{ headers: Array<{ key: string }> }>> };
    const rules = await cfg.headers();
    expect(rules[0]!.headers.some((h) => h.key === "Content-Security-Policy")).toBe(false);
  });
});
