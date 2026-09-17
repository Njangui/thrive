import { LANDING_SECTION_TYPES, type LandingSection, type LandingSectionType } from "@/domain/entities/landing";
import { STOREFRONT_BLUEPRINTS, resolveStorefrontSector, type StorefrontSector } from "./storefront-blueprint";

/**
 * Presets par secteur — codés en dur (PAS en base, voir cahier Lot K) :
 * ce sont des valeurs par défaut au moment où aucune ligne
 * `organization_landing_config` n'existe encore, pas une donnée qui
 * change dans le temps.
 *
 * ÉVOLUTION (chantier vitrine V2, sept. 2026) — deux changements, tous
 * deux assumés et couverts par les tests :
 *
 *  1. La liste de sections n'est plus déclarée ici : elle est DÉRIVÉE de
 *     `storefront-blueprint.ts`, qui porte désormais toute l'identité de
 *     vitrine d'un secteur (vocabulaire, navigation, palette, promesses).
 *     Deux listes de sections par secteur dans deux fichiers distincts,
 *     c'était la garantie de les voir diverger au premier ajustement.
 *
 *  2. Deux presets s'ajoutent aux trois historiques : `services`
 *     (professional_services) et `immobilier` (real_estate). Le Lot K les
 *     renvoyait explicitement sur "default" faute de preset nommé par son
 *     cahier — écart assumé à l'époque, pas une décision produit : un
 *     cabinet de conseil se retrouvait avec une vitrine « Produits / FAQ »,
 *     sans ses services ni sa prise de rendez-vous. Le test correspondant
 *     est mis à jour dans le même commit.
 */
export const LANDING_PRESET_KEYS = ["boutique", "restaurant", "salon", "services", "immobilier", "default"] as const;
export type LandingPresetKey = (typeof LANDING_PRESET_KEYS)[number];

/** Correspondance preset (vocabulaire métier FR, visible dans /dashboard/site) <-> secteur technique (`organizations.industry`). */
export const PRESET_TO_SECTOR: Record<LandingPresetKey, StorefrontSector> = {
  boutique: "retail",
  restaurant: "restaurant",
  salon: "beauty",
  services: "professional_services",
  immobilier: "real_estate",
  default: "",
};

export const SECTOR_TO_PRESET: Record<StorefrontSector, LandingPresetKey> = {
  retail: "boutique",
  restaurant: "restaurant",
  beauty: "salon",
  professional_services: "services",
  real_estate: "immobilier",
  "": "default",
};

/** Libellés FR des presets pour le sélecteur de modèle de /dashboard/site. */
export const LANDING_PRESET_LABELS: Record<LandingPresetKey, string> = {
  boutique: "Boutique / commerce",
  restaurant: "Restaurant / traiteur",
  salon: "Salon / beauté",
  services: "Services professionnels",
  immobilier: "Immobilier",
  default: "Générique",
};

export const LANDING_PRESET_DESCRIPTIONS: Record<LandingPresetKey, string> = {
  boutique: "Catégories, promotions et produits en avant, comme une boutique en ligne.",
  restaurant: "La carte, les plats phares et l'adresse en évidence.",
  salon: "Prestations, réalisations, équipe et prise de rendez-vous.",
  services: "Offres, références clients et demande de rendez-vous.",
  immobilier: "Types de biens, annonces disponibles et conseillers.",
  default: "Une structure passe-partout pour toute activité.",
};

export const LANDING_PRESETS: Record<LandingPresetKey, LandingSectionType[]> = {
  boutique: STOREFRONT_BLUEPRINTS.retail.sections,
  restaurant: STOREFRONT_BLUEPRINTS.restaurant.sections,
  salon: STOREFRONT_BLUEPRINTS.beauty.sections,
  services: STOREFRONT_BLUEPRINTS.professional_services.sections,
  immobilier: STOREFRONT_BLUEPRINTS.real_estate.sections,
  default: STOREFRONT_BLUEPRINTS[""].sections,
};

/**
 * Résout la clé de preset à partir de `organizations.industry` (texte
 * libre ou vide/null). Ne bloque jamais sur une valeur inattendue —
 * repli systématique sur "default".
 *
 * Délègue la reconnaissance à `resolveStorefrontSector` : une seule table
 * de mots-clés dans tout le projet, partagée avec le rendu de la vitrine.
 * Sinon un tenant pouvait obtenir les sections « salon » tout en lisant
 * le vocabulaire générique, les deux résolutions étant indépendantes.
 */
export function resolveIndustryPresetKey(industry: string | null | undefined): LandingPresetKey {
  return SECTOR_TO_PRESET[resolveStorefrontSector(industry)];
}

/**
 * Construit le tableau de sections par défaut d'un preset — chaque type
 * activé, ordonné selon l'ordre déclaré dans LANDING_PRESETS. Fonction
 * pure, utilisée à la fois par getLandingConfig (aucune ligne persistée)
 * et par l'action « appliquer ce modèle » de /dashboard/site.
 */
export function buildDefaultSections(presetKey: LandingPresetKey): LandingSection[] {
  return LANDING_PRESETS[presetKey].map((type, index) => ({
    type,
    enabled: true,
    order: index,
  }));
}

/** Libellés FR pour l'UI dashboard (sélecteur/aperçu des types de section). */
export const LANDING_SECTION_LABELS: Record<LandingSectionType, string> = {
  hero: "En-tête",
  about: "À propos",
  products: "Produits",
  services: "Services",
  categories: "Catégories",
  promotions: "Promotions",
  gallery: "Galerie",
  testimonials: "Témoignages",
  team: "Équipe",
  faq: "Questions fréquentes",
  booking: "Prise de rendez-vous",
  contact: "Contact",
  location: "Localisation",
  social_links: "Réseaux sociaux",
  cta: "Appel à l'action final",
};

// Garde de cohérence dev-time : chaque type listé dans un preset doit être
// un type de section reconnu (évite une faute de frappe silencieuse dans
// un blueprint de secteur).
for (const sections of Object.values(LANDING_PRESETS)) {
  for (const type of sections) {
    if (!LANDING_SECTION_TYPES.includes(type)) {
      throw new Error(`landing-presets.ts: type de section inconnu "${type}"`);
    }
  }
}
