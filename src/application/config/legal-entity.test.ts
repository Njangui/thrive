import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { LEGAL_ENTITY, isLegalEntityComplete, legalField, missingLegalFields, type LegalEntity } from "./legal-entity";

const COMPLETE: LegalEntity = {
  companyName: "Exemple SARL",
  legalForm: "SARL",
  shareCapital: "1 000 000",
  rccm: "RC/YAO/2026/B/0000",
  niu: "M000000000000A",
  address: "Rue de l'Exemple",
  city: "Yaoundé",
  country: "Cameroun",
  phone: "",
  contactEmail: "contact@exemple.test",
  privacyEmail: "",
  publicationDirector: "Jeanne Exemple",
  jurisdictionCity: "Yaoundé",
  postClosureRetention: "90 jours",
  lastUpdated: "20 septembre 2026",
};

describe("legalField", () => {
  it("renvoie la valeur renseignée, sans espaces autour", () => {
    expect(legalField("  Exemple SARL ", "dénomination sociale")).toBe("Exemple SARL");
  });

  it("renvoie un repère visible — jamais une valeur inventée — quand le champ est vide", () => {
    expect(legalField("", "numéro RCCM")).toBe("[À COMPLÉTER — numéro RCCM]");
    expect(legalField("   ", "numéro RCCM")).toBe("[À COMPLÉTER — numéro RCCM]");
  });
});

describe("isLegalEntityComplete / missingLegalFields", () => {
  it("l'identité livrée par défaut est incomplète : les pages légales restent noindex", () => {
    expect(isLegalEntityComplete(LEGAL_ENTITY)).toBe(false);
    expect(missingLegalFields(LEGAL_ENTITY)).toContain("rccm");
  });

  it("une identité complète est reconnue, téléphone / capital / email privacy facultatifs", () => {
    expect(isLegalEntityComplete(COMPLETE)).toBe(true);
    expect(missingLegalFields(COMPLETE)).toEqual([]);
  });

  it("un seul champ obligatoire vide suffit à rendre l'identité incomplète", () => {
    expect(isLegalEntityComplete({ ...COMPLETE, niu: " " })).toBe(false);
    expect(missingLegalFields({ ...COMPLETE, niu: " ", rccm: "" })).toEqual(["rccm", "niu"]);
  });
});

describe("pages légales", () => {
  it("n'écrivent aucun « [À COMPLÉTER » en dur : tout passe par legalField, donc par legal-entity.ts", () => {
    const root = path.resolve(__dirname, "..", "..", "app");
    const offenders = ["mentions-legales", "cgu", "confidentialite"]
      .map((dir) => path.join(root, dir, "page.tsx"))
      .filter((file) => fs.readFileSync(file, "utf8").includes("[À COMPLÉTER"));

    expect(offenders).toEqual([]);
  });
});
