import type { PlanKey } from "@/application/services/plans-repository";

/**
 * Lot O — fonctionnalités verrouillées par plan (freemium v2).
 * Source unique du libellé et du plan minimal affichés dans les messages
 * « disponible à partir de … » (pages, services, actions serveur). Le
 * verrou RÉEL reste `plan_entitlements` (clé = `entitlementKey`) : changer
 * un plan depuis /admin/plans suffit, sans toucher ce fichier — `minPlan`
 * n'est qu'un texte d'aide.
 */
export type GatedFeatureKey =
  | "crm"
  | "follow_ups"
  | "orders"
  | "appointments"
  | "site_analytics"
  | "custom_domain"
  | "remove_branding"
  | "automatic_messaging"
  | "contact_broadcasts";

export interface GatedFeature {
  /** Clé `plan_entitlements` qui porte le verrou. */
  entitlementKey: string;
  label: string;
  description: string;
  minPlan: PlanKey;
}

export const GATED_FEATURES: Record<GatedFeatureKey, GatedFeature> = {
  crm: {
    entitlementKey: "crm",
    label: "CRM complet",
    description: "Pipeline commercial, score d'engagement et suivi de vos prospects.",
    minPlan: "starter",
  },
  follow_ups: {
    entitlementKey: "follow_ups",
    label: "Relances automatiques",
    description: "Relances clients à 24 h et 48 h, envoyées sur le canal de la conversation.",
    minPlan: "starter",
  },
  orders: {
    entitlementKey: "orders",
    label: "Commandes",
    description: "Suivi des commandes, stock et statuts selon votre secteur d'activité.",
    minPlan: "starter",
  },
  appointments: {
    entitlementKey: "appointments",
    label: "Rendez-vous",
    description: "Agenda et demandes de rendez-vous depuis votre site public.",
    minPlan: "starter",
  },
  site_analytics: {
    entitlementKey: "site_analytics",
    label: "Analytique du site",
    description: "Visites, sources de trafic et pages consultées sur votre site public.",
    minPlan: "starter",
  },
  custom_domain: {
    entitlementKey: "custom_domain",
    label: "Domaine personnalisé",
    description: "Votre propre nom de domaine pour votre site public.",
    minPlan: "starter",
  },
  remove_branding: {
    entitlementKey: "remove_branding",
    label: "Site sans badge CRESYVA",
    description: "Retire la mention « Site propulsé par CRESYVA » du bas de votre site.",
    minPlan: "pro",
  },
  automatic_messaging: {
    entitlementKey: "automatic_messaging",
    label: "Messagerie automatique avec IA",
    description: "Réponses automatiques complètes, avec l'IA en dernier recours.",
    minPlan: "starter",
  },
  contact_broadcasts: {
    entitlementKey: "broadcast_contacts",
    label: "Diffusion vers vos contacts",
    description: "Envoyez une même annonce à plusieurs de vos contacts en une campagne.",
    minPlan: "starter",
  },
};

export const PLAN_LABELS: Record<PlanKey, string> = {
  free: "Discover",
  starter: "Starter",
  pro: "Pro",
};
