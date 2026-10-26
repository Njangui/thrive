import { describe, it, expect } from "vitest";
import { normalizeExtraPermissions } from "./actor";

describe("normalizeExtraPermissions", () => {
  it("garde les clés strictement `true` d'un objet jsonb, triées", () => {
    expect(normalizeExtraPermissions({ manage_ai: true, view_finance: true, export: false })).toEqual(["manage_ai", "view_finance"]);
  });

  it("n'élève jamais de droit sur une valeur ambiguë (\"true\", 1, objet)", () => {
    expect(normalizeExtraPermissions({ a: "true", b: 1, c: {}, d: null })).toEqual([]);
  });

  it("accepte un tableau de chaînes legacy, dédoublonné, et ignore le reste", () => {
    expect(normalizeExtraPermissions(["b", "a", "a", 3, ""])).toEqual(["a", "b"]);
  });

  it("renvoie [] pour null/undefined/scalaires", () => {
    expect(normalizeExtraPermissions(null)).toEqual([]);
    expect(normalizeExtraPermissions(undefined)).toEqual([]);
    expect(normalizeExtraPermissions("admin")).toEqual([]);
  });
});
