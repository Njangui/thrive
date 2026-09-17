import type { LandingSectionType } from "@/domain/entities/landing";

/**
 * ============================================================
 * PLAN DE SITE DE LA VITRINE TENANT
 * ============================================================
 *
 * Avant ce chantier, la vitrine d'un tenant était une PAGE, pas un site :
 * `/` empilait des sections, `/produits` listait le catalogue, et c'était
 * tout. Aucune page « À propos », aucune page contact, aucune page par
 * catégorie, aucune fiche prestation — donc rien à indexer pour Google
 * au-delà de deux URL, et aucune navigation possible.
 *
 * Ce fichier est la source unique du plan de site. Il est consommé par :
 *  - la navigation de l'en-tête et le pied de page (`buildStorefrontNav`) ;
 *  - `sitemap.ts`, pour n'y déclarer que des URL qui existent RÉELLEMENT
 *    pour ce tenant (une URL 404 dans un sitemap dégrade le crawl) ;
 *  - les pages elles-mêmes, pour leurs liens croisés et fils d'Ariane.
 *
 * Les chemins sont en français et figés : ce sont des URL publiques
 * partagées sur WhatsApp par les clients du commerçant. `/produits` est
 * conservé tel quel (au lieu d'un `/catalogue` plus neutre) précisément
 * parce que des liens existent déjà dans la nature.
 */
export const STOREFRONT_ROUTE_KEYS = [
  "home",
  "catalog",
  "categories",
  "promotions",
  "services",
  "gallery",
  "about",
  "booking",
  "faq",
  "contact",
] as const;
export type StorefrontRouteKey = (typeof STOREFRONT_ROUTE_KEYS)[number];

export const STOREFRONT_PATHS: Record<StorefrontRouteKey, string> = {
  home: "/",
  catalog: "/produits",
  categories: "/categories",
  promotions: "/promotions",
  services: "/services",
  gallery: "/galerie",
  about: "/a-propos",
  booking: "/rendez-vous",
  faq: "/faq",
  contact: "/contact",
};

export function productPath(slug: string): string {
  return `/produits/${slug}`;
}

export function categoryPath(slug: string): string {
  return `/categories/${slug}`;
}

export function servicePath(slug: string): string {
  return `/services/${slug}`;
}

/**
 * Section activable -> page du site. C'est ce qui fait que l'ordre de
 * navigation suit le secteur SANS table de navigation supplémentaire :
 * un salon (dont le preset commence par `services`, `gallery`, `team`)
 * obtient « Prestations / Réalisations / À propos », là où une boutique
 * (preset `categories`, `promotions`, `products`) obtient « Catégories /
 * Promotions / Boutique ». Réordonner ses sections depuis /dashboard/site
 * réordonne donc aussi son menu, ce qui est le comportement attendu par
 * un commerçant.
 *
 * Plusieurs sections pointent volontairement vers la même page (`team`,
 * `testimonials` et `about` -> « À propos ») : ce sont des blocs de cette
 * page, pas des destinations distinctes. `buildStorefrontNav` déduplique.
 */
export const SECTION_TO_ROUTE: Partial<Record<LandingSectionType, StorefrontRouteKey>> = {
  products: "catalog",
  categories: "categories",
  promotions: "promotions",
  services: "services",
  gallery: "gallery",
  about: "about",
  team: "about",
  testimonials: "about",
  booking: "booking",
  faq: "faq",
  contact: "contact",
  location: "contact",
};
