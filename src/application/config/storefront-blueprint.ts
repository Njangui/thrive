import type { LandingSectionType } from "@/domain/entities/landing";
import { normalizeIndustry, type IndustryKey } from "./industry-ui";

/**
 * ============================================================
 * BLUEPRINT DE VITRINE PAR SECTEUR
 * ============================================================
 *
 * Pourquoi ce fichier existe (chantier vitrine V2, sept. 2026) : jusqu'ici,
 * la seule chose qui variait par secteur sur la vitrine publique était la
 * LISTE des sections activées (`landing-presets.ts`). Tout le reste — le
 * vocabulaire (« Nos produits » pour un restaurant comme pour un salon),
 * les libellés de boutons, la navigation, la palette par défaut — était
 * identique pour tout le monde. Une boutique de mode et un cabinet de
 * conseil rendaient exactement la même page, au contenu près.
 *
 * Ce fichier porte l'IDENTITÉ de vitrine d'un secteur. `landing-presets.ts`
 * reste la source de vérité pour la question « quelles sections, dans quel
 * ordre » (c'est la partie que le commerçant peut réordonner et qui est
 * persistée en base) ; ici on répond à « à quoi ressemble et comment parle
 * une vitrine de ce secteur ».
 *
 * Deux principes tenus dans tout le fichier :
 *
 *  1. AUCUN CHIFFRE INVENTÉ. La maquette de référence affiche « 10 000+
 *     clients satisfaits » / « 99% livraisons à temps ». Écrire ça en dur
 *     pour tous les tenants ferait mentir chaque commerçant dès sa première
 *     journée. Les « highlights » ci-dessous sont des PROMESSES QUALITATIVES
 *     par défaut, toutes modifiables et supprimables depuis /dashboard/site,
 *     et la bande de chiffres de la vitrine (`storefront-stats`) ne calcule
 *     que des valeurs RÉELLES issues de la base (nombre de références
 *     actives, catégories, ancienneté, note moyenne des témoignages).
 *
 *  2. Les valeurs ici ne sont que des DÉFAUTS. Dès que le commerçant
 *     renseigne un titre, une couleur ou un highlight, sa valeur gagne —
 *     même logique que `getLandingConfig` avec les presets de sections.
 */

export type StorefrontSector = IndustryKey;

/** Clés d'icônes rendues par `src/app/_components/storefront/storefront-icons.tsx`. */
export type StorefrontIconKey =
  | "truck"
  | "wallet"
  | "shield"
  | "headset"
  | "clock"
  | "pin"
  | "sparkles"
  | "star"
  | "chef"
  | "leaf"
  | "scissors"
  | "calendar"
  | "briefcase"
  | "handshake"
  | "key"
  | "ruler"
  | "whatsapp"
  | "bag";

/**
 * Capacité réelle du tenant dont dépend l'affichage d'une promesse PAR
 * DÉFAUT du secteur (voir `resolveStorefrontHighlights`,
 * storefront-service.ts). Délibérément un petit ensemble de chaînes
 * plutôt qu'une clé de `StorefrontCapabilities` importée directement :
 * `storefront-service.ts` importe déjà ce module-ci, donc importer
 * `StorefrontCapabilities` en retour créerait un cycle. `absent` = la
 * promesse s'affiche toujours, aucune dépendance.
 *
 * TENU SÉPARÉ DE L'ICÔNE, volontairement — c'est le correctif d'un bug
 * réel du premier jet de ce chantier : filtrer par ICÔNE plutôt que par
 * CONTENU confondait deux promesses qui partagent une icône pour des
 * raisons différentes. Deux exemples concrets qui ont existé ici avant
 * correction : la promesse "Délais annoncés" (professional_services,
 * délais de livraison de projet) utilisait l'icône `clock` — la même que
 * la promesse "Horaires affichés" (générique, horaires du commerce) — et
 * se serait donc masquée chez tout cabinet de conseil n'ayant pas
 * renseigné d'horaires de boutique, alors que son texte ne parle même
 * pas d'horaires. Symétriquement, "Visite organisée" (real_estate)
 * partageait l'icône `headset` avec "Conseil personnalisé / Écrivez-nous
 * sur WhatsApp" (retail) et se serait masquée sans numéro WhatsApp, alors
 * que son texte ne mentionne pas WhatsApp. Le contenu d'une promesse ne
 * se déduit pas de son pictogramme.
 */
export type StorefrontHighlightRequirement = "whatsapp" | "openingHours" | "location";

export interface StorefrontHighlight {
  icon: StorefrontIconKey;
  title: string;
  subtitle: string;
  /** Absent = toujours affichée. Voir StorefrontHighlightRequirement ci-dessus. */
  requires?: StorefrontHighlightRequirement;
}

export interface StorefrontNavItem {
  label: string;
  href: string;
  /**
   * Section dont dépend l'entrée de menu. Une entrée n'est rendue que si
   * la section correspondante est activée ET contient réellement quelque
   * chose (voir `buildStorefrontNav`) — jamais un lien qui scrolle vers
   * le vide, règle constante de ce projet.
   */
  requires?: LandingSectionType;
}

export interface StorefrontBlueprint {
  sector: StorefrontSector;
  /** Libellé secteur affiché en sur-titre du hero (remplace l'ancien `tenant.industry` brut, qui affichait « retail » ou « professional_services » tels quels au visiteur). */
  eyebrow: string;
  /** Nom du catalogue dans la navigation et les titres (« Boutique », « Menu », « Prestations », « Biens »). */
  catalogLabel: string;
  catalogItemLabel: string;
  catalogItemLabelPlural: string;
  /** Titres de section, par type. Ce qui fait qu'un restaurant lit « Notre carte » là où une boutique lit « Nos produits populaires ». */
  headings: Partial<Record<LandingSectionType, string>> & { products: string; categories: string };
  /** Sous-titres optionnels sous les titres de section. */
  subheadings: Partial<Record<LandingSectionType, string>>;
  heroTitle: (businessName: string) => string;
  heroSubtitle: (businessName: string) => string;
  primaryCtaLabel: string;
  /** Cible du CTA principal quand le commerçant n'a rien saisi : ancre interne ou catalogue. */
  primaryCtaTarget: "catalog" | "booking" | "contact";
  secondaryCtaLabel: string;
  secondaryCtaTarget: "promotions" | "services" | "contact" | "gallery" | "catalog";
  /** Palette par défaut du secteur — écrasée dès que le commerçant choisit ses couleurs. */
  defaultAccent: { primary: string; secondary: string };
  /** Promesses par défaut de la bande de confiance (toutes éditables). */
  highlights: StorefrontHighlight[];
  /** Ordre de section par défaut du secteur (miroir de `landing-presets.ts`). */
  sections: LandingSectionType[];
  /** Libellé du bloc « nouveautés » selon le secteur (badge produit). */
  newBadgeLabel: string;
  emptyCatalogMessage: string;
}

const RETAIL: StorefrontBlueprint = {
  sector: "retail",
  eyebrow: "Boutique",
  catalogLabel: "Boutique",
  catalogItemLabel: "produit",
  catalogItemLabelPlural: "produits",
  headings: {
    products: "Nos produits populaires",
    categories: "Catégories populaires",
    promotions: "Offres du moment",
    gallery: "En images",
    services: "Nos services",
    testimonials: "Ce qu'en disent nos clients",
    team: "Notre équipe",
    faq: "Questions fréquentes",
    about: "À propos",
    contact: "Informations pratiques",
    location: "Nous trouver",
    booking: "Prendre rendez-vous",
  },
  subheadings: {
    products: "Une sélection de ce qui part le plus vite.",
    categories: "Trouvez rapidement ce que vous cherchez.",
    promotions: "Prix réduits pendant une durée limitée.",
  },
  heroTitle: () => "Découvrez notre sélection",
  heroSubtitle: (name) => `Commandez en quelques minutes chez ${name} — paiement et livraison arrangés directement avec nous.`,
  primaryCtaLabel: "Découvrir la collection",
  primaryCtaTarget: "catalog",
  secondaryCtaLabel: "Voir les promotions",
  secondaryCtaTarget: "promotions",
  defaultAccent: { primary: "#34D4B5", secondary: "#F97316" },
  highlights: [
    { icon: "wallet", title: "Paiement à la livraison", subtitle: "Mobile Money ou espèces" },
    { icon: "truck", title: "Livraison rapide", subtitle: "Commandez, on s'occupe du reste" },
    { icon: "shield", title: "Produits vérifiés", subtitle: "Sélectionnés un par un" },
    { icon: "headset", title: "Conseil personnalisé", subtitle: "Écrivez-nous sur WhatsApp", requires: "whatsapp" },
  ],
  sections: ["hero", "categories", "promotions", "products", "testimonials", "gallery", "faq", "contact"],
  newBadgeLabel: "Nouveau",
  emptyCatalogMessage: "Le catalogue est en cours de mise à jour — écrivez-nous, on vous dit ce qui est disponible.",
};

const RESTAURANT: StorefrontBlueprint = {
  sector: "restaurant",
  eyebrow: "Restaurant",
  catalogLabel: "Notre carte",
  catalogItemLabel: "plat",
  catalogItemLabelPlural: "plats",
  headings: {
    products: "Les plats qu'on nous redemande",
    categories: "La carte",
    promotions: "Menus du moment",
    gallery: "Nos plats en images",
    services: "Nos prestations",
    testimonials: "Avis de nos clients",
    team: "En cuisine et en salle",
    faq: "Questions fréquentes",
    about: "Notre maison",
    contact: "Horaires et contact",
    location: "Venir chez nous",
    booking: "Réserver une table",
  },
  subheadings: {
    products: "Les incontournables de la maison.",
    categories: "Entrées, plats, accompagnements, boissons.",
    promotions: "Formules et prix doux, le temps qu'elles durent.",
  },
  heroTitle: () => "Une expérience culinaire unique",
  heroSubtitle: (name) => `${name} vous accueille autour d'une cuisine généreuse, préparée avec soin. Réservez une table, découvrez la carte ou commandez selon vos possibilités.`,
  primaryCtaLabel: "Réserver une table",
  primaryCtaTarget: "booking",
  secondaryCtaLabel: "Découvrir notre menu",
  secondaryCtaTarget: "catalog",
  defaultAccent: { primary: "#C1562C", secondary: "#178A4C" },
  highlights: [
    { icon: "chef", title: "Préparé à la commande", subtitle: "Rien qui attend sous la lampe" },
    { icon: "truck", title: "Livraison et à emporter", subtitle: "Selon votre position" },
    { icon: "clock", title: "Horaires clairs", subtitle: "Affichés plus bas", requires: "openingHours" },
    { icon: "leaf", title: "Produits frais", subtitle: "Approvisionnement quotidien" },
  ],
  // Page d'accueil par défaut : composition inspirée de la maquette restaurant
  // fournie (hero immersif → carte/catégories → histoire → avis → footer).
  // Le catalogue complet reste accessible via « Notre carte » dans la navigation.
  sections: ["hero", "categories", "about", "testimonials"],
  newBadgeLabel: "Nouveauté",
  emptyCatalogMessage: "La carte est en cours de mise à jour — appelez-nous pour connaître les plats du jour.",
};

const BEAUTY: StorefrontBlueprint = {
  sector: "beauty",
  eyebrow: "Beauté & bien-être",
  catalogLabel: "Prestations",
  catalogItemLabel: "prestation",
  catalogItemLabelPlural: "prestations",
  headings: {
    products: "Nos produits",
    categories: "Nos univers de soin",
    promotions: "Offres en cours",
    services: "Nos prestations",
    gallery: "Nos réalisations",
    testimonials: "Elles et ils nous ont fait confiance",
    team: "Notre équipe",
    faq: "Questions fréquentes",
    about: "Notre approche",
    contact: "Horaires et contact",
    location: "Venir au salon",
    booking: "Prendre rendez-vous",
  },
  subheadings: {
    services: "Tarifs et durées indiqués, sans surprise à la caisse.",
    gallery: "Des résultats réels, réalisés chez nous.",
    booking: "Choisissez un créneau, on vous confirme rapidement.",
  },
  heroTitle: () => "Prenez soin de vous",
  heroSubtitle: (name) => `Prestations sur rendez-vous chez ${name} — tarifs annoncés à l'avance, confirmation rapide.`,
  primaryCtaLabel: "Prendre rendez-vous",
  primaryCtaTarget: "booking",
  secondaryCtaLabel: "Voir les prestations",
  secondaryCtaTarget: "services",
  defaultAccent: { primary: "#BE185D", secondary: "#6EE7D0" },
  highlights: [
    { icon: "calendar", title: "Sur rendez-vous", subtitle: "Pas d'attente inutile" },
    { icon: "scissors", title: "Savoir-faire", subtitle: "Équipe formée" },
    { icon: "sparkles", title: "Matériel entretenu", subtitle: "Hygiène systématique" },
    { icon: "wallet", title: "Tarifs affichés", subtitle: "Annoncés avant la prestation" },
  ],
  sections: ["hero", "services", "gallery", "team", "testimonials", "booking", "faq", "contact"],
  newBadgeLabel: "Nouveau",
  emptyCatalogMessage: "Les prestations sont en cours de mise à jour — écrivez-nous pour connaître nos tarifs.",
};

const PROFESSIONAL_SERVICES: StorefrontBlueprint = {
  sector: "professional_services",
  eyebrow: "Services professionnels",
  catalogLabel: "Services",
  catalogItemLabel: "service",
  catalogItemLabelPlural: "services",
  headings: {
    products: "Nos offres",
    categories: "Domaines d'intervention",
    promotions: "Offres en cours",
    services: "Nos services",
    gallery: "Nos réalisations",
    testimonials: "Ils nous font confiance",
    team: "Qui vous accompagne",
    faq: "Questions fréquentes",
    about: "Notre approche",
    contact: "Nous joindre",
    location: "Nos bureaux",
    booking: "Demander un rendez-vous",
  },
  subheadings: {
    services: "Périmètre et tarif clairs avant de commencer.",
    booking: "Décrivez votre besoin, nous revenons vers vous.",
    team: "Les personnes qui traiteront votre dossier.",
  },
  heroTitle: () => "Un accompagnement clair, du début à la fin",
  heroSubtitle: (name) => `${name} vous accompagne avec un périmètre écrit, un tarif annoncé et un interlocuteur unique.`,
  primaryCtaLabel: "Demander un rendez-vous",
  primaryCtaTarget: "booking",
  secondaryCtaLabel: "Voir nos services",
  secondaryCtaTarget: "services",
  defaultAccent: { primary: "#1D4ED8", secondary: "#0EA5E9" },
  highlights: [
    { icon: "briefcase", title: "Périmètre écrit", subtitle: "Vous savez ce qui est inclus" },
    { icon: "handshake", title: "Interlocuteur unique", subtitle: "Pas de dossier qui se perd" },
    { icon: "clock", title: "Délais annoncés", subtitle: "Et tenus" }, // pas de `requires` : ne référence pas les horaires du commerce, contrairement à l'icône
    { icon: "shield", title: "Confidentialité", subtitle: "Vos informations restent chez nous" },
  ],
  sections: ["hero", "services", "about", "testimonials", "team", "booking", "faq", "contact"],
  newBadgeLabel: "Nouveau",
  emptyCatalogMessage: "Nos offres sont en cours de mise à jour — contactez-nous pour en discuter directement.",
};

const REAL_ESTATE: StorefrontBlueprint = {
  sector: "real_estate",
  eyebrow: "Immobilier",
  catalogLabel: "Nos biens",
  catalogItemLabel: "bien",
  catalogItemLabelPlural: "biens",
  headings: {
    products: "Biens disponibles",
    categories: "Types de biens",
    promotions: "Biens à prix négocié",
    services: "Nos services",
    gallery: "Visite en images",
    testimonials: "Ils ont trouvé avec nous",
    team: "Vos conseillers",
    faq: "Questions fréquentes",
    about: "Notre agence",
    contact: "Nous joindre",
    location: "Notre agence",
    booking: "Organiser une visite",
  },
  subheadings: {
    products: "Mis à jour au fil des disponibilités.",
    categories: "Location, vente, meublé, terrain.",
    booking: "Indiquez le bien et un créneau, on organise la visite.",
  },
  heroTitle: () => "Trouvez votre prochain logement",
  heroSubtitle: (name) => `${name} vous présente des biens vérifiés, avec un prix affiché et une visite organisée rapidement.`,
  primaryCtaLabel: "Voir les biens",
  primaryCtaTarget: "catalog",
  secondaryCtaLabel: "Organiser une visite",
  secondaryCtaTarget: "contact",
  defaultAccent: { primary: "#0F766E", secondary: "#CA8A04" },
  highlights: [
    { icon: "key", title: "Biens vérifiés", subtitle: "Visités avant publication" },
    { icon: "wallet", title: "Prix affiché", subtitle: "Pas de frais surprise" },
    { icon: "ruler", title: "Fiches détaillées", subtitle: "Surface, quartier, charges" },
    { icon: "headset", title: "Visite organisée", subtitle: "Sur rendez-vous" }, // pas de `requires` : générique, ne mentionne pas WhatsApp contrairement à l'icône
  ],
  sections: ["hero", "categories", "products", "gallery", "testimonials", "team", "faq", "contact"],
  newBadgeLabel: "Nouveau bien",
  emptyCatalogMessage: "Aucun bien publié pour le moment — dites-nous ce que vous cherchez, nous vous préviendrons.",
};

const DEFAULT: StorefrontBlueprint = {
  sector: "",
  eyebrow: "Entreprise",
  catalogLabel: "Catalogue",
  catalogItemLabel: "article",
  catalogItemLabelPlural: "articles",
  headings: {
    products: "Ce que nous proposons",
    categories: "Nos catégories",
    promotions: "Offres en cours",
    services: "Nos services",
    gallery: "En images",
    testimonials: "Ce qu'en disent nos clients",
    team: "Notre équipe",
    faq: "Questions fréquentes",
    about: "À propos",
    contact: "Informations pratiques",
    location: "Nous trouver",
    booking: "Prendre rendez-vous",
  },
  subheadings: {},
  heroTitle: (name) => name,
  heroSubtitle: (name) => `Découvrez ce que propose ${name} et contactez-nous directement.`,
  primaryCtaLabel: "Nous contacter",
  primaryCtaTarget: "contact",
  secondaryCtaLabel: "Voir le catalogue",
  secondaryCtaTarget: "catalog",
  defaultAccent: { primary: "#0f172a", secondary: "#10b981" },
  highlights: [
    { icon: "whatsapp", title: "Réponse sur WhatsApp", subtitle: "Écrivez-nous directement", requires: "whatsapp" },
    { icon: "clock", title: "Horaires affichés", subtitle: "Vous savez quand nous joindre", requires: "openingHours" },
    { icon: "pin", title: "Adresse vérifiable", subtitle: "Ouvrable dans Google Maps", requires: "location" },
  ],
  sections: ["hero", "products", "about", "testimonials", "faq", "contact"],
  newBadgeLabel: "Nouveau",
  emptyCatalogMessage: "Le catalogue est en cours de mise à jour — contactez-nous pour toute demande.",
};

export const STOREFRONT_BLUEPRINTS: Record<StorefrontSector, StorefrontBlueprint> = {
  retail: RETAIL,
  restaurant: RESTAURANT,
  beauty: BEAUTY,
  professional_services: PROFESSIONAL_SERVICES,
  real_estate: REAL_ESTATE,
  "": DEFAULT,
};

/**
 * Mots-clés de secours pour un `organizations.industry` en texte libre.
 * `normalizeIndustry` (industry-ui.ts) ne reconnaît que les 5 valeurs
 * contrôlées produites par le `<select>` de l'onboarding ; or la colonne
 * reste un `text` libre en base (organisation créée avant ce wizard, ou
 * modifiée directement). Sans ce second filet, un tenant portant
 * « boutique de mode » tomberait sur le blueprint générique alors qu'il
 * est très clairement du retail — exactement le cas de figure déjà géré
 * par `landing-presets.ts::resolveIndustryPresetKey`, repris ici pour que
 * les deux résolutions ne divergent jamais.
 */
const SECTOR_KEYWORDS: Record<Exclude<StorefrontSector, "">, string[]> = {
  retail: ["boutique", "mode", "vetement", "retail", "commerce", "shop", "magasin", "vente", "epicerie", "quincaillerie", "cosmetique", "pharmacie"],
  restaurant: ["restaurant", "resto", "restauration", "cuisine", "food", "traiteur", "snack", "patisserie", "boulangerie", "bar", "cafe"],
  beauty: ["salon", "coiffure", "beaute", "beauty", "bien-etre", "bien etre", "spa", "estheti", "coiffeur", "coiffeuse", "barbier", "onglerie", "massage"],
  professional_services: [
    "service", "conseil", "consulting", "cabinet", "avocat", "juridique", "comptab", "formation", "agence", "informatique", "digital", "architecte", "ingenier",
  ],
  real_estate: ["immobilier", "real estate", "real_estate", "agence immobiliere", "location", "logement", "appartement", "terrain", "foncier"],
};

function normalizeForMatching(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Résout le secteur de vitrine à partir de `organizations.industry`.
 * Priorité à la valeur contrôlée (`normalizeIndustry`), repli sur les
 * mots-clés ci-dessus, puis sur le blueprint générique — jamais d'échec.
 */
export function resolveStorefrontSector(industry: string | null | undefined): StorefrontSector {
  const controlled = normalizeIndustry(industry);
  if (controlled !== "") return controlled;

  if (!industry || !industry.trim()) return "";

  const normalized = normalizeForMatching(industry);
  for (const key of ["retail", "restaurant", "beauty", "real_estate", "professional_services"] as const) {
    if (SECTOR_KEYWORDS[key].some((keyword) => normalized.includes(keyword))) return key;
  }
  return "";
}

export function getStorefrontBlueprint(industry: string | null | undefined): StorefrontBlueprint {
  return STOREFRONT_BLUEPRINTS[resolveStorefrontSector(industry)];
}

/** Titre d'une section pour ce secteur, avec repli sur le blueprint générique puis sur un libellé neutre. */
export function sectionHeading(blueprint: StorefrontBlueprint, type: LandingSectionType, fallback: string): string {
  return blueprint.headings[type] ?? DEFAULT.headings[type] ?? fallback;
}

export function sectionSubheading(blueprint: StorefrontBlueprint, type: LandingSectionType): string | null {
  return blueprint.subheadings[type] ?? null;
}
