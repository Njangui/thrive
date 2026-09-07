import { LANDING_SECTION_TYPES, type LandingSection, type LandingSectionType } from "@/domain/entities/landing";

/**
 * Presets par secteur — codés en dur (PAS en base, voir cahier Lot K) :
 * ce sont des valeurs par défaut au moment où aucune ligne
 * `organization_landing_config` n'existe encore, pas une donnée qui
 * change dans le temps. Citation directe du cahier (section 16 du master
 * prompt) : une boutique met en avant Produits/Promotions/Nouveautés/
 * Catégories, un salon met en avant Services/Tarifs/Équipe/Galerie/
 * Rendez-vous.
 */
export const LANDING_PRESET_KEYS = ["boutique", "salon", "restaurant", "default"] as const;
export type LandingPresetKey = (typeof LANDING_PRESET_KEYS)[number];

export const LANDING_PRESETS: Record<LandingPresetKey, LandingSectionType[]> = {
  boutique: ["hero", "categories", "promotions", "products", "gallery", "contact"],
  salon: ["hero", "services", "team", "gallery", "booking", "contact"],
  restaurant: ["hero", "categories", "products", "gallery", "location", "contact"],
  default: ["hero", "products", "about", "faq", "contact"],
};

/**
 * Mots-clés de correspondance approximative, normalisés (minuscules, sans
 * accents — voir `normalizeForMatching`). Couvre à la fois :
 *  - les valeurs contrôlées produites par le `<select>` de l'onboarding
 *    actuel (src/app/onboarding/onboarding-wizard.tsx::INDUSTRY_OPTIONS :
 *    "retail", "restaurant", "beauty", "professional_services",
 *    "real_estate", ou "" pour "Autre") ;
 *  - du texte libre arbitraire, puisque `organizations.industry` reste un
 *    `text` non contraint en base (une organisation créée avant ce
 *    wizard, ou modifiée directement, peut porter n'importe quelle
 *    valeur) — le cahier Lot K est explicite là-dessus : "boutique"/
 *    "mode"/"vêtement" → boutique, "salon"/"coiffure"/"beauté" → salon.
 *
 * "professional_services" et "real_estate" ne correspondent à aucun des
 * 3 presets nommés par le cahier (boutique/salon/restaurant) et tombent
 * donc sur "default" — assumé explicitement, voir RAPPORT_LOT_K.md.
 */
const PRESET_KEYWORDS: Record<Exclude<LandingPresetKey, "default">, string[]> = {
  boutique: ["boutique", "mode", "vetement", "retail", "commerce", "shop", "magasin", "vente"],
  salon: ["salon", "coiffure", "beaute", "beauty", "bien-etre", "bien etre", "spa", "estheti", "coiffeur", "coiffeuse"],
  restaurant: ["restaurant", "resto", "restauration", "cuisine", "food", "traiteur"],
};

function normalizeForMatching(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Résout la clé de preset à partir de `organizations.industry` (texte
 * libre ou vide/null). Ne bloque jamais sur une valeur inattendue —
 * repli systématique sur "default" (cahier Lot K, critère d'acceptation).
 */
export function resolveIndustryPresetKey(industry: string | null | undefined): LandingPresetKey {
  if (!industry || !industry.trim()) return "default";

  const normalized = normalizeForMatching(industry);

  for (const key of ["boutique", "salon", "restaurant"] as const) {
    if (PRESET_KEYWORDS[key].some((keyword) => normalized.includes(keyword))) {
      return key;
    }
  }

  return "default";
}

/**
 * Construit le tableau de sections par défaut d'un preset — chaque type
 * activé, ordonné selon l'ordre déclaré dans LANDING_PRESETS. Fonction
 * pure, utilisée à la fois par getLandingConfig (aucune ligne persistée)
 * et par updateLandingConfig si un futur appelant veut "réinitialiser"
 * (non exposé en UI dans ce lot, mais garder la fonction pure et exportée
 * évite de dupliquer cette logique ailleurs).
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
// LANDING_PRESETS ci-dessus).
for (const sections of Object.values(LANDING_PRESETS)) {
  for (const type of sections) {
    if (!LANDING_SECTION_TYPES.includes(type)) {
      throw new Error(`landing-presets.ts: type de section inconnu "${type}"`);
    }
  }
}
