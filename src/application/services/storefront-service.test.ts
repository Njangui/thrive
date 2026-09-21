import { describe, it, expect } from "vitest";
import {
  buildStorefrontNav,
  resolveStorefrontHighlights,
  resolveHeroLayout,
  resolveHeroMedia,
  countCurrentPromotions,
  type StorefrontCapabilities,
} from "./storefront-service";
import { STOREFRONT_BLUEPRINTS } from "@/application/config/storefront-blueprint";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";
import type { TenantContext } from "@/infrastructure/tenant/resolve-request-tenant";
import type { LandingConfig } from "./landing-config-service";

// ------------------------------------------------------------
// Fixtures — un tenant et des capacités "tout à zéro" par défaut, que
// chaque test surcharge sur les seuls champs qui l'intéressent. Ça évite
// qu'un test passe pour la mauvaise raison (un champ non pertinent mais
// vrai par défaut masquant un bug réel).
// ------------------------------------------------------------

function makeTenant(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    organizationId: "org-1",
    name: "Ma Boutique",
    slug: "ma-boutique",
    industry: "retail",
    description: null,
    phone: null,
    whatsappNumber: null,
    email: null,
    address: null,
    openingHours: {},
    socialLinks: {},
    logoUrl: null,
    bannerUrl: null,
    faviconUrl: null,
    currency: "XAF",
    seoTitle: null,
    seoDescription: null,
    seoOgImageUrl: null,
    ...overrides,
  };
}

function makeCapabilities(overrides: Partial<StorefrontCapabilities> = {}): StorefrontCapabilities {
  return {
    productCount: 0,
    promotionCount: 0,
    categoryCount: 0,
    serviceCount: 0,
    galleryCount: 0,
    faqCount: 0,
    testimonialCount: 0,
    teamCount: 0,
    hasProducts: false,
    hasPromotions: false,
    hasCategories: false,
    hasServices: false,
    hasGallery: false,
    hasFaq: false,
    hasTestimonials: false,
    hasTeam: false,
    hasLocation: false,
    hasContactDetails: false,
    hasSocialLinks: false,
    hasOpeningHours: false,
    hasWhatsApp: false,
    bookingEnabled: true,
    brandingRemoved: false,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<LandingConfig> = {}): LandingConfig {
  return {
    organizationId: "org-1",
    sections: [],
    brandColorPrimary: null,
    brandColorSecondary: null,
    fontChoice: "modern",
    heroTitle: null,
    heroSubtitle: null,
    ctaLabel: null,
    ctaUrl: null,
    visualStyle: "soft",
    announcement: null,
    announcementEnabled: true,
    heroLayout: null,
    heroMediaUrl: null,
    highlights: null,
    secondaryCtaLabel: null,
    secondaryCtaUrl: null,
    paymentMethods: null,
    showStats: true,
    isCustomized: false,
    ...overrides,
  };
}

const RETAIL_BLUEPRINT = STOREFRONT_BLUEPRINTS.retail;

describe("buildStorefrontNav", () => {
  it("place toujours 'Accueil' en premier et 'Contact' en dernier quand les deux existent", () => {
    const tenant = makeTenant({ address: "Yaoundé" });
    const capabilities = makeCapabilities({ hasProducts: true, hasContactDetails: true });
    const nav = buildStorefrontNav(["hero", "products", "contact"], RETAIL_BLUEPRINT, capabilities, tenant);

    expect(nav[0]?.key).toBe("home");
    expect(nav[nav.length - 1]?.key).toBe("contact");
  });

  it("n'inclut JAMAIS une page dont la capacité correspondante est fausse — pas de lien vers une section vide", () => {
    const tenant = makeTenant();
    // Le commerçant a activé "services" dans sa page d'accueil, mais n'a
    // en réalité aucune prestation publiée.
    const capabilities = makeCapabilities({ hasServices: false });
    const nav = buildStorefrontNav(["hero", "services"], RETAIL_BLUEPRINT, capabilities, tenant);

    expect(nav.map((entry) => entry.key)).not.toContain("services");
  });

  it("inclut une page dont la capacité est vraie, même si sa section n'est pas activée sur la page d'accueil", () => {
    // Le catalogue existe toujours en tant que PAGE même si le commerçant
    // a désactivé la section "products" de sa page d'accueil.
    const tenant = makeTenant();
    const capabilities = makeCapabilities({ hasProducts: true, hasContactDetails: true });
    const nav = buildStorefrontNav(["hero", "about"], RETAIL_BLUEPRINT, capabilities, tenant);

    expect(nav.map((entry) => entry.key)).toContain("catalog");
  });

  it("ne produit jamais de doublon quand plusieurs sections pointent vers la même page (team/testimonials/about -> 'about')", () => {
    const tenant = makeTenant({ description: "Une jolie boutique" });
    const capabilities = makeCapabilities({ hasTestimonials: true, hasTeam: true });
    const nav = buildStorefrontNav(["hero", "about", "team", "testimonials"], RETAIL_BLUEPRINT, capabilities, tenant);

    const aboutEntries = nav.filter((entry) => entry.key === "about");
    expect(aboutEntries).toHaveLength(1);
  });

  it("chaque entrée pointe vers le chemin déclaré dans STOREFRONT_PATHS", () => {
    const tenant = makeTenant({ address: "Douala" });
    const capabilities = makeCapabilities({ hasProducts: true, hasContactDetails: true });
    const nav = buildStorefrontNav(["hero", "products"], RETAIL_BLUEPRINT, capabilities, tenant);

    for (const entry of nav) {
      expect(entry.href).toBe(STOREFRONT_PATHS[entry.key]);
    }
  });

  it("un tenant sans aucune capacité n'obtient que 'Accueil'", () => {
    const tenant = makeTenant();
    const capabilities = makeCapabilities();
    const nav = buildStorefrontNav(["hero"], RETAIL_BLUEPRINT, capabilities, tenant);

    expect(nav.map((entry) => entry.key)).toEqual(["home"]);
  });
});

describe("resolveStorefrontHighlights", () => {
  it("highlights === null -> retombe sur les promesses par défaut du secteur, filtrées sur ce qui est vérifiable", () => {
    // Le blueprint retail a 4 promesses par défaut : 3 sans dépendance
    // (toujours affichées) + 1 qui exige `whatsapp` explicitement (celle
    // dont le texte dit littéralement "Écrivez-nous sur WhatsApp").
    const withoutWhatsapp = makeCapabilities({ hasWhatsApp: false });
    const result = resolveStorefrontHighlights({ highlights: null }, RETAIL_BLUEPRINT, withoutWhatsapp);

    expect(result).toHaveLength(3);
    expect(result.every((h) => h.requires !== "whatsapp")).toBe(true);
  });

  it("highlights === null -> une promesse avec `requires` non satisfait est retirée du résultat", () => {
    const genericBlueprint = STOREFRONT_BLUEPRINTS[""];
    const withoutWhatsapp = makeCapabilities({ hasWhatsApp: false });
    const result = resolveStorefrontHighlights({ highlights: null }, genericBlueprint, withoutWhatsapp);

    expect(result.some((h) => h.requires === "whatsapp")).toBe(false);
  });

  it("highlights === null -> la promesse réapparaît une fois sa dépendance satisfaite", () => {
    const genericBlueprint = STOREFRONT_BLUEPRINTS[""];
    const withWhatsapp = makeCapabilities({ hasWhatsApp: true });
    const result = resolveStorefrontHighlights({ highlights: null }, genericBlueprint, withWhatsapp);

    expect(result.some((h) => h.requires === "whatsapp")).toBe(true);
  });

  /**
   * Régression : le premier jet de `resolveStorefrontHighlights` filtrait
   * par ICÔNE plutôt que par le champ `requires` explicite de la
   * promesse. "Délais annoncés" (professional_services ; renommée "Prochaines
   * étapes visibles" au polish V15, même icône, toujours sans `requires`) partage l'icône
   * `clock` avec la promesse générique d'horaires de boutique, mais son
   * texte parle de délais de projet — aucune dépendance aux horaires. Un
   * filtre par icône l'aurait masquée chez tout cabinet de conseil sans
   * horaires renseignés, ce qui n'a pas de sens pour ce type d'activité.
   */
  it("une promesse qui partage une icône avec une autre secteur ne doit PAS hériter de sa dépendance — seul `requires` compte", () => {
    const servicesBlueprint = STOREFRONT_BLUEPRINTS.professional_services;
    const noOpeningHours = makeCapabilities({ hasOpeningHours: false });
    const result = resolveStorefrontHighlights({ highlights: null }, servicesBlueprint, noOpeningHours);

    expect(result.some((h) => h.title === "Prochaines étapes visibles")).toBe(true);
  });

  it("symétriquement, 'Organiser une visite' (real_estate ; ex-'Visite organisée' à icône headset, passée à calendar au polish V15) ne dépend pas de WhatsApp", () => {
    const realEstateBlueprint = STOREFRONT_BLUEPRINTS.real_estate;
    const noWhatsapp = makeCapabilities({ hasWhatsApp: false });
    const result = resolveStorefrontHighlights({ highlights: null }, realEstateBlueprint, noWhatsapp);

    expect(result.some((h) => h.title === "Organiser une visite")).toBe(true);
  });

  it("highlights === [] -> retrait explicite du commerçant, respecté tel quel (pas de repli sur le secteur)", () => {
    const capabilities = makeCapabilities();
    const result = resolveStorefrontHighlights({ highlights: [] }, RETAIL_BLUEPRINT, capabilities);

    expect(result).toEqual([]);
  });

  it("highlights personnalisés -> retournés tels quels, sans filtrage ni fusion avec le secteur", () => {
    const custom = [{ icon: "star" as const, title: "Ma promesse", subtitle: "Sous-titre" }];
    const capabilities = makeCapabilities();
    const result = resolveStorefrontHighlights({ highlights: custom }, RETAIL_BLUEPRINT, capabilities);

    expect(result).toBe(custom);
  });
});

describe("resolveHeroLayout", () => {
  it("priorité au choix explicite du commerçant, même si un visuel existe", () => {
    const config = makeConfig({ heroLayout: "centered", heroMediaUrl: "https://example.com/hero.jpg" });
    expect(resolveHeroLayout(config, makeTenant())).toBe("centered");
  });

  it("sans choix explicite mais avec un visuel d'en-tête dédié -> 'split'", () => {
    const config = makeConfig({ heroLayout: null, heroMediaUrl: "https://example.com/hero.jpg" });
    expect(resolveHeroLayout(config, makeTenant())).toBe("split");
  });

  it("sans choix ni visuel dédié, mais avec une bannière tenant -> 'banner'", () => {
    const config = makeConfig({ heroLayout: null, heroMediaUrl: null });
    const tenant = makeTenant({ bannerUrl: "https://example.com/banner.jpg" });
    expect(resolveHeroLayout(config, tenant)).toBe("banner");
  });

  it("sans aucun visuel disponible -> 'centered' (jamais un trou visuel)", () => {
    const config = makeConfig({ heroLayout: null, heroMediaUrl: null });
    const tenant = makeTenant({ bannerUrl: null });
    expect(resolveHeroLayout(config, tenant)).toBe("centered");
  });
});

describe("resolveHeroMedia", () => {
  it("priorité au visuel d'en-tête dédié sur la bannière", () => {
    const config = makeConfig({ heroMediaUrl: "https://example.com/hero.jpg" });
    const tenant = makeTenant({ bannerUrl: "https://example.com/banner.jpg" });
    expect(resolveHeroMedia(config, tenant)).toBe("https://example.com/hero.jpg");
  });

  it("repli sur la bannière tenant si aucun visuel d'en-tête dédié", () => {
    const config = makeConfig({ heroMediaUrl: null });
    const tenant = makeTenant({ bannerUrl: "https://example.com/banner.jpg" });
    expect(resolveHeroMedia(config, tenant)).toBe("https://example.com/banner.jpg");
  });

  it("retourne null sans rien inventer quand aucun visuel n'existe", () => {
    const config = makeConfig({ heroMediaUrl: null });
    const tenant = makeTenant({ bannerUrl: null });
    expect(resolveHeroMedia(config, tenant)).toBeNull();
  });
});

describe("countCurrentPromotions", () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  it("compte une promotion sans échéance et une promotion à échéance future", () => {
    expect(
      countCurrentPromotions([
        { unit_price: 20000, compare_at_price: 25000, promotion_ends_at: null },
        { unit_price: 10000, compare_at_price: 12000, promotion_ends_at: future },
      ]),
    ).toBe(2);
  });

  it("ne compte pas une promotion dont l'échéance est dépassée — sinon le lien « Promotions » mènerait à une page vide", () => {
    expect(
      countCurrentPromotions([
        { unit_price: 20000, compare_at_price: 25000, promotion_ends_at: past },
      ]),
    ).toBe(0);
  });

  it("ne compte pas un prix barré inférieur ou égal au prix de vente (saisie erronée)", () => {
    expect(
      countCurrentPromotions([
        { unit_price: 20000, compare_at_price: 20000, promotion_ends_at: null },
        { unit_price: 20000, compare_at_price: 15000, promotion_ends_at: null },
      ]),
    ).toBe(0);
  });

  it("accepte les valeurs numériques renvoyées en chaîne par PostgREST (colonnes numeric) et l'absence de promotion_ends_at", () => {
    expect(countCurrentPromotions([{ unit_price: "20000", compare_at_price: "25000" }])).toBe(1);
  });

  it("liste vide → 0", () => {
    expect(countCurrentPromotions([])).toBe(0);
  });
});
