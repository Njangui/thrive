import { describe, it, expect } from "vitest";
import {
  resolveStorefrontSector,
  getStorefrontBlueprint,
  sectionHeading,
  sectionSubheading,
  STOREFRONT_BLUEPRINTS,
} from "./storefront-blueprint";

describe("resolveStorefrontSector", () => {
  // --- Les 5 valeurs contrôlées produites par le <select> d'onboarding ---

  it("reconnaît directement les 5 valeurs contrôlées de l'onboarding", () => {
    expect(resolveStorefrontSector("retail")).toBe("retail");
    expect(resolveStorefrontSector("restaurant")).toBe("restaurant");
    expect(resolveStorefrontSector("beauty")).toBe("beauty");
    expect(resolveStorefrontSector("professional_services")).toBe("professional_services");
    expect(resolveStorefrontSector("real_estate")).toBe("real_estate");
  });

  // --- Repli mots-clés pour un texte libre ---

  it("reconnaît un texte libre par mot-clé, secteur par secteur", () => {
    expect(resolveStorefrontSector("Boutique de vêtements pour hommes")).toBe("retail");
    expect(resolveStorefrontSector("Restaurant traditionnel")).toBe("restaurant");
    expect(resolveStorefrontSector("Salon de coiffure")).toBe("beauty");
    expect(resolveStorefrontSector("Cabinet de conseil juridique")).toBe("professional_services");
    expect(resolveStorefrontSector("Agence immobilière")).toBe("real_estate");
  });

  it("est insensible à la casse et aux accents", () => {
    expect(resolveStorefrontSector("BEAUTÉ ET BIEN-ÊTRE")).toBe("beauty");
    expect(resolveStorefrontSector("ImMoBiLiEr")).toBe("real_estate");
  });

  it("reconnaît un mot-clé au milieu d'une phrase plus longue", () => {
    expect(resolveStorefrontSector("Nous sommes une petite épicerie de quartier à Yaoundé")).toBe("retail");
  });

  // --- Repli final ---

  it("retombe sur le secteur générique pour un texte sans mot-clé reconnu", () => {
    expect(resolveStorefrontSector("Fabrication de meubles en bois")).toBe("");
  });

  it("retombe sur le secteur générique pour null/undefined/vide", () => {
    expect(resolveStorefrontSector(null)).toBe("");
    expect(resolveStorefrontSector(undefined)).toBe("");
    expect(resolveStorefrontSector("")).toBe("");
    expect(resolveStorefrontSector("   ")).toBe("");
  });

  it("ne lève jamais, quelle que soit l'entrée", () => {
    expect(() => resolveStorefrontSector("!!! 123 €€€ 中文")).not.toThrow();
  });
});

describe("getStorefrontBlueprint", () => {
  it("retourne le blueprint retail pour un tenant retail", () => {
    expect(getStorefrontBlueprint("retail")).toBe(STOREFRONT_BLUEPRINTS.retail);
  });

  it("retourne le blueprint générique pour un secteur non reconnu", () => {
    expect(getStorefrontBlueprint("fabrication de meubles")).toBe(STOREFRONT_BLUEPRINTS[""]);
  });

  it("chaque blueprint déclaré a un catalogue de sections non vide commençant par 'hero'", () => {
    for (const blueprint of Object.values(STOREFRONT_BLUEPRINTS)) {
      expect(blueprint.sections.length).toBeGreaterThan(0);
      expect(blueprint.sections[0]).toBe("hero");
    }
  });

  it("chaque blueprint a au plus 4 highlights (contrainte du formulaire dashboard et du rendu)", () => {
    for (const blueprint of Object.values(STOREFRONT_BLUEPRINTS)) {
      expect(blueprint.highlights.length).toBeLessThanOrEqual(4);
    }
  });

  it("le eyebrow de chaque secteur reconnu diffère de celui du secteur générique (pas de copier-coller oublié)", () => {
    const generic = STOREFRONT_BLUEPRINTS[""].eyebrow;
    for (const key of ["retail", "restaurant", "beauty", "professional_services", "real_estate"] as const) {
      expect(STOREFRONT_BLUEPRINTS[key].eyebrow).not.toBe(generic);
    }
  });
});

describe("sectionHeading / sectionSubheading", () => {
  it("utilise le titre du blueprint quand il existe", () => {
    expect(sectionHeading(STOREFRONT_BLUEPRINTS.restaurant, "products", "repli")).toBe(
      "Les plats qu'on nous redemande",
    );
  });

  it("retombe sur le titre générique du blueprint par défaut si le secteur ne définit rien pour ce type", () => {
    // "location" n'est pas surchargé par le blueprint retail : doit
    // retomber sur celui du blueprint générique plutôt que sur le
    // fallback appelant.
    expect(sectionHeading(STOREFRONT_BLUEPRINTS.retail, "location", "repli ultime")).toBe(
      STOREFRONT_BLUEPRINTS[""].headings.location,
    );
  });

  it("retombe sur le libellé fourni par l'appelant si même le blueprint générique n'a rien", () => {
    // Aucun blueprint ne déclare de titre pour "social_links" ou "cta" :
    // le repli ultime doit être utilisé.
    expect(sectionHeading(STOREFRONT_BLUEPRINTS.retail, "cta", "Appel à l'action")).toBe("Appel à l'action");
  });

  it("sectionSubheading retourne null quand rien n'est déclaré, jamais undefined ni une chaîne vide surprise", () => {
    expect(sectionSubheading(STOREFRONT_BLUEPRINTS.retail, "faq")).toBeNull();
  });

  it("sectionSubheading retourne le sous-titre déclaré quand il existe", () => {
    expect(sectionSubheading(STOREFRONT_BLUEPRINTS.beauty, "booking")).toBe(
      "Choisissez un créneau, on vous confirme rapidement.",
    );
  });
});
