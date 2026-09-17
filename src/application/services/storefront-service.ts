import { cache } from "react";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import type { TenantContext } from "@/infrastructure/tenant/resolve-request-tenant";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { getLandingConfig, type LandingConfig } from "./landing-config-service";
import {
  getStorefrontBlueprint,
  resolveStorefrontSector,
  type StorefrontBlueprint,
  type StorefrontHighlight,
  type StorefrontSector,
} from "@/application/config/storefront-blueprint";
import { SECTOR_TO_PRESET, type LandingPresetKey } from "@/application/config/landing-presets";
import { SECTION_TO_ROUTE, STOREFRONT_PATHS, type StorefrontRouteKey } from "@/application/config/storefront-routes";
import type { HeroLayout, LandingSectionType, PaymentMethodKey } from "@/domain/entities/landing";
import { toSafeHref } from "@/lib/safe-url";

/**
 * ============================================================
 * MODÈLE DE SITE VITRINE
 * ============================================================
 *
 * Point d'entrée unique de tout le rendu public d'un tenant. Chaque page
 * de la vitrine (accueil, catalogue, fiche produit, catégorie, services,
 * à propos, contact, rendez-vous, FAQ, galerie) part de `getStorefrontSite()`
 * et n'a plus à re-résoudre ni le secteur, ni la configuration, ni ce que
 * le tenant possède réellement.
 *
 * Deux garanties portées ici, valables pour toutes les pages :
 *
 *  1. ON N'AFFICHE JAMAIS UNE DESTINATION VIDE. `capabilities` est une
 *     photo de ce qui existe VRAIMENT en base pour ce tenant. Le menu, le
 *     pied de page, les liens croisés et le sitemap en découlent — pas
 *     l'inverse. Un salon sans galerie n'a pas d'entrée « Réalisations »
 *     qui mène à une page vide, et Google ne se voit pas proposer une URL
 *     qui répondra 404.
 *
 *  2. AUCUN CHIFFRE INVENTÉ. `stats` ne contient que des valeurs
 *     calculées depuis la base du tenant. La bande disparaît d'elle-même
 *     en dessous de trois chiffres disponibles, plutôt que d'afficher un
 *     compteur bidon.
 */

export interface StorefrontCapabilities {
  productCount: number;
  promotionCount: number;
  categoryCount: number;
  serviceCount: number;
  galleryCount: number;
  faqCount: number;
  testimonialCount: number;
  teamCount: number;
  hasProducts: boolean;
  hasPromotions: boolean;
  hasCategories: boolean;
  hasServices: boolean;
  hasGallery: boolean;
  hasFaq: boolean;
  hasTestimonials: boolean;
  hasTeam: boolean;
  hasLocation: boolean;
  hasContactDetails: boolean;
  hasSocialLinks: boolean;
  hasOpeningHours: boolean;
  hasWhatsApp: boolean;
}

export interface StorefrontNavEntry {
  key: StorefrontRouteKey;
  label: string;
  href: string;
}

export interface StorefrontStat {
  key: string;
  value: string;
  label: string;
}

export interface StorefrontSite {
  tenant: TenantContext;
  config: LandingConfig;
  blueprint: StorefrontBlueprint;
  sector: StorefrontSector;
  presetKey: LandingPresetKey;
  /** Sections activées et ordonnées, telles que configurées (ou telles que le preset du secteur les définit). */
  enabledSections: LandingSectionType[];
  capabilities: StorefrontCapabilities;
  nav: StorefrontNavEntry[];
  highlights: StorefrontHighlight[];
  paymentMethods: PaymentMethodKey[];
  stats: StorefrontStat[];
  announcement: string | null;
  heroLayout: HeroLayout;
  heroMediaUrl: string | null;
  accent: { primary: string; secondary: string };
  whatsappHref: string | null;
  /** Année de création de l'organisation — utilisée par le pied de page et les données structurées. */
  foundedYear: number | null;
}

// ------------------------------------------------------------
// Capacités réelles du tenant
// ------------------------------------------------------------

/**
 * Comptage `head: true` (aucune ligne transférée) avec un filtre
 * d'égalité optionnel. Un comptage indisponible ne doit jamais empêcher
 * la vitrine de s'afficher : en cas d'erreur on suppose « rien », la
 * section concernée disparaît, et le client du commerçant voit une page
 * amputée plutôt qu'une erreur 500.
 */
async function countRows(
  table: string,
  organizationId: string,
  filter?: { column: string; equals?: string | boolean; isIn?: string[] },
): Promise<number> {
  const supabase = getSupabaseServiceClient();
  let query = supabase.from(table).select("id", { count: "exact", head: true }).eq("organization_id", organizationId);

  if (filter?.isIn) query = query.in(filter.column, filter.isIn);
  else if (filter?.equals !== undefined) query = query.eq(filter.column, filter.equals);

  const { count, error } = await query;
  if (error) {
    console.error(`storefront countRows(${table}) error:`, error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * Une seule photo des capacités par requête HTTP (mémoïsée par `cache()`),
 * partagée par le layout, la page et le pied de page. Sans ça, chaque
 * composant qui a besoin de savoir « est-ce que ce tenant a des
 * services ? » relancerait les huit comptages.
 *
 * Tous les comptages sont des `head: true` (aucune ligne transférée) et
 * partent en parallèle : le coût est celui d'un aller-retour, pas de huit.
 */
export const getStorefrontCapabilities = cache(async function getStorefrontCapabilities(
  tenant: TenantContext,
): Promise<StorefrontCapabilities> {
  const supabase = getSupabaseServiceClient();
  const organizationId = tenant.organizationId;

  const [productCount, serviceCount, faqCount, testimonialCount, teamCount, categoryRows, promotionRows, galleryRows] =
    await Promise.all([
      countRows("products", organizationId, { column: "status", isIn: ["active", "out_of_stock"] }),
      countRows("services", organizationId, { column: "status", equals: "active" }),
      countRows("faqs", organizationId, { column: "is_active", equals: true }),
      countRows("testimonials", organizationId),
      countRows("memberships", organizationId),
      supabase
        .from("products")
        .select("category_id")
        .eq("organization_id", organizationId)
        .in("status", ["active", "out_of_stock"])
        .not("category_id", "is", null)
        .limit(1000),
      supabase
        .from("products")
        .select("unit_price, compare_at_price")
        .eq("organization_id", organizationId)
        .in("status", ["active", "out_of_stock"])
        .not("compare_at_price", "is", null)
        .limit(200),
      supabase.from("product_images").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
    ]);

  const categoryCount = new Set((categoryRows.data ?? []).map((row) => row.category_id)).size;
  // Même définition de « promotion » que partout ailleurs : un
  // compare_at_price renseigné mais inférieur au prix de vente (saisie
  // erronée courante) n'est pas une promotion.
  const promotionCount = (promotionRows.data ?? []).filter(
    (row) => Number(row.compare_at_price) > Number(row.unit_price),
  ).length;
  const galleryCount = galleryRows.count ?? 0;

  const socialLinkCount = Object.values(tenant.socialLinks).filter((url) => toSafeHref(url)).length;
  const openingHoursCount = Object.values(tenant.openingHours).filter((value) => value && value.trim()).length;

  return {
    productCount,
    promotionCount,
    categoryCount,
    serviceCount,
    galleryCount,
    faqCount,
    testimonialCount,
    teamCount,
    hasProducts: productCount > 0,
    hasPromotions: promotionCount > 0,
    hasCategories: categoryCount > 0,
    hasServices: serviceCount > 0,
    hasGallery: galleryCount > 0,
    hasFaq: faqCount > 0,
    hasTestimonials: testimonialCount > 0,
    // `memberships` contient toujours au moins le propriétaire : une
    // section « équipe » d'une seule personne sans nom ni photo
    // (profiles.full_name n'est alimenté par aucun écran, voir
    // listTeamMembers) n'apporte rien — seuil à 2.
    hasTeam: teamCount > 1,
    hasLocation: Boolean(tenant.address),
    hasContactDetails: Boolean(tenant.phone || tenant.email || tenant.whatsappNumber || tenant.address),
    hasSocialLinks: socialLinkCount > 0,
    hasOpeningHours: openingHoursCount > 0,
    hasWhatsApp: Boolean(tenant.whatsappNumber),
  };
});

// ------------------------------------------------------------
// Navigation
// ------------------------------------------------------------

/** Une page n'apparaît dans le menu que si elle a réellement quelque chose à montrer. */
function routeIsAvailable(key: StorefrontRouteKey, capabilities: StorefrontCapabilities, tenant: TenantContext): boolean {
  switch (key) {
    case "home":
      return true;
    case "catalog":
      return capabilities.hasProducts;
    case "categories":
      return capabilities.hasCategories;
    case "promotions":
      return capabilities.hasPromotions;
    case "services":
      return capabilities.hasServices;
    case "gallery":
      return capabilities.hasGallery;
    case "about":
      return Boolean(tenant.description) || capabilities.hasTestimonials || capabilities.hasTeam;
    case "booking":
      // La demande de rendez-vous n'a de sens que si quelqu'un peut la
      // recevoir : sans prestation ni canal de contact, le formulaire
      // enverrait une demande dans le vide.
      return capabilities.hasServices || capabilities.hasWhatsApp || Boolean(tenant.phone) || Boolean(tenant.email);
    case "faq":
      return capabilities.hasFaq;
    case "contact":
      return capabilities.hasContactDetails || capabilities.hasOpeningHours;
    default:
      return false;
  }
}

function routeLabel(key: StorefrontRouteKey, blueprint: StorefrontBlueprint): string {
  switch (key) {
    case "home":
      return "Accueil";
    case "catalog":
      return blueprint.catalogLabel;
    case "categories":
      return blueprint.headings.categories;
    case "promotions":
      return blueprint.headings.promotions ?? "Promotions";
    case "services":
      return blueprint.headings.services ?? "Services";
    case "gallery":
      return blueprint.headings.gallery ?? "Galerie";
    case "about":
      return "À propos";
    case "booking":
      return blueprint.headings.booking ?? "Rendez-vous";
    case "faq":
      return "FAQ";
    case "contact":
      return "Contact";
    default:
      return key;
  }
}

/**
 * Construit le menu à partir de l'ORDRE DES SECTIONS du tenant : ce que
 * le commerçant met en premier sur sa page d'accueil arrive en premier
 * dans son menu. « Accueil » est toujours en tête, « Contact » toujours
 * en fin (convention de lecture universelle, y compris quand la section
 * contact est remontée sur la page d'accueil).
 */
export function buildStorefrontNav(
  enabledSections: LandingSectionType[],
  blueprint: StorefrontBlueprint,
  capabilities: StorefrontCapabilities,
  tenant: TenantContext,
): StorefrontNavEntry[] {
  const ordered: StorefrontRouteKey[] = ["home"];

  for (const section of enabledSections) {
    const key = SECTION_TO_ROUTE[section];
    if (key && key !== "contact" && !ordered.includes(key)) ordered.push(key);
  }

  // Les pages que le secteur considère comme structurantes mais que le
  // commerçant a désactivées en tant que SECTION restent accessibles en
  // tant que PAGE : désactiver « catalogue » sur la page d'accueil ne
  // veut pas dire supprimer la boutique du site.
  for (const key of ["catalog", "services", "categories"] as const) {
    if (!ordered.includes(key)) ordered.push(key);
  }

  ordered.push("contact");

  return ordered
    .filter((key) => routeIsAvailable(key, capabilities, tenant))
    .map((key) => ({ key, label: routeLabel(key, blueprint), href: STOREFRONT_PATHS[key] }));
}

// ------------------------------------------------------------
// Bande de confiance
// ------------------------------------------------------------

/**
 * `config.highlights === null` -> le commerçant n'a jamais touché la
 * bande : on affiche les promesses par défaut de son secteur, filtrées
 * pour ne garder que celles qui sont VÉRIFIABLES sur sa vitrine (pas de
 * « Horaires affichés » chez un tenant qui n'a saisi aucun horaire, pas
 * de « Écrivez-nous sur WhatsApp » sans numéro WhatsApp).
 *
 * `config.highlights === []` -> il l'a explicitement retirée. On respecte.
 */
export function resolveStorefrontHighlights(
  config: Pick<LandingConfig, "highlights">,
  blueprint: StorefrontBlueprint,
  capabilities: StorefrontCapabilities,
): StorefrontHighlight[] {
  if (config.highlights !== null) return config.highlights;

  return blueprint.highlights.filter((highlight) => {
    switch (highlight.requires) {
      case "whatsapp":
        return capabilities.hasWhatsApp;
      case "openingHours":
        return capabilities.hasOpeningHours;
      case "location":
        return capabilities.hasLocation;
      default:
        return true;
    }
  });
}

// ------------------------------------------------------------
// Chiffres réels
// ------------------------------------------------------------

/**
 * Bande de chiffres de la page d'accueil. Rien n'est inventé : chaque
 * entrée provient d'un comptage en base ou d'une date de création. La
 * maquette de référence affiche « 10 000+ clients satisfaits » et
 * « 99% livraisons à temps » — ces valeurs ne sont pas reproductibles
 * honnêtement pour un tenant réel, elles ne sont donc pas reproduites.
 *
 * En dessous de 3 entrées, la fonction renvoie un tableau vide : une
 * bande à deux chiffres a l'air cassée, et la page se lit mieux sans.
 */
export async function getStorefrontStats(
  tenant: TenantContext,
  blueprint: StorefrontBlueprint,
  capabilities: StorefrontCapabilities,
): Promise<StorefrontStat[]> {
  const stats: StorefrontStat[] = [];

  if (capabilities.productCount > 0) {
    stats.push({
      key: "products",
      value: String(capabilities.productCount),
      label: capabilities.productCount > 1 ? blueprint.catalogItemLabelPlural : blueprint.catalogItemLabel,
    });
  }
  if (capabilities.serviceCount > 0) {
    stats.push({
      key: "services",
      value: String(capabilities.serviceCount),
      label: capabilities.serviceCount > 1 ? "prestations" : "prestation",
    });
  }
  if (capabilities.categoryCount > 1) {
    stats.push({ key: "categories", value: String(capabilities.categoryCount), label: "catégories" });
  }

  const foundedYear = await getFoundedYear(tenant.organizationId);
  if (foundedYear) {
    const years = new Date().getFullYear() - foundedYear;
    if (years >= 1) {
      stats.push({ key: "years", value: `${years}`, label: years > 1 ? "années d'activité" : "année d'activité" });
    }
  }

  if (capabilities.testimonialCount > 0) {
    const average = await getAverageTestimonialRating(tenant.organizationId);
    if (average != null) {
      stats.push({
        key: "rating",
        value: average.toFixed(1).replace(".", ","),
        label: `note moyenne (${capabilities.testimonialCount} avis)`,
      });
    } else {
      stats.push({
        key: "testimonials",
        value: String(capabilities.testimonialCount),
        label: capabilities.testimonialCount > 1 ? "avis clients" : "avis client",
      });
    }
  }

  return stats.length >= 3 ? stats.slice(0, 4) : [];
}

const getFoundedYear = cache(async function getFoundedYear(organizationId: string): Promise<number | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("created_at")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data?.created_at) return null;
  const year = new Date(data.created_at).getFullYear();
  return Number.isFinite(year) ? year : null;
});

/** Moyenne des notes RENSEIGNÉES uniquement — un témoignage sans note ne doit pas tirer la moyenne vers le bas. */
async function getAverageTestimonialRating(organizationId: string): Promise<number | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("testimonials")
    .select("rating")
    .eq("organization_id", organizationId)
    .not("rating", "is", null);
  if (error) return null;
  const ratings = (data ?? []).map((row) => Number(row.rating)).filter((value) => Number.isFinite(value) && value > 0);
  if (ratings.length === 0) return null;
  return ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
}

// ------------------------------------------------------------
// Composition de l'en-tête
// ------------------------------------------------------------

/**
 * `hero_layout` non renseigné : la composition se déduit des visuels
 * réellement disponibles plutôt que d'imposer une mise en page « texte +
 * image » qui laisserait un trou côté image chez un tenant sans photo.
 */
export function resolveHeroLayout(config: LandingConfig, tenant: TenantContext): HeroLayout {
  if (config.heroLayout) return config.heroLayout;
  if (config.heroMediaUrl) return "split";
  if (tenant.bannerUrl) return "banner";
  return "centered";
}

/** Visuel de l'en-tête, du plus spécifique au plus général. `null` = composition centrée, sans trou. */
export function resolveHeroMedia(config: LandingConfig, tenant: TenantContext): string | null {
  return config.heroMediaUrl ?? tenant.bannerUrl ?? null;
}

// ------------------------------------------------------------
// Agrégat
// ------------------------------------------------------------

/**
 * Mémoïsé par requête : le layout de la vitrine, la page rendue et le
 * pied de page appellent tous `getStorefrontSite`, ce qui ne déclenche
 * qu'un seul chargement.
 */
export const getStorefrontSite = cache(async function getStorefrontSite(
  tenant: TenantContext,
): Promise<StorefrontSite> {
  const [config, capabilities] = await Promise.all([
    getLandingConfig(tenant.organizationId, tenant.industry),
    getStorefrontCapabilities(tenant),
  ]);

  const sector = resolveStorefrontSector(tenant.industry);
  const blueprint = getStorefrontBlueprint(tenant.industry);
  const enabledSections = config.sections
    .filter((section) => section.enabled)
    .sort((a, b) => a.order - b.order)
    .map((section) => section.type);

  const [stats, foundedYear] = await Promise.all([
    config.showStats ? getStorefrontStats(tenant, blueprint, capabilities) : Promise.resolve([]),
    getFoundedYear(tenant.organizationId),
  ]);

  const announcement =
    config.announcementEnabled && config.announcement?.trim() ? config.announcement.trim() : null;

  return {
    tenant,
    config,
    blueprint,
    sector,
    presetKey: SECTOR_TO_PRESET[sector],
    enabledSections,
    capabilities,
    nav: buildStorefrontNav(enabledSections, blueprint, capabilities, tenant),
    highlights: resolveStorefrontHighlights(config, blueprint, capabilities),
    paymentMethods: config.paymentMethods ?? [],
    stats,
    announcement,
    heroLayout: resolveHeroLayout(config, tenant),
    heroMediaUrl: resolveHeroMedia(config, tenant),
    accent: {
      // Couleur du commerçant si choisie, sinon la palette par défaut de
      // son SECTEUR — jamais la même teinte pour tout le monde.
      primary: config.brandColorPrimary ?? blueprint.defaultAccent.primary,
      secondary: config.brandColorSecondary ?? blueprint.defaultAccent.secondary,
    },
    whatsappHref: tenant.whatsappNumber
      ? buildWhatsAppLink(tenant.whatsappNumber, `Bonjour ${tenant.name}, je viens de votre site.`)
      : null,
    foundedYear,
  };
});
