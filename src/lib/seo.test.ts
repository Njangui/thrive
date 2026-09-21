import { describe, it, expect } from "vitest";
import {
  resolveOrganizationSeo,
  resolveProductSeo,
  buildOrganizationJsonLd,
  buildProductJsonLd,
  buildServiceJsonLd,
  buildSocialMetadata,
  buildWebSiteJsonLd,
  buildPlatformOrganizationJsonLd,
  parseOpeningRanges,
  parsePageParam,
  withPageParam,
  serializeJsonLd,
  toMetaDescription,
  toIsoDate,
  latestIsoDate,
  type OrganizationSeoInput,
} from "./seo";

const ORG_FULL: OrganizationSeoInput = {
  name: "Salon Élégance",
  seoTitle: "Salon Élégance — Coiffure à Douala",
  seoDescription: "Le meilleur salon de coiffure de Douala, réservez sur WhatsApp.",
  seoOgImageUrl: "https://cdn.example.com/og.png",
  description: "Un salon de coiffure moderne au coeur de Douala.",
};

const ORG_MINIMAL: OrganizationSeoInput = {
  name: "Salon Élégance",
  seoTitle: null,
  seoDescription: null,
  seoOgImageUrl: null,
  description: null,
};

describe("resolveOrganizationSeo", () => {
  it("utilise les champs SEO dédiés quand ils sont renseignés", () => {
    const seo = resolveOrganizationSeo(ORG_FULL);
    expect(seo.title).toBe("Salon Élégance — Coiffure à Douala");
    expect(seo.description).toBe("Le meilleur salon de coiffure de Douala, réservez sur WhatsApp.");
    expect(seo.ogImageUrl).toBe("https://cdn.example.com/og.png");
  });

  it("replie sur organizations.description quand seo_description est absent", () => {
    const seo = resolveOrganizationSeo({ ...ORG_FULL, seoDescription: null });
    expect(seo.description).toBe("Un salon de coiffure moderne au coeur de Douala.");
  });

  it("replie sur le nom de l'entreprise si rien n'est renseigné — jamais de titre vide", () => {
    const seo = resolveOrganizationSeo(ORG_MINIMAL);
    expect(seo.title).toBe("Salon Élégance");
    expect(seo.title.length).toBeGreaterThan(0);
  });

  it("retourne undefined (jamais une chaîne vide) quand aucune description n'existe nulle part", () => {
    const seo = resolveOrganizationSeo(ORG_MINIMAL);
    expect(seo.description).toBeUndefined();
  });

  it("retourne undefined pour l'image OG si aucune n'est renseignée", () => {
    const seo = resolveOrganizationSeo(ORG_MINIMAL);
    expect(seo.ogImageUrl).toBeUndefined();
  });

  it("traite une chaîne composée uniquement d'espaces comme absente", () => {
    const seo = resolveOrganizationSeo({ ...ORG_MINIMAL, seoTitle: "   " });
    expect(seo.title).toBe("Salon Élégance");
  });
});

describe("resolveProductSeo", () => {
  it("utilise seo_title/seo_description du produit en priorité absolue", () => {
    const seo = resolveProductSeo({
      productName: "Coupe + Brushing",
      productSeoTitle: "Coupe + Brushing dès 5 000 FCFA",
      productSeoDescription: "Promo du mois, places limitées.",
      productDescription: "Description standard du produit.",
      organization: ORG_FULL,
    });
    expect(seo.title).toBe("Coupe + Brushing dès 5 000 FCFA");
    expect(seo.description).toBe("Promo du mois, places limitées.");
  });

  it("construit un titre '{produit} — {repli organisation}' si le produit n'a pas de seo_title", () => {
    const seo = resolveProductSeo({
      productName: "Coupe + Brushing",
      productSeoTitle: null,
      productSeoDescription: null,
      productDescription: null,
      organization: ORG_FULL,
    });
    // Le repli organisation utilisé est bien seo_title de l'org, pas juste son nom.
    expect(seo.title).toBe("Coupe + Brushing — Salon Élégance — Coiffure à Douala");
  });

  it("replie le titre sur le NOM de l'entreprise si l'org n'a pas non plus de seo_title", () => {
    const seo = resolveProductSeo({
      productName: "Coupe + Brushing",
      productSeoTitle: null,
      productSeoDescription: null,
      productDescription: null,
      organization: ORG_MINIMAL,
    });
    expect(seo.title).toBe("Coupe + Brushing — Salon Élégance");
  });

  it("replie la description : seo_description produit -> description produit -> repli organisation", () => {
    const noProductSeoDescription = resolveProductSeo({
      productName: "Coupe + Brushing",
      productSeoTitle: null,
      productSeoDescription: null,
      productDescription: "Une coupe fraîche et un brushing soigné.",
      organization: ORG_FULL,
    });
    expect(noProductSeoDescription.description).toBe("Une coupe fraîche et un brushing soigné.");

    const noDescriptionAtAllOnProduct = resolveProductSeo({
      productName: "Coupe + Brushing",
      productSeoTitle: null,
      productSeoDescription: null,
      productDescription: null,
      organization: ORG_FULL,
    });
    expect(noDescriptionAtAllOnProduct.description).toBe(ORG_FULL.seoDescription);
  });

  it("ne produit jamais de description vide même si rien n'est renseigné nulle part", () => {
    const seo = resolveProductSeo({
      productName: "Coupe + Brushing",
      productSeoTitle: null,
      productSeoDescription: null,
      productDescription: null,
      organization: ORG_MINIMAL,
    });
    expect(seo.description).toBeUndefined();
  });

  it("replie l'image OG sur la photo du produit, sinon sur l'image OG de l'organisation", () => {
    const withProductImage = resolveProductSeo({
      productName: "Coupe + Brushing",
      productSeoTitle: null,
      productSeoDescription: null,
      productDescription: null,
      productImageUrl: "https://cdn.example.com/produit.png",
      organization: ORG_FULL,
    });
    expect(withProductImage.ogImageUrl).toBe("https://cdn.example.com/produit.png");

    const withoutProductImage = resolveProductSeo({
      productName: "Coupe + Brushing",
      productSeoTitle: null,
      productSeoDescription: null,
      productDescription: null,
      organization: ORG_FULL,
    });
    expect(withoutProductImage.ogImageUrl).toBe("https://cdn.example.com/og.png");
  });
});

describe("buildOrganizationJsonLd", () => {
  it("utilise @type LocalBusiness quand une adresse est connue", () => {
    const jsonLd = buildOrganizationJsonLd({
      name: "Salon Élégance",
      url: "https://salon-elegance.sme-os.app",
      address: "Rue de la Joie, Douala",
    });
    expect(jsonLd["@type"]).toBe("LocalBusiness");
    expect(jsonLd.address).toEqual({ "@type": "PostalAddress", streetAddress: "Rue de la Joie, Douala" });
  });

  it("utilise @type Organization quand aucune adresse n'est connue — n'invente rien", () => {
    const jsonLd = buildOrganizationJsonLd({ name: "Salon Élégance", url: "https://salon-elegance.sme-os.app" });
    expect(jsonLd["@type"]).toBe("Organization");
    expect(jsonLd.address).toBeUndefined();
  });

  it("omet les champs optionnels non renseignés plutôt que d'insérer des valeurs vides", () => {
    const jsonLd = buildOrganizationJsonLd({ name: "Salon Élégance", url: "https://salon-elegance.sme-os.app" });
    expect(jsonLd.telephone).toBeUndefined();
    expect(jsonLd.email).toBeUndefined();
    expect(jsonLd.openingHoursSpecification).toBeUndefined();
  });

  it("convertit les horaires en OpeningHoursSpecification VALIDE : jour schema.org + opens/closes HH:MM", () => {
    const jsonLd = buildOrganizationJsonLd({
      name: "Salon Élégance",
      url: "https://salon-elegance.sme-os.app",
      openingHours: { lundi: "08:00-18:00", dimanche: "" },
    });
    expect(jsonLd.openingHoursSpecification).toEqual([
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "https://schema.org/Monday",
        opens: "08:00",
        closes: "18:00",
      },
    ]);
  });

  it("n'écrit JAMAIS le nom français du jour ni une plage brute — Google les ignore", () => {
    const jsonLd = buildOrganizationJsonLd({
      name: "Salon Élégance",
      url: "https://salon-elegance.sme-os.app",
      openingHours: { mardi: "8h-17h", samedi: "9h à 13h" },
    });
    const serialized = JSON.stringify(jsonLd.openingHoursSpecification);
    expect(serialized).not.toContain("mardi");
    expect(serialized).not.toContain("samedi");
    expect(serialized).not.toContain("description");
  });

  it("omet un jour dont les horaires ne sont pas interprétables plutôt que de les inventer", () => {
    const jsonLd = buildOrganizationJsonLd({
      name: "Salon Élégance",
      url: "https://salon-elegance.sme-os.app",
      openingHours: { lundi: "Fermé", mardi: "sur rendez-vous", mercredi: "24h/24" },
    });
    expect(jsonLd.openingHoursSpecification).toBeUndefined();
  });

  it("reprend logo (image + logo) et n'inclut dans sameAs que de vraies URL http(s)", () => {
    const jsonLd = buildOrganizationJsonLd({
      name: "Salon Élégance",
      url: "https://salon-elegance.sme-os.app",
      logoUrl: "https://cdn.example.com/logo.png",
      socialLinks: {
        facebook: "https://facebook.com/salon-elegance",
        instagram: "@salon_elegance",
        whatsapp: "237600000000",
        tiktok: "javascript:alert(1)",
        doublon: "https://facebook.com/salon-elegance",
      },
    });
    expect(jsonLd.image).toBe("https://cdn.example.com/logo.png");
    expect(jsonLd.logo).toBe("https://cdn.example.com/logo.png");
    expect(jsonLd.sameAs).toEqual(["https://facebook.com/salon-elegance"]);
  });

  it("n'écrit pas sameAs quand aucune URL exploitable n'existe", () => {
    const jsonLd = buildOrganizationJsonLd({
      name: "Salon Élégance",
      url: "https://salon-elegance.sme-os.app",
      socialLinks: { instagram: "@salon" },
    });
    expect(jsonLd.sameAs).toBeUndefined();
  });
});

describe("buildProductJsonLd", () => {
  it("construit un bloc Product/Offer complet avec le prix et la disponibilité", () => {
    const jsonLd = buildProductJsonLd({
      name: "Coupe + Brushing",
      description: "Une coupe fraîche et un brushing soigné.",
      images: ["https://cdn.example.com/produit.png"],
      url: "https://salon-elegance.sme-os.app/produits/coupe-brushing",
      unitPrice: 5000,
      currency: "XAF",
      availability: "InStock",
    });

    expect(jsonLd["@type"]).toBe("Product");
    expect(jsonLd.offers).toEqual({
      "@type": "Offer",
      url: "https://salon-elegance.sme-os.app/produits/coupe-brushing",
      priceCurrency: "XAF",
      price: 5000,
      availability: "https://schema.org/InStock",
    });
    expect(jsonLd.image).toEqual(["https://cdn.example.com/produit.png"]);
  });

  it("reflète correctement la disponibilité OutOfStock", () => {
    const jsonLd = buildProductJsonLd({
      name: "Coupe + Brushing",
      images: [],
      url: "https://salon-elegance.sme-os.app/produits/coupe-brushing",
      unitPrice: 5000,
      currency: "XAF",
      availability: "OutOfStock",
    });
    expect((jsonLd.offers as Record<string, unknown>).availability).toBe("https://schema.org/OutOfStock");
    expect(jsonLd.image).toBeUndefined();
  });

  it("omet la description si absente, sans jamais insérer une chaîne vide", () => {
    const jsonLd = buildProductJsonLd({
      name: "Coupe + Brushing",
      description: null,
      images: [],
      url: "https://salon-elegance.sme-os.app/produits/coupe-brushing",
      unitPrice: 5000,
      currency: "XAF",
      availability: "InStock",
    });
    expect(jsonLd.description).toBeUndefined();
  });
});

describe("resolveOrganizationSeo / resolveProductSeo — replis d'image de partage", () => {
  it("préfère l'image SEO dédiée, puis la bannière, puis le logo", () => {
    const base = { ...ORG_MINIMAL, bannerUrl: "https://cdn.example.com/banner.png", logoUrl: "https://cdn.example.com/logo.png" };

    expect(resolveOrganizationSeo({ ...base, seoOgImageUrl: "https://cdn.example.com/og.png" }).ogImageUrl).toBe(
      "https://cdn.example.com/og.png",
    );
    expect(resolveOrganizationSeo(base).ogImageUrl).toBe("https://cdn.example.com/banner.png");
    expect(resolveOrganizationSeo({ ...base, bannerUrl: null }).ogImageUrl).toBe("https://cdn.example.com/logo.png");
    expect(resolveOrganizationSeo(ORG_MINIMAL).ogImageUrl).toBeUndefined();
  });

  it("signale un logo comme image carrée (Twitter Card `summary`), pas une bannière", () => {
    expect(resolveOrganizationSeo({ ...ORG_MINIMAL, logoUrl: "https://cdn.example.com/logo.png" }).ogImageIsSquare).toBe(true);
    expect(resolveOrganizationSeo({ ...ORG_MINIMAL, bannerUrl: "https://cdn.example.com/b.png" }).ogImageIsSquare).toBe(false);
    expect(resolveOrganizationSeo(ORG_MINIMAL).ogImageIsSquare).toBe(false);
  });

  it("une photo produit l'emporte sur tout repli de l'organisation, et compte comme carrée", () => {
    const seo = resolveProductSeo({
      productName: "Sac",
      productSeoTitle: null,
      productSeoDescription: null,
      productDescription: null,
      productImageUrl: "https://cdn.example.com/sac.png",
      organization: { ...ORG_MINIMAL, bannerUrl: "https://cdn.example.com/banner.png" },
    });
    expect(seo.ogImageUrl).toBe("https://cdn.example.com/sac.png");
    expect(seo.ogImageIsSquare).toBe(true);
  });
});

describe("toMetaDescription", () => {
  it("replie les retours à la ligne et espaces multiples sur un seul espace", () => {
    expect(toMetaDescription("Sac en cuir\n\n  fait main.\t Livraison rapide.")).toBe(
      "Sac en cuir fait main. Livraison rapide.",
    );
  });

  it("retourne undefined pour une valeur vide ou blanche", () => {
    expect(toMetaDescription(null)).toBeUndefined();
    expect(toMetaDescription("   \n ")).toBeUndefined();
  });

  it("laisse intact un texte déjà assez court", () => {
    expect(toMetaDescription("Court et net.")).toBe("Court et net.");
  });

  it("coupe un texte long sur une frontière de mot, avec une ellipse, sans dépasser la limite", () => {
    const long = "mot ".repeat(100).trim();
    const result = toMetaDescription(long)!;
    expect(Array.from(result).length).toBeLessThanOrEqual(160);
    expect(result.endsWith("…")).toBe(true);
    expect(result.endsWith("mot…")).toBe(true);
  });

  it("ne coupe jamais un emoji en deux", () => {
    const result = toMetaDescription("😀".repeat(300))!;
    expect(result.endsWith("…")).toBe(true);
    // Un demi-emoji laisserait un substitut isolé (U+D800–U+DFFF) dans la chaîne.
    expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(result)).toBe(false);
  });

  it("ne réduit pas un long mot unique à quelques caractères", () => {
    const result = toMetaDescription(`a ${"x".repeat(300)}`)!;
    expect(Array.from(result).length).toBeGreaterThan(100);
  });

  it("s'applique aux replis de description, pas à une seo_description saisie explicitement", () => {
    const longDescription = "phrase ".repeat(60).trim();
    const explicit = "Une seo_description volontairement plus longue que la limite de cent soixante caractères, choisie par le commerçant lui-même pour son référencement.";
    expect(Array.from(resolveOrganizationSeo({ ...ORG_MINIMAL, description: longDescription }).description!).length).toBeLessThanOrEqual(160);
    expect(resolveOrganizationSeo({ ...ORG_MINIMAL, seoDescription: explicit }).description).toBe(explicit);
  });
});

describe("serializeJsonLd — anti-injection dans <script type=\"application/ld+json\">", () => {
  it("neutralise une fermeture </script> saisie dans un nom, une description ou une FAQ", () => {
    const hostile = { name: "Boutique</script><script>alert(document.cookie)</script>" };
    const output = serializeJsonLd(hostile);

    expect(output).not.toContain("</script>");
    expect(output).not.toContain("<script>");
    expect(output).not.toContain("<");
    expect(output).not.toContain(">");
  });

  it("reste du JSON valide et restitue EXACTEMENT la donnée d'origine", () => {
    const data = {
      name: "Café & Thé <Spécial> — l'été",
      note: "ligne\u2028séparateur\u2029paragraphe",
      nested: { list: ["</script>", "a&b"], n: 5 },
    };
    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });

  it("échappe U+2028 / U+2029 (terminateurs de ligne JavaScript, valides en JSON)", () => {
    const output = serializeJsonLd({ v: "a\u2028b\u2029c" });
    expect(output).not.toContain("\u2028");
    expect(output).not.toContain("\u2029");
  });

  it("ne lève pas et produit du JSON valide pour undefined", () => {
    expect(serializeJsonLd(undefined)).toBe("null");
  });
});

describe("parseOpeningRanges", () => {
  it.each([
    ["08:00-18:00", [{ opens: "08:00", closes: "18:00" }]],
    ["8h-18h", [{ opens: "08:00", closes: "18:00" }]],
    ["8h30 à 17h", [{ opens: "08:30", closes: "17:00" }]],
    ["de 8:00 – 12:30", [{ opens: "08:00", closes: "12:30" }]],
    ["8h-12h / 14h-18h", [{ opens: "08:00", closes: "12:00" }, { opens: "14:00", closes: "18:00" }]],
    ["0h-24h", [{ opens: "00:00", closes: "23:59" }]],
  ])("interprète %s", (input, expected) => {
    expect(parseOpeningRanges(input)).toEqual(expected);
  });

  it.each(["", "Fermé", "sur rendez-vous", "24h/24", "8h", "26h-28h", "8h61-18h", "8h-12h-14h"])(
    "renvoie [] pour la valeur ambiguë ou invalide %j — jamais d'horaire deviné",
    (input) => {
      expect(parseOpeningRanges(input)).toEqual([]);
    },
  );
});

describe("buildSocialMetadata", () => {
  const base = { title: "Sac — Boutique", description: "Un sac.", url: "https://boutique.example.com/produits/sac" };

  it("pose type, locale fr_FR et siteName (absents avant, Facebook supposait en_US)", () => {
    const { openGraph } = buildSocialMetadata({ ...base, siteName: "Boutique" });
    expect(openGraph).toMatchObject({ type: "website", locale: "fr_FR", siteName: "Boutique", url: base.url });
  });

  it("Twitter Card : summary_large_image pour une bannière, summary pour un carré ou sans image", () => {
    expect(buildSocialMetadata({ ...base, imageUrl: "https://cdn.example.com/b.png" }).twitter).toMatchObject({
      card: "summary_large_image",
    });
    expect(
      buildSocialMetadata({ ...base, imageUrl: "https://cdn.example.com/l.png", imageIsSquare: true }).twitter,
    ).toMatchObject({ card: "summary" });
    expect(buildSocialMetadata(base).twitter).toMatchObject({ card: "summary" });
  });

  it("n'écrit pas `images` quand il n'y a pas d'image (jamais un tableau vide ni une chaîne vide)", () => {
    const { openGraph, twitter } = buildSocialMetadata(base);
    expect((openGraph as { images?: unknown }).images).toBeUndefined();
    expect((twitter as { images?: unknown }).images).toBeUndefined();
  });
});

describe("parsePageParam / withPageParam", () => {
  it.each([
    [undefined, 1],
    [null, 1],
    ["", 1],
    ["1", 1],
    ["3", 3],
    ["0", 1],
    ["-2", 1],
    ["1.5", 1],
    ["abc", 1],
    ["1e9", 1],
    ["99999999", 1],
    ["99999", 10000],
  ])("parsePageParam(%j) = %d", (input, expected) => {
    expect(parsePageParam(input as string | undefined)).toBe(expected);
  });

  it("la première page n'a jamais de ?page=1 — une seule URL par contenu", () => {
    expect(withPageParam("/produits", 1)).toBe("/produits");
    expect(withPageParam("/produits", 0)).toBe("/produits");
    expect(withPageParam("/produits", 2)).toBe("/produits?page=2");
  });
});

describe("toIsoDate / latestIsoDate", () => {
  it("normalise une date valide en ISO 8601 et écarte le reste", () => {
    expect(toIsoDate("2026-09-19T10:00:00+00:00")).toBe("2026-09-19T10:00:00.000Z");
    expect(toIsoDate("pas une date")).toBeUndefined();
    expect(toIsoDate(null)).toBeUndefined();
    expect(toIsoDate("")).toBeUndefined();
  });

  it("latestIsoDate retient la plus récente et ignore les valeurs invalides", () => {
    expect(latestIsoDate(["2026-01-01T00:00:00Z", null, "n'importe quoi", "2026-09-19T00:00:00Z", "2026-05-05T00:00:00Z"])).toBe(
      "2026-09-19T00:00:00.000Z",
    );
    expect(latestIsoDate([null, "x"])).toBeUndefined();
    expect(latestIsoDate([])).toBeUndefined();
  });
});

describe("buildProductJsonLd — champs enrichis", () => {
  const input = {
    name: "Sac",
    images: [],
    url: "https://boutique.example.com/produits/sac",
    unitPrice: 15000,
    currency: "XAF",
    availability: "InStock" as const,
  };

  it("déclare le vendeur, la catégorie et la fin de promotion quand ils sont connus", () => {
    const jsonLd = buildProductJsonLd({
      ...input,
      sellerName: "Boutique",
      category: "Sacs",
      priceValidUntil: "2026-10-31T23:59:00Z",
    });
    const offers = jsonLd.offers as Record<string, unknown>;
    expect(offers.seller).toEqual({ "@type": "Organization", name: "Boutique" });
    expect(offers.priceValidUntil).toBe("2026-10-31");
    expect(jsonLd.category).toBe("Sacs");
  });

  it("n'écrit ni vendeur, ni catégorie, ni priceValidUntil quand ils sont absents ou invalides", () => {
    const jsonLd = buildProductJsonLd({ ...input, sellerName: " ", category: null, priceValidUntil: "n'importe quoi" });
    const offers = jsonLd.offers as Record<string, unknown>;
    expect(offers.seller).toBeUndefined();
    expect(offers.priceValidUntil).toBeUndefined();
    expect(jsonLd.category).toBeUndefined();
  });
});

describe("buildServiceJsonLd", () => {
  const input = {
    name: "Coupe + Brushing",
    url: "https://salon.example.com/services/coupe",
    provider: { name: "Salon Élégance", address: "Rue de la Joie, Douala" },
    price: 5000,
    currency: "XAF",
    available: true,
  };

  it("déclare le prestataire avec un PostalAddress (pas une chaîne brute) et l'offre", () => {
    const jsonLd = buildServiceJsonLd({ ...input, images: ["https://cdn.example.com/coupe.png"], serviceType: "Coiffure" });
    expect(jsonLd["@type"]).toBe("Service");
    expect(jsonLd.provider).toEqual({
      "@type": "LocalBusiness",
      name: "Salon Élégance",
      address: { "@type": "PostalAddress", streetAddress: "Rue de la Joie, Douala" },
    });
    expect(jsonLd.image).toEqual(["https://cdn.example.com/coupe.png"]);
    expect(jsonLd.serviceType).toBe("Coiffure");
    expect(jsonLd.offers).toEqual({
      "@type": "Offer",
      url: input.url,
      price: 5000,
      priceCurrency: "XAF",
      availability: "https://schema.org/InStock",
    });
  });

  it("prestataire sans adresse -> Organization, jamais un LocalBusiness inventé", () => {
    const jsonLd = buildServiceJsonLd({ ...input, provider: { name: "Salon Élégance" } });
    expect(jsonLd.provider).toEqual({ "@type": "Organization", name: "Salon Élégance" });
  });

  it("n'annonce aucune offre pour une prestation non active", () => {
    expect(buildServiceJsonLd({ ...input, available: false }).offers).toBeUndefined();
  });
});

describe("buildWebSiteJsonLd / buildPlatformOrganizationJsonLd", () => {
  it("WebSite : nom + URL + langue", () => {
    expect(buildWebSiteJsonLd({ name: "Salon Élégance", url: "https://salon.example.com" })).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Salon Élégance",
      url: "https://salon.example.com",
      inLanguage: "fr",
    });
  });

  it("Organization plateforme : omet logo/description absents", () => {
    const minimal = buildPlatformOrganizationJsonLd({ name: "CRESYVA", url: "https://cresyva.com" });
    expect(minimal.logo).toBeUndefined();
    expect(minimal.description).toBeUndefined();

    const full = buildPlatformOrganizationJsonLd({
      name: "CRESYVA",
      url: "https://cresyva.com",
      logoUrl: "https://cresyva.com/images/cresyva-mark-512.png",
      description: "Gérez votre entreprise depuis un seul endroit.",
    });
    expect(full.logo).toBe("https://cresyva.com/images/cresyva-mark-512.png");
    expect(full.description).toBe("Gérez votre entreprise depuis un seul endroit.");
  });
});
