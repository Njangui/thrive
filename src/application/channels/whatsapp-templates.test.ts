import { describe, expect, it } from "vitest";
import { buildCreateComponents, buildTemplateParams, classifyFailure, isSessionWindowOpen, sanitizeTemplateParam, TEMPLATE_CATALOG, templateByKey, toParticipantId } from "./whatsapp-templates";

describe("catalogue", () => {
  it("noms Meta valides, variables séquentielles, jamais au début/à la fin, exemples complets", () => {
    for (const t of TEMPLATE_CATALOG) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
      const vars = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect(vars).toEqual(Array.from({ length: t.paramCount }, (_, i) => i + 1));
      expect(t.body.startsWith("{{")).toBe(false);
      expect(t.body.endsWith("}}")).toBe(false);
      expect(t.example).toHaveLength(t.paramCount);
      expect(t.body.length).toBeLessThanOrEqual(1024);
    }
    expect(new Set(TEMPLATE_CATALOG.map((t) => t.name)).size).toBe(TEMPLATE_CATALOG.length);
  });
  it("composant de création", () => {
    expect(buildCreateComponents(templateByKey("alert")!)).toEqual([{ type: "body", text: expect.stringContaining("{{1}}"), example: { body_text: [expect.any(Array)] } }]);
  });
});

describe("paramètres", () => {
  it("assainit : pas de retour ligne, pas de gros espaces, jamais vide, borné", () => {
    expect(sanitizeTemplateParam("a\nb\t\tc    d")).toBe("a b c d");
    expect(sanitizeTemplateParam("   ")).toBe("-");
    expect(sanitizeTemplateParam("x".repeat(500))).toHaveLength(200);
  });
  it("complète / tronque au nombre attendu", () => {
    const def = templateByKey("daily_summary")!;
    expect(buildTemplateParams(def, ["a"])).toEqual(["a", "-", "-"]);
    expect(buildTemplateParams(def, ["a", "b", "c", "d"])).toHaveLength(3);
  });
  it("participantId : chiffres sans +", () => {
    expect(toParticipantId("+237 699 00 00 01")).toBe("237699000001");
    expect(toParticipantId("12")).toBeNull();
  });
});

describe("fenêtre de 24 h", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  it("ouverte < 24 h, fermée ensuite, absente = fermée, futur = fermée", () => {
    expect(isSessionWindowOpen("2026-10-08T12:00:01Z", now)).toBe(true);
    expect(isSessionWindowOpen("2026-10-08T12:00:00Z", now)).toBe(false);
    expect(isSessionWindowOpen(null, now)).toBe(false);
    expect(isSessionWindowOpen("2026-10-10T00:00:00Z", now)).toBe(false);
    expect(isSessionWindowOpen("n'importe quoi", now)).toBe(false);
  });
});

describe("classification des échecs", () => {
  it("paiement / fenêtre / autre", () => {
    expect(classifyFailure("(#131042) Business eligibility payment issue")).toBe("payment");
    expect(classifyFailure("Error 131047: Re-engagement message")).toBe("window");
    expect(classifyFailure("Numéro invalide")).toBe("other");
    expect(classifyFailure(undefined)).toBe("other");
  });
});
