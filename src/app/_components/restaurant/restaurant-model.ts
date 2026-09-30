import type { StorefrontCategory, StorefrontProduct } from "@/application/services/catalog-service";
import type { GalleryImage, TestimonialSummary } from "@/application/services/landing-config-service";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { sectionHeading, sectionSubheading } from "@/application/config/storefront-blueprint";
import { STOREFRONT_PATHS, categoryPath, productPath } from "@/application/config/storefront-routes";
import { toSafeHref } from "@/lib/safe-url";
import { resolveCtaTarget } from "../landing-sections/cta-target";
import { getHoursEntries, summarizeHours, type HoursEntry } from "../sector-shared/business-hours";
import { resolveAccentTheme, type AccentTheme } from "../sector-shared/accent-theme";
import { averageRating } from "../sector-shared/rating";
import { getPhoneHref } from "../sector-shared/phone";

export { getHoursEntries, summarizeHours, type HoursEntry, averageRating, getPhoneHref };

/**
 * ============================================================
 * MODÈLE DE LA PAGE D'ACCUEIL RESTAURANT
 * ============================================================
 *
 * Toute la DÉCISION (quoi afficher, dans quel ordre, avec quel repli) est
 * prise ici, dans des fonctions pures. Les composants React ne font que
 * dessiner ce que ce modèle leur donne. Avant cette réécriture, la décision
 * et le dessin étaient mélangés dans un seul composant de 40 lignes de JSX
 * imbriqué — impossible à tester, impossible à faire évoluer sans casser
 * autre chose.
 *
 * Trois règles du projet sont portées ici, pas dans le JSX :
 *  1. On n'affiche jamais une destination vide (pas de bouton vers une page
 *     qui n'existe pas, pas de catégorie sans plat).
 *  2. Aucun chiffre inventé : la note est la moyenne des avis réels.
 *  3. Le contenu d'exemple n'apparaît que lorsque le commerçant n'a encore
 *     rien renseigné, et il est toujours signalé comme tel.
 */

/**
 * Interrupteur unique du contenu d'exemple (carte et avis fictifs, signalés
 * « Exemple »). Ils donnent une page complète à un commerçant qui vient de
 * créer son site. Passer à `false` pour ne plus rien montrer de fictif aux
 * visiteurs : les blocs concernés disparaissent alors d'eux-mêmes.
 */
export const SHOW_DEMO_CONTENT = true;

const DEMO_HERO_IMAGE = "/images/showcase/demo/restaurant-story.jpg";
const DEMO_MENU = [
  { name: "Entrées", image: "/images/showcase/demo/restaurant-2.jpg" },
  { name: "Plats principaux", image: "/images/showcase/demo/restaurant-1.jpg" },
  { name: "Desserts", image: "/images/showcase/demo/restaurant-3.jpg" },
  { name: "Boissons", image: "/images/showcase/demo/restaurant-4.jpg" },
];
const DEMO_TESTIMONIALS = [
  { id: "demo-1", author: "Client exemple", content: "Une belle expérience, une carte claire et une ambiance qui donne envie de revenir.", rating: null },
  { id: "demo-2", author: "Cliente exemple", content: "La réservation et les informations pratiques sont faciles à trouver.", rating: null },
  { id: "demo-3", author: "Habitué exemple", content: "Une adresse que l'on retrouve facilement et une carte qui donne envie.", rating: null },
];

// ------------------------------------------------------------
// Types de sortie
// ------------------------------------------------------------

export interface CtaAction {
  label: string;
  href: string;
  /** `internal` = page du site ; `external` = http(s), ouvert dans un nouvel onglet et journalisé ; `protocol` = tel:, mailto:… */
  kind: "internal" | "external" | "protocol";
}

export type DockItem =
  | { kind: "address"; text: string }
  | { kind: "hours" }
  | { kind: "phone"; text: string; href: string }
  | { kind: "whatsapp"; href: string };

export interface DishBadge {
  key: "promo" | "new" | "bestseller" | "out_of_stock";
  label: string;
}

export interface DishView {
  id: string;
  name: string;
  description: string | null;
  price: number;
  comparePrice: number | null;
  imageUrl: string | null;
  href: string;
  badges: DishBadge[];
}

export interface MenuRow {
  id: string;
  name: string;
  /** `null` pour une ligne d'exemple : elle ne mène nulle part, elle n'est donc pas un lien. */
  href: string | null;
  countLabel: string | null;
  imageUrl: string | null;
}

export interface QuoteView {
  id: string;
  author: string;
  content: string;
  rating: number | null;
}

export interface RestaurantHomeInput {
  site: StorefrontSite;
  products: StorefrontProduct[];
  categories: StorefrontCategory[];
  testimonials: TestimonialSummary[];
  gallery: GalleryImage[];
}

export interface RestaurantHomeModel {
  /** Couleurs lisibles déduites de l'accent choisi ; `null` si l'accent n'est pas un code hexadécimal. */
  theme: AccentTheme | null;
  hero: {
    title: string;
    isLongTitle: boolean;
    lead: string | null;
    imageUrl: string | null;
    primary: CtaAction | null;
    secondary: CtaAction | null;
    rating: { average: number; count: number } | null;
  };
  dock: DockItem[];
  hours: HoursEntry[];
  /** Renseigné quand les sept jours ont la même plage (« 11:00 - 23:00 ») : affichable sans connaître la date du visiteur. */
  hoursSummary: string | null;
  dishes: {
    heading: string;
    subheading: string | null;
    layout: "feature-list" | "spotlight" | "cards" | "lines";
    items: DishView[];
    catalogHref: string | null;
  } | null;
  menu: {
    heading: string;
    subheading: string | null;
    rows: MenuRow[];
    isDemo: boolean;
    catalogHref: string | null;
  } | null;
  story: {
    heading: string;
    text: string;
    imageUrl: string | null;
    aboutHref: string | null;
  } | null;
  gallery: { heading: string; images: GalleryImage[]; href: string | null } | null;
  testimonials: { heading: string; items: QuoteView[]; isDemo: boolean; rating: { average: number; count: number } | null } | null;
  visit: {
    heading: string;
    lead: string | null;
    action: CtaAction | null;
    address: string | null;
    phone: { text: string; href: string } | null;
    whatsappHref: string | null;
  } | null;
}

// ------------------------------------------------------------
// Fonctions pures (exportées pour les tests)
// ------------------------------------------------------------

function toCtaAction(label: string, href: string): CtaAction {
  const kind = href.startsWith("http") ? "external" : /^[a-z][a-z0-9+.-]*:/i.test(href) ? "protocol" : "internal";
  return { label, href, kind };
}

/**
 * Boutons du hero. Même ordre de repli que le hero générique (voir
 * `landing-sections/hero.tsx`) : lien saisi par le commerçant, puis page
 * recommandée par le secteur, puis WhatsApp — auquel s'ajoute ici le
 * téléphone, qui est un vrai moyen de réserver pour un restaurant.
 */
export function resolveActions(site: StorefrontSite): { primary: CtaAction | null; secondary: CtaAction | null } {
  const { config, blueprint, tenant, whatsappHref } = site;

  const primaryHref =
    toSafeHref(config.ctaUrl) ??
    resolveCtaTarget(blueprint.primaryCtaTarget, site) ??
    whatsappHref ??
    getPhoneHref(tenant.phone) ??
    resolveCtaTarget("contact", site);

  const primary = primaryHref
    ? toCtaAction(
        config.ctaLabel?.trim() || (primaryHref.startsWith("tel:") ? "Appeler pour réserver" : blueprint.primaryCtaLabel),
        primaryHref,
      )
    : null;

  const secondaryHref = toSafeHref(config.secondaryCtaUrl) ?? resolveCtaTarget(blueprint.secondaryCtaTarget, site);
  const secondary =
    secondaryHref && secondaryHref !== primaryHref
      ? toCtaAction(config.secondaryCtaLabel?.trim() || blueprint.secondaryCtaLabel, secondaryHref)
      : null;

  return { primary, secondary };
}

export type ReservationChannel = "online" | "whatsapp" | "phone";

/** Comment le visiteur réserve réellement, d'après le bouton principal résolu. `null` si le bouton mène ailleurs (lien du commerçant, page contact). */
export function reservationChannel(primary: CtaAction | null, whatsappHref: string | null): ReservationChannel | null {
  if (!primary) return null;
  if (primary.href === STOREFRONT_PATHS.booking) return "online";
  if (whatsappHref && primary.href === whatsappHref) return "whatsapp";
  if (primary.href.startsWith("tel:")) return "phone";
  return null;
}

const CHANNEL_LEAD: Record<ReservationChannel, string> = {
  online: "Réservez votre table en ligne.",
  whatsapp: "Réservez votre table par WhatsApp.",
  phone: "Réservez votre table par téléphone.",
};

/**
 * Sous-titre par défaut du hero : purement FONCTIONNEL, il décrit ce que le
 * visiteur peut faire ici. L'ancienne formule du blueprint (« … vous accueille
 * autour d'une cuisine généreuse, préparée avec soin ») répétait le nom juste
 * sous le titre — qui est déjà le nom — et affirmait une qualité que rien ne
 * prouve. Sans rien de vrai à dire, on ne dit rien : `null`.
 */
export function defaultHeroLead(canReserve: boolean, hasMenuLink: boolean): string | null {
  if (canReserve && hasMenuLink) return "Réservez une table ou découvrez la carte.";
  if (canReserve) return "Réservez votre table.";
  if (hasMenuLink) return "Découvrez la carte.";
  return null;
}

function pluralLabel(count: number, site: StorefrontSite): string {
  const { catalogItemLabel, catalogItemLabelPlural } = site.blueprint;
  return `${count} ${count > 1 ? catalogItemLabelPlural : catalogItemLabel}`;
}

function toDishView(product: StorefrontProduct, site: StorefrontSite): DishView {
  const badges: DishBadge[] = [];
  if (product.badges.includes("out_of_stock")) badges.push({ key: "out_of_stock", label: "Épuisé" });
  if (product.badges.includes("promo")) {
    badges.push({
      key: "promo",
      label: product.discountPercent && product.discountPercent > 0 ? `-${product.discountPercent} %` : "Promo",
    });
  }
  if (product.badges.includes("new")) badges.push({ key: "new", label: site.blueprint.newBadgeLabel });
  if (product.badges.includes("bestseller")) badges.push({ key: "bestseller", label: "Plat le plus commandé" });

  return {
    id: product.id,
    name: product.name,
    description: product.description?.trim() || null,
    price: product.unitPrice,
    comparePrice: product.compareAtPrice != null && product.compareAtPrice > product.unitPrice ? product.compareAtPrice : null,
    imageUrl: product.imageUrl,
    href: product.slug ? productPath(product.slug) : STOREFRONT_PATHS.catalog,
    badges: badges.slice(0, 2),
  };
}

/**
 * Plats mis en avant. Les produits arrivent déjà triés « épinglés d'abord »
 * (voir `getLandingSectionData`) : on garde cet ordre. Trois mises en page
 * selon ce qu'on a de vraiment photographié — une grille de plats sans
 * photo est pire qu'une simple liste — plus une vedette seule quand un unique
 * plat existe.
 */
export function buildDishes(products: StorefrontProduct[], site: StorefrontSite): RestaurantHomeModel["dishes"] {
  if (products.length === 0) return null;

  const views = products.map((product) => toDishView(product, site));
  const withImage = views.filter((dish) => dish.imageUrl);

  let layout: NonNullable<RestaurantHomeModel["dishes"]>["layout"];
  let items: DishView[];
  if (withImage.length >= 5) {
    layout = "feature-list";
    // Vedette + liste : la vedette est le premier plat photographié, la liste
    // reprend les suivants (avec ou sans photo) pour équilibrer les deux colonnes.
    const feature = withImage[0]!;
    items = [feature, ...views.filter((dish) => dish.id !== feature.id).slice(0, 5)];
  } else if (withImage.length >= 2) {
    layout = "cards";
    items = withImage.slice(0, 4);
  } else if (withImage.length === 1) {
    // Un seul plat photographié : il est la vedette. Les autres plats (sans photo)
    // forment la liste ; s'il n'y en a pas, la vedette occupe la largeur seule.
    const feature = withImage[0]!;
    const others = views.filter((dish) => dish.id !== feature.id).slice(0, 5);
    layout = others.length > 0 ? "feature-list" : "spotlight";
    items = [feature, ...others];
  } else {
    layout = "lines";
    items = views.slice(0, 6);
  }

  return {
    heading: sectionHeading(site.blueprint, "products", "Nos plats"),
    subheading: sectionSubheading(site.blueprint, "products"),
    layout,
    items,
    catalogHref: site.capabilities.hasProducts ? STOREFRONT_PATHS.catalog : null,
  };
}

// ------------------------------------------------------------
// Assemblage
// ------------------------------------------------------------

export function buildRestaurantHomeModel({ site, products, categories, testimonials, gallery }: RestaurantHomeInput): RestaurantHomeModel {
  const { tenant, config, blueprint, capabilities, whatsappHref } = site;
  const hasAnyCatalog = products.length > 0 || categories.length > 0;
  const isBlank = !hasAnyCatalog && testimonials.length === 0;

  // --- Photos ---------------------------------------------------------
  // La photo du hero et celles des plats sont celles du commerçant, telles
  // quelles. Les photos ANNEXES (l'histoire, la mosaïque) ne répètent jamais
  // une photo déjà utilisée plus haut : deux fois la même image sur une page
  // donne l'impression d'un site à moitié rempli.
  const used = new Set<string>();
  const takeFirstUnused = (candidates: (string | null | undefined)[]): string | null => {
    const found = candidates.find((url): url is string => Boolean(url) && !used.has(url as string)) ?? null;
    if (found) used.add(found);
    return found;
  };

  const heroImage = takeFirstUnused([
    site.heroMediaUrl,
    products.find((p) => p.imageUrl)?.imageUrl,
    SHOW_DEMO_CONTENT && isBlank ? DEMO_HERO_IMAGE : null,
  ]);
  // Le repli du hero sur une photo de plat n'empêche pas ce plat d'apparaître
  // dans sa propre section : on ne « consomme » que la photo du hero.
  const dishes = buildDishes(products, site);
  dishes?.items.forEach((dish) => dish.imageUrl && used.add(dish.imageUrl));

  // --- Textes ---------------------------------------------------------------
  const description = tenant.description?.trim() || null;
  const { primary, secondary } = resolveActions(site);
  const channel = reservationChannel(primary, whatsappHref ?? null);
  const lead =
    config.heroSubtitle?.trim() ||
    (description && description.length <= 200 ? description : null) ||
    defaultHeroLead(channel !== null, secondary?.href === STOREFRONT_PATHS.catalog);
  const storyText = description && description !== lead ? description : null;
  // Une photo d'histoire sans texte ne dirait rien : on ne « consomme » une photo
  // que s'il y a une histoire à raconter, sinon elle reste disponible pour la galerie.
  const storyImage = storyText
    ? takeFirstUnused([tenant.bannerUrl, ...gallery.map((image) => image.url), ...products.map((product) => product.imageUrl)])
    : null;

  const galleryImages = gallery.filter((image) => !used.has(image.url));
  // Une mosaïque de 5 (une grande + quatre petites), ou une rangée de 3 ; en dessous, rien.
  const galleryShown = galleryImages.length >= 5 ? galleryImages.slice(0, 5) : galleryImages.length >= 3 ? galleryImages.slice(0, 3) : [];

  const title = config.heroTitle?.trim() || tenant.name;

  // --- Horaires, adresse, téléphone -----------------------------------
  const hours = getHoursEntries(tenant.openingHours);
  const address = tenant.address?.trim() || null;
  const phoneHref = getPhoneHref(tenant.phone);
  const phone = tenant.phone && phoneHref ? { text: tenant.phone.trim(), href: phoneHref } : null;

  const dock: DockItem[] = [];
  if (address) dock.push({ kind: "address", text: address });
  if (hours.length > 0) dock.push({ kind: "hours" });
  if (phone) dock.push({ kind: "phone", ...phone });
  else if (whatsappHref) dock.push({ kind: "whatsapp", href: whatsappHref });

  // --- La carte ------------------------------------------------------
  const realRows: MenuRow[] = categories
    .filter((category) => category.productCount > 0)
    .slice(0, 8)
    .map((category) => ({
      id: category.id,
      name: category.name,
      href: categoryPath(category.slug),
      countLabel: pluralLabel(category.productCount, site),
      imageUrl: category.imageUrl,
    }));
  const demoRows: MenuRow[] = DEMO_MENU.map((row) => ({
    id: `demo-${row.name}`,
    name: row.name,
    href: null,
    countLabel: null,
    imageUrl: row.image,
  }));
  const showDemoMenu = SHOW_DEMO_CONTENT && !hasAnyCatalog;
  const menuRows = realRows.length > 0 ? realRows : showDemoMenu ? demoRows : [];

  // --- Avis --------------------------------------------------------------
  const realQuotes: QuoteView[] = testimonials.slice(0, 6).map((t) => ({
    id: t.id,
    author: t.authorName,
    content: t.content,
    rating: t.rating,
  }));
  const rating = averageRating(testimonials);
  const showDemoQuotes = SHOW_DEMO_CONTENT && realQuotes.length === 0;

  // --- Réserver ------------------------------------------------------
  const visitLead = channel ? CHANNEL_LEAD[channel] : null;
  const hasVisit = Boolean(primary) || hours.length > 0 || Boolean(address) || Boolean(phone);

  return {
    theme: resolveAccentTheme(site.accent?.primary),
    hero: {
      title,
      isLongTitle: title.length > 26,
      lead,
      imageUrl: heroImage,
      primary,
      secondary,
      rating,
    },
    dock: dock.slice(0, 3),
    hours,
    hoursSummary: summarizeHours(hours),
    dishes,
    menu:
      menuRows.length > 0
        ? {
            heading: sectionHeading(blueprint, "categories", "La carte"),
            subheading: sectionSubheading(blueprint, "categories"),
            rows: menuRows,
            isDemo: realRows.length === 0,
            catalogHref: realRows.length > 0 && capabilities.hasProducts ? STOREFRONT_PATHS.catalog : null,
          }
        : null,
    story: storyText
      ? {
          heading: sectionHeading(blueprint, "about", "Notre maison"),
          text: storyText,
          imageUrl: storyImage,
          aboutHref: site.nav.some((entry) => entry.key === "about") ? STOREFRONT_PATHS.about : null,
        }
      : null,
    gallery:
      galleryShown.length > 0
        ? {
            heading: sectionHeading(blueprint, "gallery", "En images"),
            images: galleryShown,
            href: capabilities.hasGallery ? STOREFRONT_PATHS.gallery : null,
          }
        : null,
    testimonials:
      realQuotes.length > 0 || showDemoQuotes
        ? {
            heading: sectionHeading(blueprint, "testimonials", "Avis de nos clients"),
            items: realQuotes.length > 0 ? realQuotes : DEMO_TESTIMONIALS,
            isDemo: realQuotes.length === 0,
            rating,
          }
        : null,
    visit: hasVisit
      ? {
          heading: sectionHeading(blueprint, "booking", "Réserver une table"),
          lead: visitLead,
          action: primary,
          address,
          phone,
          whatsappHref: whatsappHref ?? null,
        }
      : null,
  };
}
