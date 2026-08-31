/**
 * Catalogue des modules activables par tenant (section 33 doc 1 / section 5
 * doc 2). Révisé pour refléter le scope doc 2 — voir docs/GAP_ANALYSIS.md
 * section F : `automation` et `ai_insights` ont été explicitement retirés
 * (hors MVP). Ajouter un module ici NE l'active pour aucun tenant — il faut
 * une ligne dans `tenant_modules` avec enabled=true.
 */
export const MODULE_KEYS = [
  "crm",
  "catalog",
  "landing",
  "whatsapp",
  "faq",
  "ai",
  "orders",
  "appointments",
  "inventory",
  "finance",
  "marketing",
  "analytics",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModuleDefinition {
  key: ModuleKey;
  label: string;
  description: string;
  /** Modules qui doivent être actifs pour que celui-ci ait du sens */
  dependsOn?: ModuleKey[];
}

export const MODULE_DEFINITIONS: Record<ModuleKey, ModuleDefinition> = {
  crm: {
    key: "crm",
    label: "CRM & Conversations",
    description: "Contacts, leads, conversations, suivi commercial.",
  },
  catalog: {
    key: "catalog",
    label: "Catalogue",
    description: "Produits, services, catégories — source de vérité unique (section 2 doc 2).",
  },
  landing: {
    key: "landing",
    label: "Landing page",
    description: "Vitrine dynamique alimentée par le catalogue et les données business.",
    dependsOn: ["catalog"],
  },
  whatsapp: {
    key: "whatsapp",
    label: "WhatsApp (Zernio)",
    description: "Réception/envoi de messages, product discovery, human handoff.",
    dependsOn: ["crm"],
  },
  faq: {
    key: "faq",
    label: "FAQ",
    description: "Réponses automatiques sans appel IA pour les questions fréquentes.",
  },
  ai: {
    key: "ai",
    label: "IA contrôlée",
    description: "Dernier recours de l'orchestrateur, jamais le premier (section 45 doc 2).",
  },
  orders: {
    key: "orders",
    label: "Commandes",
    description: "Commandes produits/services, sans paiement intégré (hors MVP).",
    dependsOn: ["catalog"],
  },
  appointments: {
    key: "appointments",
    label: "Rendez-vous",
    description: "Prise de rendez-vous, agenda par employé.",
    dependsOn: ["crm"],
  },
  inventory: {
    key: "inventory",
    label: "Stock",
    description: "Suivi stock, transition automatique vers OUT_OF_STOCK.",
    dependsOn: ["catalog"],
  },
  finance: {
    key: "finance",
    label: "Finance légère",
    description: "Revenus, dépenses, résultat simplifié — pas de comptabilité complète.",
  },
  marketing: {
    key: "marketing",
    label: "Marketing & Publications",
    description: "Publication sociale via Zernio à partir du catalogue.",
    dependsOn: ["catalog"],
  },
  analytics: {
    key: "analytics",
    label: "Analytics",
    description: "Publications, vues, clics — pas d'AI Insights (hors MVP).",
  },
};

/**
 * Presets d'industrie — volontairement PAS un enum fermé au niveau DB
 * (organizations.industry est un `text` libre). Ceci ne sert qu'à
 * pré-cocher des modules pendant l'onboarding.
 */
export const INDUSTRY_MODULE_PRESETS: Record<string, ModuleKey[]> = {
  beauty: ["crm", "catalog", "landing", "whatsapp", "faq", "ai", "appointments", "finance", "marketing"],
  restaurant: ["crm", "catalog", "landing", "whatsapp", "faq", "ai", "orders", "inventory", "finance", "marketing"],
  real_estate: ["crm", "catalog", "landing", "whatsapp", "faq", "ai", "finance", "marketing"],
  retail: ["crm", "catalog", "landing", "whatsapp", "faq", "ai", "orders", "inventory", "finance", "marketing"],
  professional_services: ["crm", "catalog", "landing", "whatsapp", "faq", "ai", "appointments", "finance", "marketing"],
};
