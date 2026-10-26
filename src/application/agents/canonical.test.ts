import { describe, expect, it } from "vitest";
import { canonicalize, paramsHash, redactParams } from "./canonical";

describe("canonicalize / paramsHash", () => {
  it("est indépendant de l'ordre des clés et ignore les undefined d'objet", () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: [1, undefined] }, z: undefined })).toBe(
      canonicalize({ a: { c: [1, null], d: 2 }, b: 1 }),
    );
  });

  it("refuse les valeurs non déterministes", () => {
    expect(() => canonicalize(NaN)).toThrow();
    expect(() => canonicalize(undefined)).toThrow();
    expect(() => canonicalize(new Map())).toThrow();
    expect(() => canonicalize(10n)).toThrow();
  });

  it("l'empreinte change si le tenant, l'outil ou une valeur change", () => {
    const base = paramsHash("t1", "a.b", { x: 1 });
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(paramsHash("t2", "a.b", { x: 1 })).not.toBe(base);
    expect(paramsHash("t1", "a.c", { x: 1 })).not.toBe(base);
    expect(paramsHash("t1", "a.b", { x: 2 })).not.toBe(base);
    expect(paramsHash("t1", "a.b", { x: "1" })).not.toBe(base);
  });
});

describe("redactParams", () => {
  it("masque les secrets, garde les champs métier (shipping n'est pas un PIN)", () => {
    const out = redactParams({ pin: "1234", apiKey: "k", shipping: "DHL", nested: { access_token: "t", note: "ok" } }) as Record<string, unknown>;
    expect(out.pin).toBe("[REDACTED]");
    expect(out.apiKey).toBe("[REDACTED]");
    expect(out.shipping).toBe("DHL");
    expect(out.nested).toEqual({ access_token: "[REDACTED]", note: "ok" });
  });

  it("tronque les longues chaînes", () => {
    expect(String(redactParams("x".repeat(500)))).toHaveLength(200 + "…[tronqué]".length);
  });
});
