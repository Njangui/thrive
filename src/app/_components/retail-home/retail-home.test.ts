import { describe, expect, it } from "vitest";
import { getStorefrontBlueprint } from "@/application/config/storefront-blueprint";
import type { CatalogVideo } from "@/application/services/catalog-video-service";
import type { StorefrontCategory, StorefrontProduct } from "@/application/services/catalog-service";
import type { GalleryImage, LandingConfig, TestimonialSummary } from "@/application/services/landing-config-service";
import type { StorefrontCapabilities, StorefrontSite } from "@/application/services/storefront-service";
import type { TenantContext } from "@/infrastructure/tenant/resolve-request-tenant";
import { formatPrice } from "@/lib/format";
import {
  assignSectionTones,
  buildRetailHomeModel,
  buildShelfProducts,
  categoryColumns,
  fitCategoryCount,
  fitProductCount,
  isExternalHref,
  pickBadge,
  pickGalleryImages,
  pickSpotlight,
  productWhatsAppHref,
  resolveHeroCtas,
  shortLocation,
  summarizeRatings,
  toRetailProduct,
} from "./model";
import { buildRetailThemeStyle, contrastRatio, parseHexColor, readableTextOn } from "./theme";

// ------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------

const NO_CAPABILITIES: StorefrontCapabilities = {
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
  bookingEnabled: false,
  brandingRemoved: false,
};

interface SiteOverrides {
  tenant?: Partial<TenantContext>;
  config?: Partial<LandingConfig>;
  capabilities?: Partial<StorefrontCapabilities>;
  whatsappHref?: string | null;
  heroMediaUrl?: string | null;
  stats?: StorefrontSite["stats"];
}

function makeSite(overrides: SiteOverrides = {}): StorefrontSite {
  return {
    tenant: {
      organizationId: "org-1",
      name: "Maison Fatou",
      description: null,
      address: null,
      phone: null,
      email: null,
      whatsappNumber: null,
      bannerUrl: null,
      openingHours: {},
      ...overrides.tenant,
    } as TenantContext,
    config: { heroTitle: null, heroSubtitle: null, ctaLabel: null, ctaUrl: null, secondaryCtaLabel: null, secondaryCtaUrl: null, ...overrides.config } as LandingConfig,
    blueprint: getStorefrontBlueprint("retail"),
    sector: "retail",
    capabilities: { ...NO_CAPABILITIES, ...overrides.capabilities },
    highlights: [],
    stats: overrides.stats ?? [],
    whatsappHref: overrides.whatsappHref ?? null,
    heroMediaUrl: overrides.heroMediaUrl ?? null,
    accent: { primary: "#171714", secondary: "#D89B5D" },
  } as unknown as StorefrontSite;
}

function makeProduct(id: string, overrides: Partial<StorefrontProduct> = {}): StorefrontProduct {
  return {
    id,
    name: `Produit ${id}`,
    slug: `produit-${id}`,
    unitPrice: 10000,
    description: null,
    categoryName: "Mode",
    imageUrl: `https://demo.supabase.co/storage/${id}.jpg`,
    compareAtPrice: null,
    promotionEndsAt: null,
    discountPercent: null,
    createdAt: "2026-09-01T00:00:00Z",
    isFeatured: false,
    status: "active",
    badges: [],
    ...overrides,
  } as unknown as StorefrontProduct;
}

function makeProducts(count: number): StorefrontProduct[] {
  return Array.from({ length: count }, (_, index) => makeProduct(String(index + 1)));
}

function makeCategory(id: string, productCount = 3): StorefrontCategory {
  return { id, name: `Catégorie ${id}`, slug: `categorie-${id}`, productCount, imageUrl: null, position: 0 } as StorefrontCategory;
}

function makeTestimonial(id: string, rating: number | null): TestimonialSummary {
  return { id, authorName: `Client ${id}`, content: "Très bon accueil.", rating, displayOrder: 0 };
}

// ------------------------------------------------------------
// Nombre d'éléments : jamais de rangée orpheline
// ------------------------------------------------------------

describe("fitProductCount", () => {
  it("s'arrête sur une rangée complète de la grille à 4 colonnes", () => {
    expect(fitProductCount(0)).toBe(0);
    expect(fitProductCount(3)).toBe(3);
    expect(fitProductCount(4)).toBe(4);
    expect(fitProductCount(7)).toBe(4);
    expect(fitProductCount(8)).toBe(8);
    expect(fitProductCount(40)).toBe(8);
  });
});

describe("fitCategoryCount / categoryColumns", () => {
  it("retient 1, 2, 3, 4, 6 ou 8 vignettes", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 12].map(fitCategoryCount)).toEqual([0, 1, 2, 3, 4, 4, 6, 6, 8, 8]);
  });

  it("choisit des colonnes qui divisent exactement le nombre de vignettes", () => {
    for (const count of [1, 2, 3, 4, 6, 8]) {
      expect(count % categoryColumns(count)).toBe(0);
    }
  });
});

// ------------------------------------------------------------
// Liens et appels à l'action
// ------------------------------------------------------------

describe("isExternalHref", () => {
  it("ne considère externes que les liens http(s)", () => {
    expect(isExternalHref("https://wa.me/237600000000")).toBe(true);
    expect(isExternalHref("http://exemple.cm")).toBe(true);
    expect(isExternalHref("/produits")).toBe(false);
    expect(isExternalHref("tel:+237600000000")).toBe(false);
  });
});

describe("resolveHeroCtas", () => {
  it("mène au catalogue, puis aux promotions, quand le tenant en a", () => {
    const site = makeSite({ capabilities: { hasProducts: true, hasPromotions: true } });
    const { primary, secondary } = resolveHeroCtas(site);
    expect(primary?.href).toBe("/produits");
    expect(primary?.external).toBe(false);
    expect(secondary?.href).toBe("/promotions");
  });

  it("n'invente aucun lien : sans produit, sans WhatsApp, sans coordonnées, pas de bouton", () => {
    expect(resolveHeroCtas(makeSite())).toEqual({ primary: null, secondary: null });
  });

  it("retombe sur WhatsApp quand il n'y a pas de catalogue, et journalise ce clic", () => {
    const site = makeSite({ whatsappHref: "https://wa.me/237600000000" });
    const { primary, secondary } = resolveHeroCtas(site);
    expect(primary?.href).toBe("https://wa.me/237600000000");
    expect(primary?.external).toBe(true);
    expect(primary?.trackingId).toBe("hero_primary");
    // Même destination des deux côtés : un seul bouton.
    expect(secondary).toBeNull();
  });

  it("le libellé et le lien saisis par le commerçant priment", () => {
    const site = makeSite({
      config: { ctaLabel: "Voir la collection", ctaUrl: "https://exemple.cm/collection" },
      capabilities: { hasProducts: true },
    });
    const { primary } = resolveHeroCtas(site);
    expect(primary).toMatchObject({ label: "Voir la collection", href: "https://exemple.cm/collection", external: true });
  });

  it("ignore un lien dangereux saisi par le commerçant", () => {
    const site = makeSite({ config: { ctaUrl: "javascript:alert(1)" }, capabilities: { hasProducts: true } });
    expect(resolveHeroCtas(site).primary?.href).toBe("/produits");
  });

  it("ne renvoie vers /contact que si la page existe", () => {
    expect(resolveHeroCtas(makeSite({ capabilities: { hasContactDetails: true } })).primary?.href).toBe("/contact");
    expect(resolveHeroCtas(makeSite({ capabilities: { hasOpeningHours: true } })).primary?.href).toBe("/contact");
  });
});

describe("shortLocation", () => {
  it("garde les deux derniers éléments de l'adresse", () => {
    expect(shortLocation("Rue 1.234, Bastos, Yaoundé, Cameroun")).toBe("Yaoundé, Cameroun");
    expect(shortLocation("Douala, Cameroun")).toBe("Douala, Cameroun");
    expect(shortLocation("Bafoussam")).toBe("Bafoussam");
  });

  it("renvoie null sans adresse exploitable", () => {
    expect(shortLocation(null)).toBeNull();
    expect(shortLocation("  ,  ")).toBeNull();
  });

  it("tronque une adresse démesurée", () => {
    const label = shortLocation(`${"a".repeat(60)}, Yaoundé`);
    expect(label?.length).toBeLessThanOrEqual(48);
    expect(label?.endsWith("…")).toBe(true);
  });
});

// ------------------------------------------------------------
// Produits
// ------------------------------------------------------------

describe("pickBadge", () => {
  it("garde un seul badge, par ordre d'utilité pour l'acheteur", () => {
    const all = makeProduct("1", { badges: ["featured", "bestseller", "new", "promo", "out_of_stock"], discountPercent: 20 });
    expect(pickBadge(all, "Nouveau")).toEqual({ kind: "soldout", label: "Épuisé" });

    const promo = makeProduct("2", { badges: ["featured", "new", "promo"], discountPercent: 20 });
    expect(pickBadge(promo, "Nouveau")).toEqual({ kind: "sale", label: "-20%" });

    expect(pickBadge(makeProduct("3", { badges: ["featured", "bestseller", "new"] }), "Nouveau")?.kind).toBe("new");
    expect(pickBadge(makeProduct("4", { badges: ["featured", "bestseller"] }), "Nouveau")?.kind).toBe("best");
    expect(pickBadge(makeProduct("5", { badges: ["featured"] }), "Nouveau")?.kind).toBe("featured");
    expect(pickBadge(makeProduct("6"), "Nouveau")).toBeNull();
  });

  it("traite un statut « rupture » comme épuisé même sans badge", () => {
    expect(pickBadge(makeProduct("1", { status: "out_of_stock" }), "Nouveau")?.kind).toBe("soldout");
  });

  it("affiche « Promo » quand le pourcentage n'est pas connu", () => {
    expect(pickBadge(makeProduct("1", { badges: ["promo"], discountPercent: null }), "Nouveau")?.label).toBe("Promo");
  });
});

describe("productWhatsAppHref", () => {
  it("n'existe que si le tenant a un numéro WhatsApp", () => {
    expect(productWhatsAppHref(null, "Robe", "10 000 FCFA")).toBeNull();
    const href = productWhatsAppHref("237600000000", "Robe", "10 000 FCFA");
    expect(href).toMatch(/^https:\/\/wa\.me\/237600000000\?text=/);
    expect(decodeURIComponent(href ?? "")).toContain("Robe");
  });
});

describe("toRetailProduct", () => {
  const context = { whatsappNumber: "237600000000", newLabel: "Nouveau" };

  it("affiche l'ancien prix barré seulement si le prix de comparaison est supérieur", () => {
    const sale = toRetailProduct(makeProduct("1", { unitPrice: 8000, compareAtPrice: 10000 }), context);
    expect(sale.price).toBe(formatPrice(8000));
    expect(sale.oldPrice).toBe(formatPrice(10000));

    expect(toRetailProduct(makeProduct("2", { unitPrice: 8000, compareAtPrice: 8000 }), context).oldPrice).toBeNull();
    expect(toRetailProduct(makeProduct("3", { unitPrice: 8000, compareAtPrice: 5000 }), context).oldPrice).toBeNull();
    expect(toRetailProduct(makeProduct("4"), context).oldPrice).toBeNull();
  });

  it("n'expose une échéance que pour une vraie promotion", () => {
    const ends = "2026-10-01T00:00:00Z";
    expect(toRetailProduct(makeProduct("1", { unitPrice: 8000, compareAtPrice: 10000, promotionEndsAt: ends }), context).deadline).toBe(ends);
    expect(toRetailProduct(makeProduct("2", { promotionEndsAt: ends }), context).deadline).toBeNull();
  });

  it("retire WhatsApp et le lien sans slug d'un produit épuisé ou sans page", () => {
    const soldOut = toRetailProduct(makeProduct("1", { status: "out_of_stock" }), context);
    expect(soldOut.unavailable).toBe(true);
    expect(soldOut.whatsappHref).toBeNull();

    expect(toRetailProduct(makeProduct("2", { slug: null }), context).href).toBeNull();
    expect(toRetailProduct(makeProduct("3"), context).href).toBe("/produits/produit-3");
  });
});

describe("pickSpotlight", () => {
  it("préfère le produit mis en avant par le commerçant", () => {
    const products = [makeProduct("1"), makeProduct("2", { isFeatured: true }), makeProduct("3")];
    expect(pickSpotlight(products, null)?.id).toBe("2");
  });

  it("écarte épuisés, sans photo, sans page et la photo déjà plein cadre dans le hero", () => {
    const hero = "https://demo.supabase.co/storage/hero.jpg";
    const products = [
      makeProduct("1", { status: "out_of_stock" }),
      makeProduct("2", { imageUrl: null }),
      makeProduct("3", { slug: null }),
      makeProduct("4", { imageUrl: hero }),
      makeProduct("5"),
    ];
    expect(pickSpotlight(products, hero)?.id).toBe("5");
  });

  it("renvoie null quand rien ne convient", () => {
    expect(pickSpotlight([], null)).toBeNull();
    expect(pickSpotlight([makeProduct("1", { imageUrl: null })], null)).toBeNull();
  });
});

describe("buildShelfProducts", () => {
  it("ne répète pas les produits déjà montrés dans le bandeau d'offres", () => {
    const products = makeProducts(10);
    const shelf = buildShelfProducts(products, products.slice(0, 2));
    expect(shelf).toHaveLength(8);
    expect(shelf.map((product) => product.id)).not.toContain("1");
    expect(shelf.map((product) => product.id)).not.toContain("2");
  });

  it("garde tout le catalogue si le retrait viderait la grille", () => {
    const products = makeProducts(4);
    expect(buildShelfProducts(products, products.slice(0, 3))).toHaveLength(4);
  });
});

// ------------------------------------------------------------
// Avis et galerie
// ------------------------------------------------------------

describe("summarizeRatings", () => {
  it("ne compte que les notes réellement renseignées", () => {
    const summary = summarizeRatings([{ rating: 5 }, { rating: 4 }, { rating: null }]);
    expect(summary).toEqual({ average: "4,5", value: 4.5, count: 2 });
  });

  it("n'invente aucune note", () => {
    expect(summarizeRatings([])).toBeNull();
    expect(summarizeRatings([{ rating: null }, { rating: 0 }])).toBeNull();
  });
});

describe("pickGalleryImages", () => {
  const images = (count: number): GalleryImage[] => Array.from({ length: count }, (_, index) => ({ url: `/g/${index}.jpg`, productName: `Photo ${index}` }));

  it("ne montre pas ce que la page a déjà montré", () => {
    const result = pickGalleryImages(images(8), new Set(["/g/0.jpg", "/g/1.jpg"]));
    expect(result.map((image) => image.url)).not.toContain("/g/0.jpg");
    expect(result.map((image) => image.url)).not.toContain("/g/1.jpg");
  });

  it("disparaît sous 3 photos neuves et s'arrête à 3 ou 6", () => {
    expect(pickGalleryImages(images(2), new Set())).toEqual([]);
    expect(pickGalleryImages(images(3), new Set())).toHaveLength(3);
    expect(pickGalleryImages(images(5), new Set())).toHaveLength(3);
    expect(pickGalleryImages(images(6), new Set())).toHaveLength(6);
    expect(pickGalleryImages(images(20), new Set())).toHaveLength(6);
  });

  it("dédoublonne les URL identiques", () => {
    const duplicated: GalleryImage[] = [
      { url: "/a.jpg", productName: "A" },
      { url: "/a.jpg", productName: "A bis" },
      { url: "/b.jpg", productName: "B" },
    ];
    expect(pickGalleryImages(duplicated, new Set())).toEqual([]);
  });
});

// ------------------------------------------------------------
// Rythme des fonds
// ------------------------------------------------------------

describe("assignSectionTones", () => {
  const none = { categories: null, shelf: null, story: null, quotes: null, gallery: null, faq: null };

  it("alterne teinté / blanc sur les sections présentes, en commençant par le teinté", () => {
    const tones = assignSectionTones({ ...none, categories: {}, shelf: {}, quotes: {}, faq: {} });
    expect(tones).toEqual({ categories: "wash", shelf: "white", quotes: "wash", faq: "white" });
  });

  it("ne réserve rien aux sections absentes", () => {
    expect(assignSectionTones({ ...none, shelf: {} })).toEqual({ shelf: "wash" });
    expect(assignSectionTones(none)).toEqual({});
  });
});

// ------------------------------------------------------------
// Modèle complet
// ------------------------------------------------------------

describe("buildRetailHomeModel", () => {
  it("tenant vide : état « aperçu », exemples étiquetés, aucune galerie ni promo", () => {
    const model = buildRetailHomeModel({ site: makeSite(), products: [], categories: [], promotions: [], testimonials: [] });

    expect(model.preview).toBe(true);
    expect(model.categories?.items.every((category) => category.preview)).toBe(true);
    expect(model.shelf?.items.every((product) => product.preview && product.badge?.label === "Exemple")).toBe(true);
    expect(model.quotes?.items.every((quote) => quote.preview)).toBe(true);
    // Rien d'inventé qui ne soit pas explicitement de l'exemple :
    expect(model.quotes?.summary).toBeNull();
    expect(model.hero.spotlight).toBeNull();
    expect(model.promo).toBeNull();
    expect(model.gallery).toBeNull();
    expect(model.story).toBeNull();
    // Aucun lien vers une page qui n'existe pas encore.
    expect(model.categories?.moreHref).toBeNull();
    expect(model.shelf?.moreHref).toBeNull();
  });

  it("tenant réel : plus aucun contenu d'exemple", () => {
    const products = makeProducts(6);
    const model = buildRetailHomeModel({
      site: makeSite({ capabilities: { hasProducts: true, hasCategories: true } }),
      products,
      categories: [makeCategory("a"), makeCategory("b")],
      promotions: [],
      testimonials: [],
    });

    expect(model.preview).toBe(false);
    expect(model.shelf?.items.some((product) => product.preview)).toBe(false);
    expect(model.shelf?.items).toHaveLength(4);
    expect(model.shelf?.moreHref).toBe("/produits");
    expect(model.categories?.moreHref).toBe("/categories");
    expect(model.quotes).toBeNull();
    expect(model.promo).toBeNull();
    expect(model.hero.spotlight).not.toBeNull();
  });

  it("une seule catégorie ne fait pas une section « acheter par catégorie »", () => {
    const model = buildRetailHomeModel({
      site: makeSite({ capabilities: { hasProducts: true } }),
      products: makeProducts(4),
      categories: [makeCategory("a")],
      promotions: [],
      testimonials: [],
    });
    expect(model.categories).toBeNull();
  });

  it("le bandeau d'offres n'existe qu'avec de vraies promotions, et prend l'échéance la plus proche", () => {
    const promo = (id: string, endsAt: string | null) =>
      makeProduct(id, { unitPrice: 8000, compareAtPrice: 10000, discountPercent: 20, badges: ["promo"], promotionEndsAt: endsAt });
    const model = buildRetailHomeModel({
      site: makeSite({ capabilities: { hasProducts: true, hasPromotions: true } }),
      products: [...makeProducts(6), promo("p1", "2026-11-01T00:00:00Z"), promo("p2", "2026-10-01T00:00:00Z"), promo("p3", null)],
      categories: [],
      promotions: [promo("p1", "2026-11-01T00:00:00Z"), promo("p2", "2026-10-01T00:00:00Z"), promo("p3", null)],
      testimonials: [],
    });
    expect(model.promo?.items).toHaveLength(3);
    expect(model.promo?.deadline).toBe("2026-10-01T00:00:00Z");
    expect(model.promo?.moreHref).toBe("/promotions");
    // La sélection ne répète pas les produits en promotion.
    const shelfIds = model.shelf?.items.map((product) => product.id) ?? [];
    expect(shelfIds).not.toContain("p1");
  });

  it("pas d'échéance affichée quand aucune promotion n'en a une", () => {
    const model = buildRetailHomeModel({
      site: makeSite({ capabilities: { hasProducts: true, hasPromotions: true } }),
      products: makeProducts(5),
      categories: [],
      promotions: [makeProduct("p", { unitPrice: 8000, compareAtPrice: 10000, badges: ["promo"] })],
      testimonials: [],
    });
    expect(model.promo?.deadline).toBeNull();
  });

  it("les vidéos actives passent au modèle (3 au plus)", () => {
    const videos = Array.from({ length: 5 }, (_, index) => ({ id: `v${index}`, url: `/v${index}.mp4` }) as unknown as CatalogVideo);
    const model = buildRetailHomeModel({ site: makeSite(), products: makeProducts(4), categories: [], promotions: [], testimonials: [], videos });
    expect(model.videos).toHaveLength(3);
  });

  it("avis : moyenne réelle, jamais de note par défaut", () => {
    const withRatings = buildRetailHomeModel({
      site: makeSite(),
      products: makeProducts(4),
      categories: [],
      promotions: [],
      testimonials: [makeTestimonial("1", 5), makeTestimonial("2", 4)],
    });
    expect(withRatings.quotes?.summary?.average).toBe("4,5");

    const withoutRatings = buildRetailHomeModel({
      site: makeSite(),
      products: makeProducts(4),
      categories: [],
      promotions: [],
      testimonials: [makeTestimonial("1", null)],
    });
    expect(withoutRatings.quotes?.items).toHaveLength(1);
    expect(withoutRatings.quotes?.summary).toBeNull();
  });

  it("À propos : description réelle et/ou chiffres réels, jamais un texte générique", () => {
    const base = { products: makeProducts(4), categories: [], promotions: [], testimonials: [] };
    expect(buildRetailHomeModel({ ...base, site: makeSite() }).story).toBeNull();

    const withDescription = buildRetailHomeModel({
      ...base,
      site: makeSite({ tenant: { description: "  Créatrice de mode à Douala.  " } }),
    });
    expect(withDescription.story?.body).toBe("Créatrice de mode à Douala.");
    expect(withDescription.story?.moreHref).toBe("/a-propos");

    const statsOnly = buildRetailHomeModel({
      ...base,
      site: makeSite({ stats: [{ key: "products", value: "24", label: "produits" }] }),
    });
    expect(statsOnly.story?.body).toBeNull();
    // Pas de description → /a-propos n'existe pas.
    expect(statsOnly.story?.moreHref).toBeNull();
  });

  it("FAQ : six questions au plus, lien « toutes les questions » seulement s'il y en a davantage", () => {
    const faqs = (count: number) => Array.from({ length: count }, (_, index) => ({ id: String(index), question: `Q${index} ?`, answer: `R${index}` }));
    const site = makeSite({ capabilities: { hasFaq: true } });
    const base = { site, products: makeProducts(4), categories: [], promotions: [], testimonials: [] };

    const few = buildRetailHomeModel({ ...base, faqs: faqs(4) });
    expect(few.faq?.items).toHaveLength(4);
    expect(few.faq?.moreHref).toBeNull();

    const many = buildRetailHomeModel({ ...base, faqs: faqs(9) });
    expect(many.faq?.items).toHaveLength(6);
    expect(many.faq?.moreHref).toBe("/faq");

    expect(buildRetailHomeModel(base).faq).toBeNull();
  });

  it("clôture : ne montre que les coordonnées renseignées, horaires dans l'ordre de la semaine", () => {
    const model = buildRetailHomeModel({
      site: makeSite({
        whatsappHref: "https://wa.me/237600000000",
        tenant: {
          phone: "6 00 00 00 00",
          openingHours: { samedi: "09:00 - 14:00", lundi: "08:00 - 18:00" },
        },
        capabilities: { hasProducts: true, hasContactDetails: true },
      }),
      products: makeProducts(4),
      categories: [],
      promotions: [],
      testimonials: [],
    });

    expect(model.closing?.ctas).toHaveLength(2);
    expect(model.closing?.ctas[0]?.href).toBe("https://wa.me/237600000000");
    expect(model.closing?.info?.phoneHref).toBe("tel:600000000");
    expect(model.closing?.info?.email).toBeNull();
    expect(model.closing?.info?.address).toBeNull();
    expect(model.closing?.info?.hours.map((row) => row.day)).toEqual(["lundi", "samedi"]);
  });

  it("clôture : disparaît si on ne peut ni écrire ni trouver la boutique", () => {
    const model = buildRetailHomeModel({ site: makeSite(), products: makeProducts(4), categories: [], promotions: [], testimonials: [] });
    expect(model.closing).toBeNull();
  });

  it("le titre et le sous-titre saisis par le commerçant priment sur ceux du secteur", () => {
    const model = buildRetailHomeModel({
      site: makeSite({ config: { heroTitle: "  Robes d'été  ", heroSubtitle: "Nouvelle collection." } }),
      products: makeProducts(4),
      categories: [],
      promotions: [],
      testimonials: [],
    });
    expect(model.hero.title).toBe("Robes d'été");
    expect(model.hero.lead).toBe("Nouvelle collection.");
  });

  it("la photo du hero : celle du commerçant, sinon un produit, sinon l'aperçu", () => {
    const base = { categories: [], promotions: [], testimonials: [] };
    expect(buildRetailHomeModel({ ...base, site: makeSite({ heroMediaUrl: "https://x.test/hero.jpg" }), products: makeProducts(4) }).hero.mediaUrl).toBe(
      "https://x.test/hero.jpg",
    );
    expect(buildRetailHomeModel({ ...base, site: makeSite(), products: makeProducts(4) }).hero.mediaUrl).toBe("https://demo.supabase.co/storage/1.jpg");
    expect(buildRetailHomeModel({ ...base, site: makeSite(), products: [] }).hero.mediaUrl).toMatch(/retail-hero/);
  });
});

// ------------------------------------------------------------
// Thème : contrastes
// ------------------------------------------------------------

function color(value: string) {
  const rgb = parseHexColor(value);
  if (!rgb) throw new Error(`couleur invalide dans le test : ${value}`);
  return rgb;
}

describe("parseHexColor", () => {
  it("lit #rgb et #rrggbb, avec ou sans #", () => {
    expect(parseHexColor("#fff")).toEqual([255, 255, 255]);
    expect(parseHexColor("d89b5d")).toEqual([0xd8, 0x9b, 0x5d]);
  });

  it("refuse le reste", () => {
    expect(parseHexColor("rouge")).toBeNull();
    expect(parseHexColor("#12345")).toBeNull();
    expect(parseHexColor("")).toBeNull();
    expect(parseHexColor(null)).toBeNull();
  });
});

describe("contrastRatio / readableTextOn", () => {
  it("vaut 21 entre noir et blanc, 1 entre deux couleurs identiques", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([120, 30, 200], [120, 30, 200])).toBeCloseTo(1, 5);
  });

  it("choisit du texte blanc sur fond sombre, sombre sur fond clair", () => {
    expect(readableTextOn(color("#0b2a4a"))).toBe("#ffffff");
    expect(readableTextOn(color("#f5c400"))).not.toBe("#ffffff");
  });
});

describe("buildRetailThemeStyle", () => {
  const style = (primary: string, secondary: string) => buildRetailThemeStyle({ primary, secondary }) as Record<string, string>;

  it("expose les jetons attendus par la feuille de style", () => {
    const vars = style("#171714", "#D89B5D");
    expect(Object.keys(vars).sort()).toEqual(["--rt-accent", "--rt-accent-on-dark", "--rt-brand", "--rt-deep", "--rt-on-accent", "--rt-on-brand"]);
  });

  it("retombe sur la palette boutique par défaut si les couleurs sont invalides", () => {
    const vars = style("pas-une-couleur", "");
    expect(vars["--rt-brand"]).toBe("#171714");
    expect(vars["--rt-accent"]).toBe("#d89b5d");
  });

  // Une couleur de marque est libre : quelle que soit la palette, le texte doit rester lisible.
  const PALETTES: [string, string][] = [
    ["#171714", "#d89b5d"],
    ["#0f172a", "#10b981"],
    ["#1d4ed8", "#f59e0b"],
    ["#f5c400", "#111111"],
    ["#e11d48", "#fde68a"],
    ["#14532d", "#bef264"],
    ["#ffffff", "#ffffff"],
    ["#000000", "#000000"],
    ["#7c3aed", "#a78bfa"],
    ["#fef08a", "#fef08a"],
  ];

  it.each(PALETTES)("texte lisible sur toutes les surfaces pour %s / %s", (primary, secondary) => {
    const vars = style(primary, secondary);
    const brand = color(vars["--rt-brand"] ?? "");
    const deep = color(vars["--rt-deep"] ?? "");
    const accent = color(vars["--rt-accent"] ?? "");

    // Bouton plein sur fond clair, bouton d'accent, bandeau d'offres.
    expect(contrastRatio(brand, color(vars["--rt-on-brand"] ?? ""))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(accent, color(vars["--rt-on-accent"] ?? ""))).toBeGreaterThanOrEqual(4.5);
    // Texte blanc sur les surfaces sombres (hero, vidéos, clôture).
    expect(contrastRatio(deep, [255, 255, 255])).toBeGreaterThanOrEqual(7);
    // L'accent quand il sert de texte ou de filet sur cette surface sombre.
    expect(contrastRatio(color(vars["--rt-accent-on-dark"] ?? ""), deep)).toBeGreaterThanOrEqual(4.5);
  });

  it("remplace une couleur de marque presque blanche par l'encre (boutons pleins visibles sur fond clair)", () => {
    expect(style("#fafafa", "#d89b5d")["--rt-brand"]).toBe("#111110");
  });

  it("garde la teinte du commerçant sur la surface sombre (marine reste marine)", () => {
    const deep = color(style("#1d4ed8", "#f59e0b")["--rt-deep"] ?? "");
    const [red, , blue] = deep;
    expect(blue).toBeGreaterThan(red);
  });
});
