/**
 * Résolution des balises SEO / Open Graph / Twitter Card / JSON-LD (Lot H,
 * Partie 1 — master prompt section 18). Fonctions PURES, testées en
 * isolation (seo.test.ts) — même pattern que
 * `formatRecentProductsForAIContext` (tenant-ai-context.ts) : la logique de
 * repli mérite un test, la lecture DB (page.tsx / produits/[slug]/page.tsx)
 * ne l'est pas.
 *
 * Règle d'or (critère d'acceptation Lot H) : JAMAIS de balise vide. Le
 * repli va toujours du plus spécifique (produit) au plus général (nom de
 * l'entreprise), jamais l'inverse. Quand vraiment rien n'est disponible
 * (ex: aucune description nulle part), on retourne `undefined` plutôt
 * qu'une chaîne vide — Next.js omet alors la balise, ce qui n'est PAS la
 * même chose qu'une balise `content=""` (l'un est absent, l'autre est vide
 * et trompeur pour un moteur de recherche).
 */

export interface ResolvedSeo {
  title: string;
  description: string | undefined;
  ogImageUrl: string | undefined;
}

export interface OrganizationSeoInput {
  name: string;
  seoTitle: string | null;
  seoDescription: string | null;
  seoOgImageUrl: string | null;
  /** Description business générale (section 8) — repli avant le nom seul. */
  description?: string | null;
}

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Vitrine (page d'accueil tenant, section 12). */
export function resolveOrganizationSeo(org: OrganizationSeoInput): ResolvedSeo {
  return {
    title: nonEmpty(org.seoTitle) ?? org.name,
    description: nonEmpty(org.seoDescription) ?? nonEmpty(org.description),
    ogImageUrl: nonEmpty(org.seoOgImageUrl),
  };
}

export interface ProductSeoInput {
  productName: string;
  productSeoTitle: string | null;
  productSeoDescription: string | null;
  productDescription: string | null;
  /** Première photo du produit, si disponible — repli d'image OG. */
  productImageUrl?: string | null;
  organization: OrganizationSeoInput;
}

/**
 * Page produit (section 12). Chaîne de repli du titre :
 * `products.seo_title` -> `"{nom produit} — {organizations.seo_title ou nom}"`
 * -- jamais juste le titre de l'organisation seul (perdrait toute
 * spécificité produit d'une page à l'autre), mais toujours en intégrant le
 * repli déjà résolu de l'organisation (critère d'acceptation : "repli
 * raisonnable sur organizations.seo_title/nom de l'entreprise").
 */
export function resolveProductSeo(input: ProductSeoInput): ResolvedSeo {
  const orgSeo = resolveOrganizationSeo(input.organization);

  return {
    title: nonEmpty(input.productSeoTitle) ?? `${input.productName} — ${orgSeo.title}`,
    description:
      nonEmpty(input.productSeoDescription) ?? nonEmpty(input.productDescription) ?? orgSeo.description,
    ogImageUrl: nonEmpty(input.productImageUrl) ?? orgSeo.ogImageUrl,
  };
}

// ------------------------------------------------------------------
// JSON-LD (schema.org) — au-delà du strict minimum demandé par le cahier,
// mais rien dans "Hors scope" du Lot H ne l'exclut (seuls sont exclus :
// dashboards graphiques, analytics avancées, alerting temps réel — tous
// spécifiques à la Partie 2/3). Objets simples, sérialisés tels quels par
// l'appelant via JSON.stringify dans un <script type="application/ld+json">.
// ------------------------------------------------------------------

export interface OrganizationJsonLdInput {
  name: string;
  description?: string | null;
  url: string;
  logoUrl?: string | null;
  telephone?: string | null;
  email?: string | null;
  address?: string | null;
  /** Clé = jour en français ("lundi"...), valeur = plage horaire libre ("08:00-18:00"). */
  openingHours?: Record<string, string>;
}

/**
 * `LocalBusiness` si une adresse est connue (plus précis pour le
 * référencement local, pertinent pour des PME camerounaises physiques),
 * sinon `Organization` — jamais inventé au-delà de ce que le tenant a
 * réellement renseigné (section 45 : "ne pas inventer de données").
 */
export function buildOrganizationJsonLd(input: OrganizationJsonLdInput): Record<string, unknown> {
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": input.address ? "LocalBusiness" : "Organization",
    name: input.name,
    url: input.url,
  };

  const description = nonEmpty(input.description);
  if (description) jsonLd.description = description;
  if (nonEmpty(input.logoUrl)) jsonLd.image = input.logoUrl;
  if (nonEmpty(input.telephone)) jsonLd.telephone = input.telephone;
  if (nonEmpty(input.email)) jsonLd.email = input.email;
  if (nonEmpty(input.address)) {
    jsonLd.address = { "@type": "PostalAddress", streetAddress: input.address };
  }

  const hours = Object.entries(input.openingHours ?? {}).filter(([, range]) => nonEmpty(range));
  if (hours.length > 0) {
    jsonLd.openingHoursSpecification = hours.map(([day, range]) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: day,
      description: range,
    }));
  }

  return jsonLd;
}

export type ProductJsonLdAvailability = "InStock" | "OutOfStock" | "PreOrder";

export interface ProductJsonLdInput {
  name: string;
  description?: string | null;
  images: string[];
  url: string;
  unitPrice: number;
  currency: string;
  availability: ProductJsonLdAvailability;
}

/**
 * `Product` + `Offer` schema.org (section 18). Le point d'appel décide de
 * NE PAS générer ce bloc pour un produit `draft`/`inactive` (voir
 * produits/[slug]/page.tsx) — on ne fait pas la promotion active auprès de
 * Google d'un produit que le commerçant a volontairement retiré ou pas
 * encore publié, même si la page reste consultable par un lien direct
 * (section 40 : ne jamais casser un lien déjà partagé).
 */
export function buildProductJsonLd(input: ProductJsonLdInput): Record<string, unknown> {
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    url: input.url,
    offers: {
      "@type": "Offer",
      url: input.url,
      priceCurrency: input.currency,
      price: input.unitPrice,
      availability: `https://schema.org/${input.availability}`,
    },
  };

  const description = nonEmpty(input.description);
  if (description) jsonLd.description = description;
  if (input.images.length > 0) jsonLd.image = input.images;

  return jsonLd;
}
