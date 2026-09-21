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

import type { Metadata } from "next";

export interface ResolvedSeo {
  title: string;
  description: string | undefined;
  ogImageUrl: string | undefined;
  /**
   * `true` quand l'image OG résolue est un carré (logo, photo produit) plutôt
   * qu'une bannière paysage. Sert uniquement à choisir la Twitter Card :
   * `summary_large_image` rogne un carré en 2:1, `summary` l'affiche entier.
   */
  ogImageIsSquare: boolean;
}

export interface OrganizationSeoInput {
  name: string;
  seoTitle: string | null;
  seoDescription: string | null;
  seoOgImageUrl: string | null;
  /** Description business générale (section 8) — repli avant le nom seul. */
  description?: string | null;
  /**
   * Replis d'image de partage quand `seoOgImageUrl` n'est pas renseignée.
   * Sans image, un lien de boutique collé dans WhatsApp — le canal de
   * diffusion n°1 de ces commerçants — s'affiche en texte nu. Une bannière
   * ou un logo vaut mieux que rien. `TenantContext` porte déjà ces deux
   * champs : passer le tenant tel quel suffit.
   */
  bannerUrl?: string | null;
  logoUrl?: string | null;
}

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Une balise `<meta>` tient sur UNE ligne. Les descriptions produit sont
 * saisies en textarea (et rendues avec `whitespace-pre-line` côté fiche) :
 * elles contiennent des retours à la ligne qui finiraient tels quels dans
 * `content="…"` et dans l'aperçu WhatsApp/Google.
 */
function collapseWhitespace(value: string | null | undefined): string | undefined {
  return nonEmpty(value?.replace(/\s+/g, " "));
}

/** Longueur au-delà de laquelle Google tronque de lui-même l'extrait de résultat. */
const META_DESCRIPTION_MAX_LENGTH = 160;

/**
 * Description SEO dérivée d'un texte libre (description d'entreprise ou de
 * produit) : espaces normalisés, coupée à ~160 caractères sur une frontière
 * de mot, suffixée d'une ellipse. Compte en points de code (`Array.from`)
 * pour ne jamais couper un emoji en deux — un demi-emoji est un caractère
 * invalide dans une balise.
 *
 * Réservée aux REPLIS : une `seo_description` saisie explicitement par le
 * commerçant est respectée telle quelle (espaces normalisés seulement).
 */
export function toMetaDescription(
  value: string | null | undefined,
  maxLength: number = META_DESCRIPTION_MAX_LENGTH,
): string | undefined {
  const collapsed = collapseWhitespace(value);
  if (!collapsed) return undefined;

  const chars = Array.from(collapsed);
  if (chars.length <= maxLength) return collapsed;

  const head = chars.slice(0, maxLength - 1).join("");
  const lastSpace = head.lastIndexOf(" ");
  // Ne recule jusqu'au dernier espace que s'il reste l'essentiel du texte :
  // un premier « mot » de 150 caractères (URL collée) serait sinon coupé à 3.
  const cut = lastSpace >= maxLength * 0.6 ? head.slice(0, lastSpace) : head;
  return `${cut.replace(/[\s,;:.\-–—]+$/u, "")}…`;
}

/** Vitrine (page d'accueil tenant, section 12). */
export function resolveOrganizationSeo(org: OrganizationSeoInput): ResolvedSeo {
  const explicitImage = nonEmpty(org.seoOgImageUrl);
  const bannerImage = nonEmpty(org.bannerUrl);
  const logoImage = nonEmpty(org.logoUrl);

  return {
    title: nonEmpty(org.seoTitle) ?? org.name,
    description: collapseWhitespace(org.seoDescription) ?? toMetaDescription(org.description),
    // Du plus voulu au plus générique : image SEO dédiée > bannière > logo.
    ogImageUrl: explicitImage ?? bannerImage ?? logoImage,
    ogImageIsSquare: !explicitImage && !bannerImage && Boolean(logoImage),
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

  const productImage = nonEmpty(input.productImageUrl);

  return {
    title: nonEmpty(input.productSeoTitle) ?? `${input.productName} — ${orgSeo.title}`,
    description:
      collapseWhitespace(input.productSeoDescription) ??
      toMetaDescription(input.productDescription) ??
      orgSeo.description,
    ogImageUrl: productImage ?? orgSeo.ogImageUrl,
    // Les photos produit sont carrées dans toute la vitrine (`aspect-square`).
    ogImageIsSquare: productImage ? true : orgSeo.ogImageIsSquare,
  };
}

// ------------------------------------------------------------------
// Partage social (Open Graph + Twitter Card)
// ------------------------------------------------------------------

export interface SocialMetadataInput {
  title: string;
  description: string | undefined;
  /** URL absolue de la page (celle qui fait foi : canonique). */
  url: string;
  imageUrl?: string | undefined;
  /** Voir `ResolvedSeo.ogImageIsSquare`. */
  imageIsSquare?: boolean;
  /** Nom du site affiché par Facebook/WhatsApp au-dessus du titre. */
  siteName?: string;
}

/**
 * Bloc `openGraph` + `twitter` unique pour toutes les pages publiques.
 *
 * Il existait en trois exemplaires (accueil, fiche produit, pages
 * intérieures) — et ces copies avaient déjà divergé sur ce qui manquait :
 * ni `og:site_name` ni `og:locale`. Sans `locale`, Facebook suppose
 * `en_US` pour un site 100 % français.
 *
 * Attention Next.js : `openGraph`/`twitter` d'une page REMPLACENT ceux du
 * layout parent (fusion superficielle, pas profonde) — impossible donc de
 * poser `siteName`/`locale` une fois pour toutes dans le layout racine.
 */
export function buildSocialMetadata(input: SocialMetadataInput): Pick<Metadata, "openGraph" | "twitter"> {
  const images = input.imageUrl ? [input.imageUrl] : undefined;

  return {
    openGraph: {
      type: "website",
      locale: "fr_FR",
      siteName: input.siteName,
      title: input.title,
      description: input.description,
      url: input.url,
      images,
    },
    twitter: {
      card: images && !input.imageIsSquare ? "summary_large_image" : "summary",
      title: input.title,
      description: input.description,
      images,
    },
  };
}

// ------------------------------------------------------------------
// Pagination
// ------------------------------------------------------------------

const MAX_PAGE_NUMBER = 10_000;

/**
 * `?page=` -> entier >= 1. `Number("abc") || 1` (l'ancienne forme) laissait
 * passer `1.5`, `-3` ou `1e9` : un `offset` fractionnaire ou gigantesque
 * envoyé tel quel à PostgREST. Ici, seuls les entiers décimaux valent.
 */
export function parsePageParam(value: string | null | undefined): number {
  if (!value || !/^\d{1,5}$/.test(value)) return 1;
  return Math.min(Math.max(Number(value), 1), MAX_PAGE_NUMBER);
}

/** Chemin de la page `page` d'une liste : la première page n'a JAMAIS de `?page=1` (une seule URL par contenu). */
export function withPageParam(path: string, page: number): string {
  return page > 1 ? `${path}?page=${page}` : path;
}

// ------------------------------------------------------------------
// Dates (sitemap)
// ------------------------------------------------------------------

/** Date ISO 8601 valide, ou `undefined` : mieux vaut omettre `<lastmod>` qu'y écrire une date invalide (Google ignore alors tout le champ du sitemap). */
export function toIsoDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/** La plus récente des dates valides — `lastmod` d'une page de liste = dernière modification de son contenu. */
export function latestIsoDate(values: (string | null | undefined)[]): string | undefined {
  let latest: number | undefined;
  for (const value of values) {
    const iso = toIsoDate(value);
    if (!iso) continue;
    const time = Date.parse(iso);
    if (latest === undefined || time > latest) latest = time;
  }
  return latest === undefined ? undefined : new Date(latest).toISOString();
}

// ------------------------------------------------------------------
// JSON-LD (schema.org) — au-delà du strict minimum demandé par le cahier,
// mais rien dans "Hors scope" du Lot H ne l'exclut (seuls sont exclus :
// dashboards graphiques, analytics avancées, alerting temps réel — tous
// spécifiques à la Partie 2/3). Objets simples, sérialisés par l'appelant
// via `serializeJsonLd` (JAMAIS `JSON.stringify` nu : voir ci-dessous).
// ------------------------------------------------------------------

/**
 * Sérialise un objet JSON-LD pour l'injecter dans
 * `<script type="application/ld+json" dangerouslySetInnerHTML=…>`.
 *
 * `JSON.stringify` seul est une FAILLE : il n'échappe pas `<`. Un nom de
 * boutique, une description produit ou une réponse de FAQ contenant
 * `</script><script>…</script>` ferme le bloc JSON-LD et exécute le script
 * qui suit — chez chaque visiteur de la vitrine. Ces champs sont saisis
 * par les commerçants (ou importés en CSV), et le CSP du projet autorise
 * `'unsafe-inline'` pour les scripts (hydratation Next.js), donc rien
 * d'autre n'arrête l'exécution.
 *
 * Les séquences `\uXXXX` restent du JSON valide : un parseur JSON-LD lit
 * exactement la même donnée qu'avant. `U+2028/2029` sont échappés car ce
 * sont des terminateurs de ligne en JavaScript (mais pas en JSON).
 */
export function serializeJsonLd(data: unknown): string {
  return (JSON.stringify(data) ?? "null")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const SCHEMA_ORG_DAYS: Record<string, string> = {
  lundi: "Monday",
  mardi: "Tuesday",
  mercredi: "Wednesday",
  jeudi: "Thursday",
  vendredi: "Friday",
  samedi: "Saturday",
  dimanche: "Sunday",
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

function toClockTime(hours: number, minutes: number): string | null {
  if (minutes > 59) return null;
  if (hours === 24 && minutes === 0) return "23:59";
  if (hours > 23) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Plages horaires d'une valeur libre saisie par le commerçant :
 * `"08:00-18:00"`, `"8h-18h"`, `"8h30 à 17h"`, `"8h-12h / 14h-18h"` (deux
 * plages). Toute valeur qui n'en donne pas de façon NON ambiguë
 * (`"Fermé"`, `"24h/24"`, une heure isolée, `"26h-28h"`) renvoie `[]` : on
 * omet le jour plutôt que d'inventer ou de deviner des horaires.
 */
export function parseOpeningRanges(value: string): { opens: string; closes: string }[] {
  const times: string[] = [];
  for (const match of value.matchAll(/(\d{1,2})\s?(?:h|:)(\d{2})?/gi)) {
    const time = toClockTime(Number(match[1]), match[2] ? Number(match[2]) : 0);
    if (!time) return [];
    times.push(time);
  }
  if (times.length < 2 || times.length % 2 !== 0) return [];

  const ranges: { opens: string; closes: string }[] = [];
  for (let index = 0; index < times.length; index += 2) {
    ranges.push({ opens: times[index]!, closes: times[index + 1]! });
  }
  return ranges;
}

/**
 * schema.org attend `dayOfWeek` = un jour de l'énumération `DayOfWeek`
 * (`https://schema.org/Monday`) et des heures `opens`/`closes` au format
 * `HH:MM`. La version précédente écrivait le NOM FRANÇAIS du jour
 * (`"lundi"`) et la plage brute dans `description` : valeurs que Google
 * ignore, donc aucun horaire exploitable dans la fiche locale.
 */
function buildOpeningHoursSpecification(openingHours: Record<string, string> | undefined) {
  const specifications: Record<string, unknown>[] = [];

  for (const [rawDay, rawRange] of Object.entries(openingHours ?? {})) {
    const day = SCHEMA_ORG_DAYS[rawDay.trim().toLowerCase()];
    if (!day || typeof rawRange !== "string") continue;

    for (const range of parseOpeningRanges(rawRange)) {
      specifications.push({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: `https://schema.org/${day}`,
        opens: range.opens,
        closes: range.closes,
      });
    }
  }

  return specifications;
}

/** `sameAs` : uniquement de vraies URL http(s) — `social_links` peut contenir n'importe quoi (un numéro, un @pseudo). */
function buildSameAs(socialLinks: Record<string, string> | undefined): string[] {
  const urls = new Set<string>();
  for (const value of Object.values(socialLinks ?? {})) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!/^https?:\/\//i.test(trimmed)) continue;
    try {
      new URL(trimmed);
    } catch {
      continue;
    }
    urls.add(trimmed);
  }
  return [...urls];
}

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
  /** `organizations.social_links` — seules les URL http(s) sont reprises dans `sameAs`. */
  socialLinks?: Record<string, string>;
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

  const logo = nonEmpty(input.logoUrl);
  if (logo) {
    jsonLd.image = logo;
    jsonLd.logo = logo;
  }

  if (nonEmpty(input.telephone)) jsonLd.telephone = input.telephone;
  if (nonEmpty(input.email)) jsonLd.email = input.email;
  if (nonEmpty(input.address)) {
    jsonLd.address = { "@type": "PostalAddress", streetAddress: input.address };
  }

  const hours = buildOpeningHoursSpecification(input.openingHours);
  if (hours.length > 0) jsonLd.openingHoursSpecification = hours;

  const sameAs = buildSameAs(input.socialLinks);
  if (sameAs.length > 0) jsonLd.sameAs = sameAs;

  return jsonLd;
}

/**
 * `WebSite` de la page d'accueil : c'est lui que Google lit pour afficher le
 * NOM du site (« Salon Élégance ») au-dessus du résultat, à la place du
 * nom de domaine brut (« salon-elegance.sme-os.app »).
 */
export function buildWebSiteJsonLd(input: { name: string; url: string }): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: input.name,
    url: input.url,
    inLanguage: "fr",
  };
}

/** `Organization` de la PLATEFORME (landing marketing) — distinct de celle d'un tenant, qui passe par `buildOrganizationJsonLd`. */
export function buildPlatformOrganizationJsonLd(input: {
  name: string;
  url: string;
  logoUrl?: string | null;
  description?: string | null;
}): Record<string, unknown> {
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: input.name,
    url: input.url,
  };
  if (nonEmpty(input.logoUrl)) jsonLd.logo = input.logoUrl;
  const description = nonEmpty(input.description);
  if (description) jsonLd.description = description;
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
  /** Le commerçant : `offers.seller`. Le produit lui-même n'a pas de marque connue — on n'en invente pas. */
  sellerName?: string | null;
  /** Fin d'une promotion EN COURS (date ISO). Jamais une date passée : l'appelant ne la passe que pour une promotion encore active. */
  priceValidUntil?: string | null;
  category?: string | null;
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
  const offers: Record<string, unknown> = {
    "@type": "Offer",
    url: input.url,
    priceCurrency: input.currency,
    price: input.unitPrice,
    availability: `https://schema.org/${input.availability}`,
  };

  const priceValidUntil = toIsoDate(input.priceValidUntil)?.slice(0, 10);
  if (priceValidUntil) offers.priceValidUntil = priceValidUntil;
  const sellerName = nonEmpty(input.sellerName);
  if (sellerName) offers.seller = { "@type": "Organization", name: sellerName };

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    url: input.url,
    offers,
  };

  const description = nonEmpty(input.description);
  if (description) jsonLd.description = description;
  if (input.images.length > 0) jsonLd.image = input.images;
  const category = nonEmpty(input.category);
  if (category) jsonLd.category = category;

  return jsonLd;
}

export interface ServiceJsonLdInput {
  name: string;
  description?: string | null;
  url: string;
  images?: string[];
  serviceType?: string | null;
  provider: { name: string; address?: string | null };
  price: number;
  currency: string;
  /** `offers` n'est déclaré que pour une prestation active — même règle que pour les produits. */
  available: boolean;
}

/**
 * `Service` schema.org : le pendant de `buildProductJsonLd` pour une
 * prestation. Sorti de `services/[slug]/page.tsx` (où il était construit
 * en ligne) pour être testable, et corrigé au passage : `provider.address`
 * était une chaîne brute là où Google attend un `PostalAddress`, et
 * `image` n'était pas déclarée.
 */
export function buildServiceJsonLd(input: ServiceJsonLdInput): Record<string, unknown> {
  const providerAddress = nonEmpty(input.provider.address);
  const provider: Record<string, unknown> = {
    "@type": providerAddress ? "LocalBusiness" : "Organization",
    name: input.provider.name,
  };
  if (providerAddress) provider.address = { "@type": "PostalAddress", streetAddress: providerAddress };

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: input.name,
    url: input.url,
    provider,
  };

  const description = nonEmpty(input.description);
  if (description) jsonLd.description = description;
  const serviceType = nonEmpty(input.serviceType);
  if (serviceType) jsonLd.serviceType = serviceType;
  if (input.images && input.images.length > 0) jsonLd.image = input.images;

  if (input.available && Number.isFinite(input.price)) {
    jsonLd.offers = {
      "@type": "Offer",
      url: input.url,
      price: input.price,
      priceCurrency: input.currency,
      availability: "https://schema.org/InStock",
    };
  }

  return jsonLd;
}
