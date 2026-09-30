import { describe, expect, it } from "vitest";
import type { StorefrontCategory, StorefrontProduct } from "@/application/services/catalog-service";
import type { GalleryImage, TestimonialSummary } from "@/application/services/landing-config-service";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { getStorefrontBlueprint } from "@/application/config/storefront-blueprint";
import {
  averageRating,
  buildDishes,
  buildRestaurantHomeModel,
  defaultHeroLead,
  getHoursEntries,
  getPhoneHref,
  reservationChannel,
  resolveActions,
  summarizeHours,
} from "./restaurant-model";
import { dayIndex } from "../sector-shared/business-hours";
import { contrastRatio, luminance, parseHex, resolveAccentTheme } from "../sector-shared/accent-theme";

// ------------------------------------------------------------
// Fixtures : seuls les champs lus par le modèle sont renseignés.
// ------------------------------------------------------------

type SiteOverrides = {
  tenant?: Record<string, unknown>;
  config?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  whatsappHref?: string | null;
  heroMediaUrl?: string | null;
  highlights?: unknown[];
  nav?: unknown[];
};

function makeSite(o: SiteOverrides = {}): StorefrontSite {
  return {
    tenant: { organizationId: "org-1", name: "Chez Mama", description: null, bannerUrl: null, openingHours: {}, address: null, phone: null, ...o.tenant },
    config: { ctaUrl: null, ctaLabel: null, secondaryCtaUrl: null, secondaryCtaLabel: null, heroTitle: null, heroSubtitle: null, ...o.config },
    blueprint: getStorefrontBlueprint("restaurant"),
    capabilities: {
      hasProducts: false,
      hasPromotions: false,
      hasServices: false,
      hasGallery: false,
      hasContactDetails: false,
      hasOpeningHours: false,
      hasWhatsApp: false,
      bookingEnabled: false,
      ...o.capabilities,
    },
    whatsappHref: o.whatsappHref ?? null,
    heroMediaUrl: o.heroMediaUrl ?? null,
    highlights: o.highlights ?? [],
    nav: o.nav ?? [],
  } as unknown as StorefrontSite;
}

function makeProduct(n: number, overrides: Partial<StorefrontProduct> = {}): StorefrontProduct {
  return {
    id: `p${n}`,
    name: `Plat ${n}`,
    slug: `plat-${n}`,
    unitPrice: 1000 * n,
    description: `Description ${n}`,
    categoryName: null,
    imageUrl: `https://cdn.test/p${n}.jpg`,
    compareAtPrice: null,
    promotionEndsAt: null,
    discountPercent: null,
    createdAt: "2026-01-01",
    isFeatured: true,
    status: "active",
    badges: [],
    ...overrides,
  };
}

const makeProducts = (count: number, withImage = true) =>
  Array.from({ length: count }, (_, i) => makeProduct(i + 1, withImage ? {} : { imageUrl: null }));

const makeCategory = (n: number, productCount = 3): StorefrontCategory =>
  ({ id: `c${n}`, name: `Catégorie ${n}`, slug: `cat-${n}`, productCount, imageUrl: null }) as StorefrontCategory;

const makeQuote = (n: number, rating: number | null): TestimonialSummary => ({
  id: `t${n}`,
  authorName: `Client ${n}`,
  content: `Avis ${n}`,
  rating,
  displayOrder: n,
});

const emptyInput = { products: [], categories: [], testimonials: [], gallery: [] as GalleryImage[] };

// ------------------------------------------------------------
// Horaires
// ------------------------------------------------------------

describe("horaires", () => {
  it("ordonne les jours de la semaine et ignore les clés inconnues et les valeurs vides", () => {
    const entries = getHoursEntries({ samedi: "10:00 - 23:00", lundi: "11:00 - 22:00", mardi: "  ", nimporte: "x" });
    expect(entries.map((e) => e.day)).toEqual(["lundi", "samedi"]);
    expect(entries[0]).toEqual({ day: "lundi", label: "Lundi", hours: "11:00 - 22:00" });
  });

  it("tolère l'absence d'horaires", () => {
    expect(getHoursEntries(null)).toEqual([]);
    expect(getHoursEntries(undefined)).toEqual([]);
  });

  it("résume seulement quand les sept jours sont identiques", () => {
    const week = Object.fromEntries(["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"].map((d) => [d, "11:00 - 23:00"]));
    expect(summarizeHours(getHoursEntries(week))).toBe("11:00 - 23:00");
    expect(summarizeHours(getHoursEntries({ ...week, dimanche: "Fermé" }))).toBeNull();
    expect(summarizeHours(getHoursEntries({ lundi: "11:00 - 23:00" }))).toBeNull();
  });

  it("indexe le jour à partir du lundi (Date#getDay commence le dimanche)", () => {
    expect(dayIndex(new Date(2026, 8, 21))).toBe(0); // lundi
    expect(dayIndex(new Date(2026, 8, 27))).toBe(6); // dimanche
  });
});

// ------------------------------------------------------------
// Note, téléphone
// ------------------------------------------------------------

describe("note moyenne", () => {
  it("vaut null sans avis noté — jamais de 5/5 par défaut", () => {
    expect(averageRating([])).toBeNull();
    expect(averageRating([{ rating: null }, { rating: 0 }])).toBeNull();
  });

  it("ne moyenne que les avis qui portent une note", () => {
    expect(averageRating([{ rating: 5 }, { rating: 4 }, { rating: null }])).toEqual({ average: 4.5, count: 2 });
  });
});

describe("getPhoneHref", () => {
  it("nettoie le numéro et rejette les valeurs inutilisables", () => {
    expect(getPhoneHref("+237 6 12 34 56 78")).toBe("tel:+237612345678");
    expect(getPhoneHref("abc")).toBeNull();
    expect(getPhoneHref(null)).toBeNull();
  });
});

// ------------------------------------------------------------
// Boutons
// ------------------------------------------------------------

describe("resolveActions", () => {
  it("réserve en ligne quand l'offre l'inclut", () => {
    const site = makeSite({ capabilities: { bookingEnabled: true, hasServices: true, hasProducts: true } });
    const { primary, secondary } = resolveActions(site);
    expect(primary).toMatchObject({ href: "/rendez-vous", kind: "internal", label: "Réserver une table" });
    expect(secondary).toMatchObject({ href: "/produits", kind: "internal" });
  });

  it("se replie sur WhatsApp, puis sur le téléphone", () => {
    const wa = resolveActions(makeSite({ whatsappHref: "https://wa.me/237600000000" }));
    expect(wa.primary).toMatchObject({ href: "https://wa.me/237600000000", kind: "external" });

    const tel = resolveActions(makeSite({ tenant: { phone: "+237 600 000 000" } }));
    expect(tel.primary).toMatchObject({ href: "tel:+237600000000", kind: "protocol", label: "Appeler pour réserver" });
  });

  it("n'affiche aucun bouton quand aucune destination n'existe", () => {
    expect(resolveActions(makeSite())).toEqual({ primary: null, secondary: null });
  });

  it("respecte le lien et le libellé saisis par le commerçant", () => {
    const site = makeSite({ config: { ctaUrl: "https://exemple.cm/reserver", ctaLabel: "Bloquer ma table" } });
    expect(resolveActions(site).primary).toEqual({ label: "Bloquer ma table", href: "https://exemple.cm/reserver", kind: "external" });
  });

  it("ignore un lien dangereux plutôt que de le rendre", () => {
    const site = makeSite({ config: { ctaUrl: "javascript:alert(1)" }, whatsappHref: "https://wa.me/1" });
    expect(resolveActions(site).primary?.href).toBe("https://wa.me/1");
  });

  it("supprime le second bouton quand il mène au même endroit que le premier", () => {
    const site = makeSite({
      config: { ctaUrl: "/produits" },
      capabilities: { hasProducts: true },
    });
    expect(resolveActions(site).secondary).toBeNull();
  });
});

describe("sous-titre par défaut du hero", () => {
  it("décrit uniquement ce que le visiteur peut faire ici", () => {
    expect(defaultHeroLead(true, true)).toBe("Réservez une table ou découvrez la carte.");
    expect(defaultHeroLead(true, false)).toBe("Réservez votre table.");
    expect(defaultHeroLead(false, true)).toBe("Découvrez la carte.");
  });

  it("se tait quand il n'y a rien de vrai à dire", () => {
    expect(defaultHeroLead(false, false)).toBeNull();
  });

  it("ne répète pas le nom de l'établissement, déjà en titre", () => {
    const model = buildRestaurantHomeModel({ site: makeSite({ capabilities: { bookingEnabled: true, hasServices: true, hasProducts: true } }), ...emptyInput });
    expect(model.hero.lead).toBe("Réservez une table ou découvrez la carte.");
    expect(model.hero.lead).not.toContain("Chez Mama");
  });

  it("laisse la priorité au sous-titre saisi, puis à une description courte", () => {
    const typed = buildRestaurantHomeModel({ site: makeSite({ config: { heroSubtitle: "Braisé au feu de bois" }, tenant: { description: "Autre texte" } }), ...emptyInput });
    expect(typed.hero.lead).toBe("Braisé au feu de bois");
    const desc = buildRestaurantHomeModel({ site: makeSite({ tenant: { description: "Autre texte" } }), ...emptyInput });
    expect(desc.hero.lead).toBe("Autre texte");
  });
});

describe("reservationChannel", () => {
  it("reconnaît la réservation en ligne, WhatsApp et le téléphone", () => {
    expect(reservationChannel({ label: "x", href: "/rendez-vous", kind: "internal" }, null)).toBe("online");
    expect(reservationChannel({ label: "x", href: "https://wa.me/1", kind: "external" }, "https://wa.me/1")).toBe("whatsapp");
    expect(reservationChannel({ label: "x", href: "tel:+2376", kind: "protocol" }, null)).toBe("phone");
  });

  it("ne devine rien pour un lien du commerçant ou la page contact", () => {
    expect(reservationChannel({ label: "x", href: "https://autre.cm", kind: "external" }, "https://wa.me/1")).toBeNull();
    expect(reservationChannel({ label: "x", href: "/contact", kind: "internal" }, null)).toBeNull();
    expect(reservationChannel(null, null)).toBeNull();
  });
});

// ------------------------------------------------------------
// Plats
// ------------------------------------------------------------

describe("buildDishes", () => {
  const site = makeSite({ capabilities: { hasProducts: true } });

  it("ne renvoie rien sans produit", () => {
    expect(buildDishes([], site)).toBeNull();
  });

  it("vedette + liste à partir de cinq plats photographiés (six plats au plus)", () => {
    const dishes = buildDishes(makeProducts(8), site)!;
    expect(dishes.layout).toBe("feature-list");
    expect(dishes.items).toHaveLength(6);
    expect(dishes.items[0]!.name).toBe("Plat 1");
  });

  it("grille de cartes de deux à quatre plats photographiés, sans les plats sans photo", () => {
    const products = [...makeProducts(3), makeProduct(9, { imageUrl: null })];
    const dishes = buildDishes(products, site)!;
    expect(dishes.layout).toBe("cards");
    expect(dishes.items.map((d) => d.name)).toEqual(["Plat 1", "Plat 2", "Plat 3"]);
  });

  it("vedette + liste quand un seul plat est photographié mais que d'autres existent", () => {
    const dishes = buildDishes([makeProduct(1, { imageUrl: null }), makeProduct(2), makeProduct(3, { imageUrl: null })], site)!;
    expect(dishes.layout).toBe("feature-list");
    expect(dishes.items.map((d) => d.name)).toEqual(["Plat 2", "Plat 1", "Plat 3"]);
  });

  it("vedette seule quand un unique plat existe", () => {
    const dishes = buildDishes([makeProduct(1)], site)!;
    expect(dishes.layout).toBe("spotlight");
    expect(dishes.items).toHaveLength(1);
  });

  it("simple liste quand aucun plat n'est photographié", () => {
    const dishes = buildDishes(makeProducts(4, false), site)!;
    expect(dishes.layout).toBe("lines");
    expect(dishes.items).toHaveLength(4);
  });

  it("annonce la promotion, l'épuisement et les prix barrés", () => {
    const promo = makeProduct(1, { badges: ["promo", "out_of_stock"], discountPercent: 20, compareAtPrice: 1500, unitPrice: 1200 });
    const [dish] = buildDishes([promo], site)!.items;
    expect(dish!.comparePrice).toBe(1500);
    expect(dish!.badges.map((b) => b.label)).toEqual(["Épuisé", "-20 %"]);
  });

  it("ne garde pas un prix de comparaison qui n'est pas supérieur au prix", () => {
    const [dish] = buildDishes([makeProduct(1, { compareAtPrice: 500, unitPrice: 1000 })], site)!.items;
    expect(dish!.comparePrice).toBeNull();
  });

  it("renvoie vers le catalogue quand un plat n'a pas de slug", () => {
    const [dish] = buildDishes([makeProduct(1, { slug: null })], site)!.items;
    expect(dish!.href).toBe("/produits");
  });
});

// ------------------------------------------------------------
// Page complète
// ------------------------------------------------------------

describe("buildRestaurantHomeModel — commerce vierge", () => {
  const model = buildRestaurantHomeModel({ site: makeSite(), ...emptyInput });

  it("montre une carte et des avis d'exemple, clairement signalés", () => {
    expect(model.menu?.isDemo).toBe(true);
    expect(model.menu?.rows.every((row) => row.href === null)).toBe(true);
    expect(model.menu?.catalogHref).toBeNull();
    expect(model.testimonials?.isDemo).toBe(true);
    expect(model.testimonials?.rating).toBeNull();
  });

  it("ne montre ni plats, ni galerie, ni bloc réservation, ni bouton", () => {
    expect(model.dishes).toBeNull();
    expect(model.gallery).toBeNull();
    expect(model.visit).toBeNull();
    expect(model.hero.primary).toBeNull();
    expect(model.dock).toEqual([]);
  });

  it("titre le hero avec le nom réel de l'établissement", () => {
    expect(model.hero.title).toBe("Chez Mama");
    expect(model.hero.isLongTitle).toBe(false);
    expect(model.hero.imageUrl).toContain("/images/showcase/demo/");
  });
});

describe("buildRestaurantHomeModel — commerce renseigné", () => {
  it("n'invente pas de carte d'exemple quand il y a des plats mais pas de catégorie", () => {
    const model = buildRestaurantHomeModel({ site: makeSite({ capabilities: { hasProducts: true } }), ...emptyInput, products: makeProducts(3) });
    expect(model.menu).toBeNull();
    expect(model.hero.imageUrl).toBe("https://cdn.test/p1.jpg");
  });

  it("écarte les catégories vides et compte au pluriel", () => {
    const model = buildRestaurantHomeModel({
      site: makeSite({ capabilities: { hasProducts: true } }),
      ...emptyInput,
      categories: [makeCategory(1, 0), makeCategory(2, 1), makeCategory(3, 12)],
    });
    expect(model.menu?.isDemo).toBe(false);
    expect(model.menu?.rows.map((r) => r.countLabel)).toEqual(["1 plat", "12 plats"]);
    expect(model.menu?.rows[0]?.href).toBe("/categories/cat-2");
    expect(model.menu?.catalogHref).toBe("/produits");
  });

  it("préfère le titre saisi au nom, et réduit un nom très long", () => {
    const custom = buildRestaurantHomeModel({ site: makeSite({ config: { heroTitle: "Le goût du pays" } }), ...emptyInput });
    expect(custom.hero.title).toBe("Le goût du pays");

    const long = buildRestaurantHomeModel({ site: makeSite({ tenant: { name: "Restaurant Le Grand Baobab de Bastos Yaoundé" } }), ...emptyInput });
    expect(long.hero.isLongTitle).toBe(true);
  });

  it("ne répète pas la description : courte, elle sert de sous-titre ; longue, elle nourrit l'histoire", () => {
    const short = buildRestaurantHomeModel({ site: makeSite({ tenant: { description: "Cuisine du terroir, braisée au feu de bois." } }), ...emptyInput });
    expect(short.hero.lead).toBe("Cuisine du terroir, braisée au feu de bois.");
    expect(short.story?.text ?? null).toBeNull();

    const longText = "Notre histoire commence en 1998. ".repeat(12);
    const long = buildRestaurantHomeModel({ site: makeSite({ tenant: { description: longText } }), ...emptyInput });
    expect(long.hero.lead).not.toBe(longText.trim());
    expect(long.hero.lead).toBeNull();
    expect(long.story?.text).toBe(longText.trim());
  });

  it("n'utilise jamais deux fois la même photo pour le hero, l'histoire et la galerie", () => {
    const gallery: GalleryImage[] = ["hero", "banner", "g1", "g2", "g3", "g4", "g5", "p1"].map((id) => ({
      url: id === "p1" ? "https://cdn.test/p1.jpg" : `https://cdn.test/${id}.jpg`,
      productName: id,
    }));
    const model = buildRestaurantHomeModel({
      site: makeSite({
        heroMediaUrl: "https://cdn.test/hero.jpg",
        tenant: { bannerUrl: "https://cdn.test/banner.jpg", description: "Notre histoire commence en 1998. ".repeat(12) },
        capabilities: { hasProducts: true, hasGallery: true },
      }),
      ...emptyInput,
      products: makeProducts(2),
      gallery,
    });

    expect(model.hero.imageUrl).toBe("https://cdn.test/hero.jpg");
    expect(model.story?.imageUrl).toBe("https://cdn.test/banner.jpg");

    const seen = [model.hero.imageUrl, model.story?.imageUrl, ...(model.dishes?.items.map((d) => d.imageUrl) ?? []), ...(model.gallery?.images.map((i) => i.url) ?? [])];
    expect(new Set(seen).size).toBe(seen.length);
    expect(model.gallery?.images).toHaveLength(5);
    expect(model.gallery?.href).toBe("/galerie");
  });

  it("sans texte d'histoire, la photo de bannière reste disponible pour la galerie", () => {
    const gallery: GalleryImage[] = ["banner", "g1", "g2"].map((id) => ({ url: `https://cdn.test/${id}.jpg`, productName: id }));
    const model = buildRestaurantHomeModel({
      site: makeSite({ heroMediaUrl: "https://cdn.test/hero.jpg", tenant: { bannerUrl: "https://cdn.test/banner.jpg" } }),
      ...emptyInput,
      gallery,
    });
    expect(model.story).toBeNull();
    expect(model.gallery?.images).toHaveLength(3);
  });

  it("n'affiche la galerie qu'avec au moins trois photos inédites", () => {
    const gallery: GalleryImage[] = [{ url: "https://cdn.test/a.jpg", productName: "A" }, { url: "https://cdn.test/b.jpg", productName: "B" }];
    const model = buildRestaurantHomeModel({ site: makeSite(), ...emptyInput, gallery });
    expect(model.gallery).toBeNull();
  });

  it("compose la barre d'infos : adresse, horaires, téléphone — WhatsApp seulement à défaut de téléphone", () => {
    const withPhone = buildRestaurantHomeModel({
      site: makeSite({ tenant: { address: "Bastos, Yaoundé", phone: "+237 600 000 000", openingHours: { lundi: "11:00 - 22:00" } }, whatsappHref: "https://wa.me/1" }),
      ...emptyInput,
    });
    expect(withPhone.dock.map((d) => d.kind)).toEqual(["address", "hours", "phone"]);

    const withoutPhone = buildRestaurantHomeModel({ site: makeSite({ tenant: { address: "Bastos" }, whatsappHref: "https://wa.me/1" }), ...emptyInput });
    expect(withoutPhone.dock.map((d) => d.kind)).toEqual(["address", "whatsapp"]);
  });

  it("annonce le canal de réservation réellement disponible", () => {
    const online = buildRestaurantHomeModel({ site: makeSite({ capabilities: { bookingEnabled: true, hasServices: true } }), ...emptyInput });
    expect(online.visit?.lead).toBe("Réservez votre table en ligne.");

    const wa = buildRestaurantHomeModel({ site: makeSite({ whatsappHref: "https://wa.me/1" }), ...emptyInput });
    expect(wa.visit?.lead).toBe("Réservez votre table par WhatsApp.");

    const tel = buildRestaurantHomeModel({ site: makeSite({ tenant: { phone: "+237 600 000 000" } }), ...emptyInput });
    expect(tel.visit?.lead).toBe("Réservez votre table par téléphone.");
  });

  it("calcule la note à partir des seuls avis réels", () => {
    const model = buildRestaurantHomeModel({ site: makeSite(), ...emptyInput, testimonials: [makeQuote(1, 5), makeQuote(2, 4), makeQuote(3, null)] });
    expect(model.testimonials?.isDemo).toBe(false);
    expect(model.testimonials?.items).toHaveLength(3);
    expect(model.hero.rating).toEqual({ average: 4.5, count: 2 });
  });
});

// ------------------------------------------------------------
// Lisibilité de l'accent
// ------------------------------------------------------------

describe("resolveAccentTheme", () => {
  const WHITE = 1;

  it("garde un texte blanc sur une couleur foncée ou moyenne (le terracotta par défaut)", () => {
    expect(resolveAccentTheme("#C1562C")?.onAccent).toBe("#ffffff");
    expect(resolveAccentTheme("#171714")?.onAccent).toBe("#ffffff");
  });

  it("passe à un texte sombre sur un accent clair (jaune, orange vif)", () => {
    expect(resolveAccentTheme("#F5C518")?.onAccent).toBe("#1b1f1c");
    expect(resolveAccentTheme("#FFA500")?.onAccent).toBe("#1b1f1c");
  });

  it("le texte posé sur l'accent atteint au moins 4,5:1 pour toute couleur", () => {
    for (const hex of ["#C1562C", "#F5C518", "#FFA500", "#178A4C", "#5B2A86", "#FFFFFF", "#000000", "#808080", "#00BFFF"]) {
      const theme = resolveAccentTheme(hex)!;
      const accentL = luminance(parseHex(hex)!);
      const textL = luminance(parseHex(theme.onAccent)!);
      expect(contrastRatio(accentL, textL) >= 4.5).toBe(true);
    }
  });

  it("l'accent utilisé comme texte sur fond clair atteint au moins 5,2:1 avec le blanc", () => {
    for (const hex of ["#C1562C", "#F5C518", "#FFA500", "#FFFFFF", "#00BFFF", "#178A4C"]) {
      const ink = resolveAccentTheme(hex)!.ink;
      expect(contrastRatio(WHITE, luminance(parseHex(ink)!)) >= 5.2).toBe(true);
    }
  });

  it("accepte les codes courts et refuse tout ce qui n'est pas un hexadécimal", () => {
    expect(resolveAccentTheme("#fa0")).not.toBeNull();
    expect(resolveAccentTheme("rgb(1,2,3)")).toBeNull();
    expect(resolveAccentTheme("red")).toBeNull();
    expect(resolveAccentTheme(null)).toBeNull();
  });
});
