import type { StorefrontHighlight } from "@/application/config/storefront-blueprint";
import { sectionHeading } from "@/application/config/storefront-blueprint";
import { STOREFRONT_PATHS, categoryPath, productPath } from "@/application/config/storefront-routes";
import type { CatalogVideo } from "@/application/services/catalog-video-service";
import type { StorefrontCategory, StorefrontProduct } from "@/application/services/catalog-service";
import type { FaqItem, GalleryImage, TestimonialSummary } from "@/application/services/landing-config-service";
import type { StorefrontSite, StorefrontStat } from "@/application/services/storefront-service";
import { formatPrice } from "@/lib/format";
import { toSafeHref } from "@/lib/safe-url";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { PREVIEW_CATEGORIES, PREVIEW_HERO_IMAGE, PREVIEW_PRODUCTS, PREVIEW_QUOTES } from "./demo-data";

/**
 * MODÈLE DE VUE de la landing boutique.
 *
 * Tout ce qui est DÉCISION (quelle section apparaît, quel lien, quel
 * libellé, combien de cartes, quel badge) vit ici, en fonctions pures.
 * Les composants de `sections/` ne font qu'afficher ce que ce modèle
 * décrit — c'est ce qui permet de tester la landing sans rendre de JSX
 * (voir `retail-home.test.ts`) et de la faire évoluer sans toucher au
 * balisage.
 *
 * Trois règles tenues partout dans ce fichier :
 *  1. AUCUNE DONNÉE INVENTÉE. Une section sans matière réelle disparaît ;
 *     seul l'état « aperçu » (tenant vide) affiche du contenu d'exemple,
 *     et il est étiqueté comme tel (voir `demo-data.ts`).
 *  2. AUCUNE DESTINATION VIDE. Un lien n'est produit que si la page
 *     visée existe pour ce tenant (`site.capabilities`).
 *  3. LES RÉGLAGES DU COMMERÇANT GAGNENT. Titre, sous-titre et boutons
 *     saisis dans /dashboard/site priment sur les valeurs par défaut.
 */

// ------------------------------------------------------------
// Types de vue
// ------------------------------------------------------------

export interface RetailCta {
  label: string;
  href: string;
  /** Lien http(s) : ouvert dans un nouvel onglet et journalisé (`TrackedCtaLink`). */
  external: boolean;
  /** Identifiant d'analytique (`cta_click`) ; `null` = lien interne non journalisé. */
  trackingId: string | null;
}

export type RetailBadgeKind = "sale" | "new" | "best" | "featured" | "soldout" | "preview";

export interface RetailBadge {
  kind: RetailBadgeKind;
  label: string;
}

export interface RetailProduct {
  id: string;
  name: string;
  /** `null` = produit sans slug : la carte s'affiche sans lien (voir storefront/product-card.tsx). */
  href: string | null;
  imageUrl: string | null;
  categoryName: string | null;
  price: string;
  oldPrice: string | null;
  badge: RetailBadge | null;
  unavailable: boolean;
  /** Échéance RÉELLE de la promotion (`promotion_ends_at`), jamais simulée. */
  deadline: string | null;
  whatsappHref: string | null;
  preview: boolean;
}

export interface RetailCategory {
  id: string;
  name: string;
  href: string;
  imageUrl: string | null;
  countLabel: string;
  preview: boolean;
}

export interface RetailQuote {
  id: string;
  author: string;
  content: string;
  rating: number | null;
  preview: boolean;
}

export interface RatingSummary {
  /** Moyenne prête à afficher (« 4,8 »). */
  average: string;
  /** Même moyenne, numérique, pour dessiner les étoiles. */
  value: number;
  /** Nombre d'avis NOTÉS pris en compte. */
  count: number;
}

export interface RetailInfo {
  address: string | null;
  mapsHref: string | null;
  phone: string | null;
  phoneHref: string | null;
  email: string | null;
  hours: { day: string; range: string }[];
}

export interface RetailHomeModel {
  /** Tenant sans produit ni catégorie : des exemples étiquetés remplacent les sections vides. */
  preview: boolean;
  hero: {
    title: string;
    lead: string;
    location: string | null;
    mediaUrl: string;
    primary: RetailCta | null;
    secondary: RetailCta | null;
    spotlight: RetailProduct | null;
  };
  trust: StorefrontHighlight[];
  categories: { title: string; items: RetailCategory[]; columns: number; moreHref: string | null } | null;
  shelf: { title: string; subtitle: string; items: RetailProduct[]; moreHref: string | null; preview: boolean } | null;
  promo: { title: string; subtitle: string; items: RetailProduct[]; deadline: string | null; moreHref: string | null } | null;
  story: { title: string; body: string | null; imageUrl: string | null; facts: StorefrontStat[]; moreHref: string | null } | null;
  videos: CatalogVideo[];
  quotes: {
    title: string;
    items: RetailQuote[];
    summary: RatingSummary | null;
    preview: boolean;
  } | null;
  gallery: { title: string; items: { url: string; alt: string }[]; moreHref: string | null } | null;
  faq: { title: string; items: FaqItem[]; moreHref: string | null; cta: RetailCta | null } | null;
  closing: { title: string; lead: string; ctas: RetailCta[]; infoTitle: string; info: RetailInfo | null } | null;
}

export interface RetailHomeInput {
  site: StorefrontSite;
  products: StorefrontProduct[];
  categories: StorefrontCategory[];
  promotions: StorefrontProduct[];
  testimonials: TestimonialSummary[];
  gallery?: GalleryImage[];
  faqs?: FaqItem[];
  videos?: CatalogVideo[];
}

// ------------------------------------------------------------
// Bornes d'affichage
// ------------------------------------------------------------

const PROMO_MAX = 4;
const FAQ_VISIBLE = 6;
const QUOTES_VISIBLE = 3;
const VIDEOS_VISIBLE = 3;
/** Moins de 3 photos supplémentaires : une « galerie » n'aurait rien à montrer que la grille produits n'ait déjà montré. */
const GALLERY_MIN = 3;

const DAY_ORDER = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;

/**
 * Nombre de produits à montrer pour finir sur une rangée COMPLÈTE dans la
 * grille à 4 colonnes (2 colonnes sur mobile : 4 et 8 sont pairs aussi).
 * 5 à 7 produits en montrent 4 plutôt qu'une rangée orpheline ; le reste
 * est à un clic (« Voir toute la boutique »).
 */
export function fitProductCount(count: number): number {
  if (count >= 8) return 8;
  if (count >= 4) return 4;
  return Math.max(0, count);
}

/** Même logique pour la mosaïque de catégories : 1, 2, 3, 4, 6 ou 8 vignettes. */
export function fitCategoryCount(count: number): number {
  if (count >= 8) return 8;
  if (count >= 6) return 6;
  if (count >= 4) return 4;
  return Math.max(0, count);
}

/** Colonnes de la mosaïque de catégories (≥ 768 px) pour un nombre de vignettes retenu par `fitCategoryCount`. */
export function categoryColumns(count: number): number {
  if (count >= 8) return 4;
  if (count >= 6) return 3;
  return Math.max(1, count);
}

// ------------------------------------------------------------
// Liens et appels à l'action
// ------------------------------------------------------------

export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function makeCta(label: string, href: string, trackingId: string | null): RetailCta {
  const external = isExternalHref(href);
  // Seuls les liens externes sont journalisés : les pages internes le sont déjà par le traceur de page.
  return { label, href, external, trackingId: external ? trackingId : null };
}

/**
 * Boutons du hero. Ordre de repli du bouton principal : lien saisi par le
 * commerçant → catalogue → WhatsApp → contact. Le libellé du commerçant
 * gagne toujours ; sans lui, le libellé suit la destination réellement
 * retenue (« Découvrir la collection » ne peut pas mener à WhatsApp).
 */
export function resolveHeroCtas(site: StorefrontSite): { primary: RetailCta | null; secondary: RetailCta | null } {
  const { config, blueprint, capabilities, whatsappHref } = site;
  const contactHref = capabilities.hasContactDetails || capabilities.hasOpeningHours ? STOREFRONT_PATHS.contact : null;

  const customPrimaryLabel = config.ctaLabel?.trim() || null;
  const customPrimaryHref = toSafeHref(config.ctaUrl);

  let primary: RetailCta | null = null;
  if (customPrimaryHref) {
    primary = makeCta(customPrimaryLabel ?? blueprint.primaryCtaLabel, customPrimaryHref, "hero_primary");
  } else if (capabilities.hasProducts) {
    primary = makeCta(customPrimaryLabel ?? blueprint.primaryCtaLabel, STOREFRONT_PATHS.catalog, "hero_primary");
  } else if (whatsappHref) {
    primary = makeCta(customPrimaryLabel ?? "Nous écrire sur WhatsApp", whatsappHref, "hero_primary");
  } else if (contactHref) {
    primary = makeCta(customPrimaryLabel ?? "Nous contacter", contactHref, "hero_primary");
  }

  const customSecondaryLabel = config.secondaryCtaLabel?.trim() || null;
  const customSecondaryHref = toSafeHref(config.secondaryCtaUrl);

  let secondary: RetailCta | null = null;
  if (customSecondaryHref) {
    secondary = makeCta(customSecondaryLabel ?? "En savoir plus", customSecondaryHref, "hero_secondary");
  } else if (capabilities.hasPromotions) {
    secondary = makeCta(customSecondaryLabel ?? blueprint.secondaryCtaLabel, STOREFRONT_PATHS.promotions, "hero_secondary");
  } else if (whatsappHref) {
    secondary = makeCta(customSecondaryLabel ?? "Commander sur WhatsApp", whatsappHref, "hero_secondary");
  }

  // Deux boutons vers la même page n'apportent rien.
  if (primary && secondary && primary.href === secondary.href) secondary = null;
  return { primary, secondary };
}

/** « Rue X, Bastos, Yaoundé, Cameroun » → « Yaoundé, Cameroun » : ce que le visiteur a besoin de savoir d'un coup d'œil. */
export function shortLocation(address: string | null | undefined): string | null {
  const parts = (address ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const label = parts.length > 2 ? parts.slice(-2).join(", ") : parts.join(", ");
  return label.length > 48 ? `${label.slice(0, 47)}…` : label;
}

// ------------------------------------------------------------
// Produits
// ------------------------------------------------------------

/**
 * Un seul badge par carte, le plus utile à l'acheteur : disponibilité
 * d'abord, puis remise, nouveauté, meilleure vente, sélection. Les badges
 * eux-mêmes sont calculés côté service (`computeProductBadges`) à partir
 * de données réelles — ici on ne fait que choisir et libeller.
 */
export function pickBadge(product: StorefrontProduct, newLabel: string): RetailBadge | null {
  if (product.status === "out_of_stock" || product.badges.includes("out_of_stock")) {
    return { kind: "soldout", label: "Épuisé" };
  }
  if (product.badges.includes("promo")) {
    const percent = product.discountPercent;
    return { kind: "sale", label: percent && percent > 0 ? `-${percent}%` : "Promo" };
  }
  if (product.badges.includes("new")) return { kind: "new", label: newLabel };
  if (product.badges.includes("bestseller")) return { kind: "best", label: "Meilleure vente" };
  if (product.badges.includes("featured")) return { kind: "featured", label: "Sélection" };
  return null;
}

interface ProductContext {
  whatsappNumber: string | null;
  newLabel: string;
}

/** Même message pré-rempli que la fiche produit (`produits/[slug]/page.tsx`), pour des conversations homogènes. */
export function productWhatsAppHref(whatsappNumber: string | null, name: string, price: string): string | null {
  if (!whatsappNumber) return null;
  return buildWhatsAppLink(whatsappNumber, `Bonjour, je suis intéressé(e) par "${name}" (${price}).`);
}

export function toRetailProduct(product: StorefrontProduct, context: ProductContext): RetailProduct {
  const unavailable = product.status === "out_of_stock";
  const hasDiscount = product.compareAtPrice != null && product.compareAtPrice > product.unitPrice;
  const price = formatPrice(product.unitPrice);
  return {
    id: product.id,
    name: product.name,
    href: product.slug ? productPath(product.slug) : null,
    imageUrl: product.imageUrl,
    categoryName: product.categoryName,
    price,
    oldPrice: hasDiscount && product.compareAtPrice != null ? formatPrice(product.compareAtPrice) : null,
    badge: pickBadge(product, context.newLabel),
    unavailable,
    deadline: hasDiscount ? product.promotionEndsAt : null,
    whatsappHref: unavailable ? null : productWhatsAppHref(context.whatsappNumber, product.name, price),
    preview: false,
  };
}

function toPreviewProduct(preview: (typeof PREVIEW_PRODUCTS)[number], index: number): RetailProduct {
  return {
    id: `preview-product-${index}`,
    name: preview.name,
    href: STOREFRONT_PATHS.contact,
    imageUrl: preview.image,
    categoryName: preview.category,
    price: formatPrice(preview.price),
    oldPrice: null,
    badge: { kind: "preview", label: "Exemple" },
    unavailable: false,
    deadline: null,
    whatsappHref: null,
    preview: true,
  };
}

/**
 * Produit mis en avant dans le hero : épinglé par le commerçant d'abord,
 * sinon le premier disponible. Il doit être cliquable (slug), avoir une
 * photo, ne pas être épuisé, et ne pas répéter l'image déjà plein cadre
 * dans le hero.
 */
export function pickSpotlight(products: StorefrontProduct[], heroMediaUrl: string | null): StorefrontProduct | null {
  const candidates = products.filter(
    (product) =>
      Boolean(product.slug) && Boolean(product.imageUrl) && product.status !== "out_of_stock" && product.imageUrl !== heroMediaUrl,
  );
  return candidates.find((product) => product.isFeatured) ?? candidates[0] ?? null;
}

/**
 * Grille « sélection » : les produits déjà mis en avant dans le bandeau
 * d'offres n'y sont pas répétés — sauf si cela viderait la grille (petit
 * catalogue dont presque tout est en promotion).
 */
export function buildShelfProducts(products: StorefrontProduct[], promoShown: StorefrontProduct[]): StorefrontProduct[] {
  const promoIds = new Set(promoShown.map((product) => product.id));
  const others = products.filter((product) => !promoIds.has(product.id));
  const base = others.length >= Math.min(4, products.length) ? others : products;
  return base.slice(0, fitProductCount(base.length));
}

// ------------------------------------------------------------
// Avis, galerie
// ------------------------------------------------------------

/** Moyenne des notes RENSEIGNÉES uniquement (même règle que `getAverageTestimonialRating`). */
export function summarizeRatings(testimonials: { rating: number | null }[]): RatingSummary | null {
  const ratings = testimonials.map((t) => t.rating).filter((value): value is number => value != null && value > 0);
  if (ratings.length === 0) return null;
  const value = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
  return { average: value.toFixed(1).replace(".", ","), value, count: ratings.length };
}

/**
 * Photos de galerie = photos du catalogue que la page n'a PAS déjà
 * montrées. En dessous de 3, on n'affiche pas de galerie ; au-dessus, on
 * s'arrête à 3 ou 6 pour finir sur une rangée complète.
 */
export function pickGalleryImages(gallery: GalleryImage[], usedUrls: ReadonlySet<string>): { url: string; alt: string }[] {
  const seen = new Set<string>(usedUrls);
  const fresh: { url: string; alt: string }[] = [];
  for (const image of gallery) {
    if (!image.url || seen.has(image.url)) continue;
    seen.add(image.url);
    fresh.push({ url: image.url, alt: image.productName });
  }
  if (fresh.length < GALLERY_MIN) return [];
  return fresh.slice(0, fresh.length >= 6 ? 6 : 3);
}

// ------------------------------------------------------------
// Rythme des fonds
// ------------------------------------------------------------

export type SectionTone = "white" | "wash";

/** Sections à fond clair, dans l'ordre d'affichage. Le hero, les offres, les vidéos et la clôture ont leur propre fond. */
const LIGHT_SECTIONS = ["categories", "shelf", "story", "quotes", "gallery", "faq"] as const;
export type LightSection = (typeof LIGHT_SECTIONS)[number];

/**
 * Alterne fond blanc / fond teinté sur les sections claires PRÉSENTES :
 * deux sections claires qui se suivent n'ont jamais le même fond, quelles
 * que soient celles que ce tenant affiche. La première est teintée, car
 * la bande de confiance qui la précède est blanche.
 */
export function assignSectionTones(present: Readonly<Record<LightSection, unknown>>): Partial<Record<LightSection, SectionTone>> {
  const tones: Partial<Record<LightSection, SectionTone>> = {};
  let next: SectionTone = "wash";
  for (const section of LIGHT_SECTIONS) {
    if (!present[section]) continue;
    tones[section] = next;
    next = next === "wash" ? "white" : "wash";
  }
  return tones;
}

// ------------------------------------------------------------
// Assemblage
// ------------------------------------------------------------

export function buildRetailHomeModel(input: RetailHomeInput): RetailHomeModel {
  const { site, products, categories, promotions, testimonials } = input;
  const galleryImages = input.gallery ?? [];
  const faqs = input.faqs ?? [];
  const videos = input.videos ?? [];
  const { tenant, config, blueprint, capabilities } = site;

  const preview = products.length === 0 && categories.length === 0;
  const context: ProductContext = { whatsappNumber: tenant.whatsappNumber, newLabel: blueprint.newBadgeLabel };

  // ---- Hero
  const heroMediaUrl = site.heroMediaUrl ?? products.find((product) => product.imageUrl)?.imageUrl ?? PREVIEW_HERO_IMAGE;
  const { primary, secondary } = resolveHeroCtas(site);
  const spotlightSource = preview ? null : pickSpotlight(products, heroMediaUrl);

  const hero: RetailHomeModel["hero"] = {
    title: config.heroTitle?.trim() || blueprint.heroTitle(tenant.name),
    lead:
      config.heroSubtitle?.trim() ||
      (site.whatsappHref
        ? "Prix affichés, disponibilité claire. Une question ou une commande ? Écrivez-nous sur WhatsApp."
        : "Prix et disponibilité affichés pour chaque produit."),
    location: shortLocation(tenant.address),
    mediaUrl: heroMediaUrl,
    primary,
    secondary,
    spotlight: spotlightSource ? toRetailProduct(spotlightSource, context) : null,
  };

  // ---- Catégories : au moins deux, sinon « acheter par catégorie » n'a pas de sens.
  let categoryItems: RetailCategory[] = [];
  if (preview) {
    categoryItems = PREVIEW_CATEGORIES.map((category) => ({
      id: `preview-category-${category.name}`,
      name: category.name,
      href: STOREFRONT_PATHS.contact,
      imageUrl: category.image,
      countLabel: "Exemple",
      preview: true,
    }));
  } else if (categories.length >= 2) {
    categoryItems = categories.slice(0, fitCategoryCount(categories.length)).map((category) => ({
      id: category.id,
      name: category.name,
      href: categoryPath(category.slug),
      imageUrl: category.imageUrl,
      countLabel: `${category.productCount} ${category.productCount > 1 ? blueprint.catalogItemLabelPlural : blueprint.catalogItemLabel}`,
      preview: false,
    }));
  }

  // ---- Offres : uniquement de vraies promotions en cours.
  const promoSource = preview ? [] : promotions.slice(0, Math.min(PROMO_MAX, promotions.length));
  const promoItems = promoSource.map((product) => toRetailProduct(product, context));
  const deadline = promoItems
    .map((item) => item.deadline)
    .filter((value): value is string => Boolean(value))
    .sort()[0];

  // ---- Sélection
  const shelfItems: RetailProduct[] = preview
    ? PREVIEW_PRODUCTS.map(toPreviewProduct)
    : buildShelfProducts(products, promoSource).map((product) => toRetailProduct(product, context));

  // ---- À propos : la description réelle du commerçant et/ou ses chiffres réels.
  const description = tenant.description?.trim() || null;
  const storyImage =
    [tenant.bannerUrl, products[1]?.imageUrl, products[2]?.imageUrl, products[0]?.imageUrl].find(
      (url): url is string => Boolean(url) && url !== heroMediaUrl,
    ) ?? null;
  const showStory = !preview && (Boolean(description) || site.stats.length > 0);

  // ---- Galerie : seulement des photos pas encore montrées.
  const used = new Set<string>([heroMediaUrl]);
  for (const item of [...shelfItems, ...promoItems, ...(hero.spotlight ? [hero.spotlight] : [])]) {
    if (item.imageUrl) used.add(item.imageUrl);
  }
  for (const item of categoryItems) if (item.imageUrl) used.add(item.imageUrl);
  if (showStory && storyImage) used.add(storyImage);
  const galleryItems = preview ? [] : pickGalleryImages(galleryImages, used);

  // ---- Avis
  const quoteItems: RetailQuote[] = preview
    ? PREVIEW_QUOTES.map((quote, index) => ({
        id: `preview-quote-${index}`,
        author: quote.author,
        content: quote.content,
        rating: null,
        preview: true,
      }))
    : testimonials.slice(0, QUOTES_VISIBLE).map((testimonial) => ({
        id: testimonial.id,
        author: testimonial.authorName,
        content: testimonial.content,
        rating: testimonial.rating,
        preview: false,
      }));

  // ---- Contact / clôture
  const whatsappCta = site.whatsappHref ? makeCta("Discuter sur WhatsApp", site.whatsappHref, "cta_whatsapp") : null;
  const contactCta =
    capabilities.hasContactDetails || capabilities.hasOpeningHours
      ? makeCta("Nous contacter", STOREFRONT_PATHS.contact, null)
      : null;
  const catalogCta = capabilities.hasProducts ? makeCta("Voir la boutique", STOREFRONT_PATHS.catalog, null) : null;
  const closingCtas = [whatsappCta, contactCta, catalogCta].filter((cta): cta is RetailCta => cta !== null).slice(0, 2);

  const hours = DAY_ORDER.flatMap((day) => {
    const range = tenant.openingHours[day];
    return range ? [{ day, range }] : [];
  });
  const info: RetailInfo | null =
    tenant.address || tenant.phone || tenant.email || hours.length > 0
      ? {
          address: tenant.address,
          mapsHref: tenant.address
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(tenant.address)}`
            : null,
          phone: tenant.phone,
          // `tel:` sans espaces : un numéro formaté n'est pas composable tel quel par tous les navigateurs mobiles.
          phoneHref: tenant.phone ? `tel:${tenant.phone.replace(/\s/g, "")}` : null,
          email: tenant.email,
          hours,
        }
      : null;

  const faqCta = site.whatsappHref
    ? makeCta("Nous écrire sur WhatsApp", site.whatsappHref, "home_faq_whatsapp")
    : contactCta;

  return {
    preview,
    hero,
    trust: site.highlights.slice(0, 4),
    categories:
      categoryItems.length > 0
        ? {
            title: "Acheter par catégorie",
            items: categoryItems,
            columns: categoryColumns(categoryItems.length),
            moreHref: preview || !capabilities.hasCategories ? null : STOREFRONT_PATHS.categories,
          }
        : null,
    shelf:
      shelfItems.length > 0
        ? {
            title: "Notre sélection",
            subtitle: preview
              ? "Aperçu : ces produits d’exemple seront remplacés par votre catalogue."
              : "Prix et disponibilité affichés pour chaque produit.",
            items: shelfItems,
            moreHref: capabilities.hasProducts ? STOREFRONT_PATHS.catalog : null,
            preview,
          }
        : null,
    promo:
      promoItems.length > 0
        ? {
            title: sectionHeading(blueprint, "promotions", "Offres du moment"),
            subtitle: "Prix réduits sur une sélection de produits.",
            items: promoItems,
            deadline: deadline ?? null,
            moreHref: capabilities.hasPromotions ? STOREFRONT_PATHS.promotions : null,
          }
        : null,
    story: showStory
      ? {
          title: `À propos de ${tenant.name}`,
          body: description,
          imageUrl: storyImage,
          facts: site.stats,
          // `/a-propos` n'existe que si le tenant a une description, des avis ou une équipe (voir routeIsAvailable).
          moreHref: description ? STOREFRONT_PATHS.about : null,
        }
      : null,
    videos: videos.slice(0, VIDEOS_VISIBLE),
    quotes:
      quoteItems.length > 0
        ? {
            title: sectionHeading(blueprint, "testimonials", "Ce qu’en disent nos clients"),
            items: quoteItems,
            summary: preview ? null : summarizeRatings(testimonials),
            preview,
          }
        : null,
    gallery:
      galleryItems.length > 0
        ? {
            title: sectionHeading(blueprint, "gallery", "En images"),
            items: galleryItems,
            moreHref: capabilities.hasGallery ? STOREFRONT_PATHS.gallery : null,
          }
        : null,
    faq:
      faqs.length > 0
        ? {
            title: sectionHeading(blueprint, "faq", "Questions fréquentes"),
            items: faqs.slice(0, FAQ_VISIBLE),
            moreHref: faqs.length > FAQ_VISIBLE && capabilities.hasFaq ? STOREFRONT_PATHS.faq : null,
            cta: faqCta,
          }
        : null,
    closing:
      closingCtas.length > 0 || info
        ? {
            title: "Une question sur un produit ?",
            lead: `Écrivez-nous : ${tenant.name} vous répond directement, sans compte à créer.`,
            ctas: closingCtas,
            infoTitle: tenant.address ? sectionHeading(blueprint, "location", "Nous trouver") : sectionHeading(blueprint, "contact", "Informations pratiques"),
            info,
          }
        : null,
  };
}
