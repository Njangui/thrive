import { describe, it, expect } from "vitest";
import { resolveIndustryPresetKey, buildDefaultSections, LANDING_PRESETS, LANDING_PRESET_KEYS } from "./landing-presets";

describe("resolveIndustryPresetKey", () => {
  // --- Les 5 secteurs reconnus ---

  it("texte libre contenant 'boutique' -> preset boutique", () => {
    expect(resolveIndustryPresetKey("Boutique de vêtements")).toBe("boutique");
  });

  it("texte libre contenant 'salon' -> preset salon", () => {
    expect(resolveIndustryPresetKey("Salon de coiffure et de beauté")).toBe("salon");
  });

  it("texte libre contenant 'restaurant' -> preset restaurant", () => {
    expect(resolveIndustryPresetKey("Restaurant traditionnel camerounais")).toBe("restaurant");
  });

  it("texte libre évoquant des services professionnels -> preset services", () => {
    expect(resolveIndustryPresetKey("Cabinet de conseil en gestion")).toBe("services");
  });

  it("texte libre évoquant l'immobilier -> preset immobilier", () => {
    expect(resolveIndustryPresetKey("Agence immobilière du littoral")).toBe("immobilier");
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

  // --- Les 5 valeurs contrôlées produites par le <select> de
  // l'onboarding actuel (onboarding-wizard.tsx::INDUSTRY_OPTIONS).
  //
  // ÉVOLUTION (chantier vitrine V2) : `professional_services` et
  // `real_estate` obtiennent désormais leur PROPRE preset au lieu de
  // retomber sur "default" — écart assumé du Lot K corrigé ici. Ce
  // changement de comportement est délibéré et documenté dans
  // landing-presets.ts ; ces deux cas remplacent l'ancien test qui
  // vérifiait l'inverse.

  it("valeur onboarding 'retail' -> boutique", () => {
    expect(resolveIndustryPresetKey("retail")).toBe("boutique");
  });

  it("valeur onboarding 'beauty' -> salon", () => {
    expect(resolveIndustryPresetKey("beauty")).toBe("salon");
  });

  it("valeur onboarding 'restaurant' -> restaurant", () => {
    expect(resolveIndustryPresetKey("restaurant")).toBe("restaurant");
  });

  it("valeur onboarding 'professional_services' -> services (plus de repli sur default)", () => {
    expect(resolveIndustryPresetKey("professional_services")).toBe("services");
  });

  it("valeur onboarding 'real_estate' -> immobilier (plus de repli sur default)", () => {
    expect(resolveIndustryPresetKey("real_estate")).toBe("immobilier");
  });
});

describe("buildDefaultSections", () => {
  it("construit un tableau ordonné, toutes sections activées, correspondant exactement au preset", () => {
    const sections = buildDefaultSections("salon");
    expect(sections).toEqual(
      LANDING_PRESETS.salon.map((type, index) => ({ type, enabled: true, order: index })),
    );
  });

  it("preset boutique met en avant Produits/Promotions/Catégories, PAS Services/Équipe", () => {
    const types = buildDefaultSections("boutique").map((s) => s.type);
    expect(types).toContain("products");
    expect(types).toContain("promotions");
    expect(types).toContain("categories");
    expect(types).not.toContain("services");
    expect(types).not.toContain("team");
    expect(types).not.toContain("booking");
  });

  it("preset salon met en avant Services/Galerie/Rendez-vous, PAS Produits/Promotions", () => {
    const types = buildDefaultSections("salon").map((s) => s.type);
    expect(types).toContain("services");
    expect(types).toContain("gallery");
    expect(types).toContain("booking");
    expect(types).not.toContain("products");
    expect(types).not.toContain("promotions");
  });

  it("preset services met en avant Services/Rendez-vous, PAS Produits/Catégories/Promotions", () => {
    const types = buildDefaultSections("services").map((s) => s.type);
    expect(types).toContain("services");
    expect(types).toContain("booking");
    expect(types).not.toContain("products");
    expect(types).not.toContain("categories");
    expect(types).not.toContain("promotions");
  });

  it("preset immobilier met en avant Biens/Catégories, PAS Services/Rendez-vous", () => {
    const types = buildDefaultSections("immobilier").map((s) => s.type);
    expect(types).toContain("products");
    expect(types).toContain("categories");
    expect(types).not.toContain("services");
    expect(types).not.toContain("booking");
  });

  it("'footer' n'apparaît jamais dans un preset (toujours rendu séparément, jamais désactivable)", () => {
    for (const key of Object.keys(LANDING_PRESETS) as (keyof typeof LANDING_PRESETS)[]) {
      expect(buildDefaultSections(key).map((s) => s.type)).not.toContain("footer");
    }
  });

  it("chaque preset commence par 'hero' (première impression toujours en tête)", () => {
    for (const key of LANDING_PRESET_KEYS) {
      expect(buildDefaultSections(key)[0]?.type).toBe("hero");
    }
  });
});
