import { describe, it, expect } from "vitest";
import {
  resolveOrganizationSeo,
  resolveProductSeo,
  buildOrganizationJsonLd,
  buildProductJsonLd,
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

  it("convertit les horaires d'ouverture renseignés en OpeningHoursSpecification", () => {
    const jsonLd = buildOrganizationJsonLd({
      name: "Salon Élégance",
      url: "https://salon-elegance.sme-os.app",
      openingHours: { lundi: "08:00-18:00", dimanche: "" },
    });
    expect(jsonLd.openingHoursSpecification).toEqual([
      { "@type": "OpeningHoursSpecification", dayOfWeek: "lundi", description: "08:00-18:00" },
    ]);
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
