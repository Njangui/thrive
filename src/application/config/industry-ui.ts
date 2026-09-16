import type { ModuleKey } from "./modules";

export type IndustryKey = "retail" | "restaurant" | "beauty" | "professional_services" | "real_estate" | "";

export interface IndustryUiConfig {
  key: IndustryKey;
  label: string;
  eyebrow: string;
  catalogLabel: string;
  catalogDescription: string;
  primaryMetric: string;
  primaryAction: string;
  secondaryMetric: string;
}

const DEFAULT_CONFIG: IndustryUiConfig = {
  key: "",
  label: "Entreprise",
  eyebrow: "Vue d’ensemble",
  catalogLabel: "Catalogue",
  catalogDescription: "Produits et services de votre entreprise.",
  primaryMetric: "Activité",
  primaryAction: "Ajouter",
  secondaryMetric: "Demandes",
};

export const INDUSTRY_UI: Record<IndustryKey, IndustryUiConfig> = {
  "": DEFAULT_CONFIG,
  retail: {
    key: "retail",
    label: "Commerce / Boutique",
    eyebrow: "Pilotage de votre boutique",
    catalogLabel: "Produits",
    catalogDescription: "Produits, prix, catégories et stock.",
    primaryMetric: "Ventes",
    primaryAction: "Ajouter un produit",
    secondaryMetric: "Commandes",
  },
  restaurant: {
    key: "restaurant",
    label: "Restauration",
    eyebrow: "Pilotage de votre restaurant",
    catalogLabel: "Menu",
    catalogDescription: "Plats, prix, catégories et disponibilité.",
    primaryMetric: "Ventes",
    primaryAction: "Ajouter au menu",
    secondaryMetric: "Commandes",
  },
  beauty: {
    key: "beauty",
    label: "Beauté & bien-être",
    eyebrow: "Pilotage de votre activité",
    catalogLabel: "Prestations",
    catalogDescription: "Prestations, tarifs et disponibilité.",
    primaryMetric: "Revenus",
    primaryAction: "Ajouter une prestation",
    secondaryMetric: "Rendez-vous",
  },
  professional_services: {
    key: "professional_services",
    label: "Services professionnels",
    eyebrow: "Pilotage de vos services",
    catalogLabel: "Services",
    catalogDescription: "Vos services, tarifs et informations clients.",
    primaryMetric: "Revenus",
    primaryAction: "Ajouter un service",
    secondaryMetric: "Rendez-vous",
  },
  real_estate: {
    key: "real_estate",
    label: "Immobilier",
    eyebrow: "Pilotage de votre portefeuille",
    catalogLabel: "Biens",
    catalogDescription: "Biens, prix, disponibilité et demandes.",
    primaryMetric: "Revenus",
    primaryAction: "Ajouter un bien",
    secondaryMetric: "Prospects",
  },
};

export function normalizeIndustry(value: string | null | undefined): IndustryKey {
  if (value && value in INDUSTRY_UI) return value as IndustryKey;
  return "";
}

export function getIndustryUi(value: string | null | undefined): IndustryUiConfig {
  return INDUSTRY_UI[normalizeIndustry(value)];
}

export function getIndustryModules(value: string | null | undefined): ModuleKey[] {
  const key = normalizeIndustry(value);
  const presets: Record<IndustryKey, ModuleKey[]> = {
    "": ["crm", "catalog", "landing", "whatsapp", "faq", "ai", "finance"],
    retail: ["crm", "catalog", "landing", "whatsapp", "faq", "ai", "orders", "inventory", "finance", "marketing"],
    restaurant: ["crm", "catalog", "landing", "whatsapp", "faq", "ai", "orders", "inventory", "finance", "marketing"],
    beauty: ["crm", "catalog", "landing", "whatsapp", "faq", "ai", "appointments", "finance", "marketing"],
    professional_services: ["crm", "catalog", "landing", "whatsapp", "faq", "ai", "appointments", "finance", "marketing"],
    real_estate: ["crm", "catalog", "landing", "whatsapp", "faq", "ai", "finance", "marketing"],
  };
  return presets[key];
}
