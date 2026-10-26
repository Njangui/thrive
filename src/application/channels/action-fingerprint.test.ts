import { describe, it, expect } from "vitest";
import { computeActionFingerprint, stableStringify } from "./action-fingerprint";

describe("computeActionFingerprint", () => {
  it("est indépendante de l'ordre des clés, à tous les niveaux", () => {
    const a = computeActionFingerprint("orders.refund", { orderId: "o1", amount: 5000, meta: { b: 1, a: 2 } });
    const b = computeActionFingerprint("orders.refund", { meta: { a: 2, b: 1 }, amount: 5000, orderId: "o1" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("change si UN paramètre change (montant, outil, ordre d'un tableau)", () => {
    const base = computeActionFingerprint("orders.refund", { orderId: "o1", amount: 5000 });
    expect(computeActionFingerprint("orders.refund", { orderId: "o1", amount: 5001 })).not.toBe(base);
    expect(computeActionFingerprint("orders.cancel", { orderId: "o1", amount: 5000 })).not.toBe(base);
    expect(computeActionFingerprint("t", { ids: [1, 2] })).not.toBe(computeActionFingerprint("t", { ids: [2, 1] }));
  });

  it("ignore les clés undefined (JSON canonique) mais pas null", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(stableStringify({ a: null })).toBe('{"a":null}');
  });
});
