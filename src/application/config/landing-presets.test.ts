import { describe, it, expect } from "vitest";
import { resolveIndustryPresetKey, buildDefaultSections, LANDING_PRESETS } from "./landing-presets";

describe("resolveIndustryPresetKey", () => {
  // --- Les 4 cas minimum demandés par le cahier Lot K ---

  it("texte libre contenant 'boutique' -> preset boutique", () => {
    expect(resolveIndustryPresetKey("Boutique de vêtements")).toBe("boutique");
  });

  it("texte libre contenant 'salon' -> preset salon", () => {
    expect(resolveIndustryPresetKey("Salon de coiffure et de beauté")).toBe("salon");
  });

  it("texte libre contenant 'restaurant' -> preset restaurant", () => {
    expect(resolveIndustryPresetKey("Restaurant traditionnel camerounais")).toBe("restaurant");
  });

  it("secteur inconnu/inattendu -> repli sur default, ne bloque jamais", () => {
    expect(resolveIndustryPresetKey("Fabrication de meubles en bois")).toBe("default");
    expect(resolveIndustryPresetKey("xyz123 !!!")).toBe("default");
  });

  // --- Cas limites ---

  it("null/undefined/chaîne vide -> default", () => {
    expect(resolveIndustryPresetKey(null)).toBe("default");
    expect(resolveIndustryPresetKey(undefined)).toBe("default");
    expect(resolveIndustryPresetKey("")).toBe("default");
    expect(resolveIndustryPresetKey("   ")).toBe("default");
  });

  it("insensible à la casse et aux accents", () => {
    expect(resolveIndustryPresetKey("SALON DE COIFFURE")).toBe("salon");
    expect(resolveIndustryPresetKey("bEaUté")).toBe("salon");
  });

  // --- Valeurs RÉELLEMENT produites par le <select> de l'onboarding
  // actuel (onboarding-wizard.tsx::INDUSTRY_OPTIONS) — le cahier Lot K
  // suppose un texte libre arbitraire, mais en pratique ce sont ces 5
  // valeurs contrôlées (ou vide) qui arrivent ici. Voir RAPPORT_LOT_K.md.

  it("valeur onboarding 'retail' -> boutique", () => {
    expect(resolveIndustryPresetKey("retail")).toBe("boutique");
  });

  it("valeur onboarding 'beauty' -> salon", () => {
    expect(resolveIndustryPresetKey("beauty")).toBe("salon");
  });

  it("valeur onboarding 'restaurant' -> restaurant", () => {
    expect(resolveIndustryPresetKey("restaurant")).toBe("restaurant");
  });

  it("valeurs onboarding sans preset dédié ('professional_services', 'real_estate') -> default", () => {
    expect(resolveIndustryPresetKey("professional_services")).toBe("default");
    expect(resolveIndustryPresetKey("real_estate")).toBe("default");
  });
});

describe("buildDefaultSections", () => {
  it("construit un tableau ordonné, toutes sections activées, correspondant exactement au preset", () => {
    const sections = buildDefaultSections("salon");
    expect(sections).toEqual(
      LANDING_PRESETS.salon.map((type, index) => ({ type, enabled: true, order: index })),
    );
  });

  it("preset boutique met en avant Produits/Promotions/Catégories, PAS Services/Équipe (master prompt section 16)", () => {
    const types = buildDefaultSections("boutique").map((s) => s.type);
    expect(types).toContain("products");
    expect(types).toContain("promotions");
    expect(types).toContain("categories");
    expect(types).not.toContain("services");
    expect(types).not.toContain("team");
    expect(types).not.toContain("booking");
  });

  it("preset salon met en avant Services/Équipe/Galerie/Rendez-vous, PAS Produits/Promotions (master prompt section 16)", () => {
    const types = buildDefaultSections("salon").map((s) => s.type);
    expect(types).toContain("services");
    expect(types).toContain("team");
    expect(types).toContain("booking");
    expect(types).not.toContain("products");
    expect(types).not.toContain("promotions");
  });

  it("'footer' n'apparaît jamais dans un preset (toujours rendu séparément, jamais désactivable)", () => {
    for (const key of Object.keys(LANDING_PRESETS) as (keyof typeof LANDING_PRESETS)[]) {
      expect(buildDefaultSections(key).map((s) => s.type)).not.toContain("footer");
    }
  });
});
