import type { PlanKey } from "@/application/services/plans-repository";

export const PLAN_ORDER: PlanKey[] = ["free", "starter", "pro"];

export type PricingFeature = {
  key: string;
  label: string;
  values: Record<PlanKey, string | boolean>;
  group: string;
};

/**
 * Grille commerciale visible sur /tarifs.
 * Les quotas numériques de contrôle côté serveur restent dans
 * `plan_entitlements`; cette matrice décrit exactement la promesse
 * commerciale et évite de masquer les limites importantes derrière une
 * liste technique d'entitlements.
 */
export const PRICING_FEATURES: PricingFeature[] = [
  { key: "site", label: "Site public professionnel", group: "Vitrine & catalogue", values: { free: true, starter: "Personnalisable", pro: "Personnalisable" } },
  { key: "catalog", label: "Catalogue", group: "Vitrine & catalogue", values: { free: "100 produits max", starter: "1 000 produits max", pro: "2 000 produits max" } },
  { key: "telegram_bots", label: "Bots Telegram", group: "Canaux", values: { free: "1", starter: "3", pro: "10" } },
  { key: "telegram_groups", label: "Groupes / canaux Telegram", group: "Canaux", values: { free: "2", starter: "5", pro: "20" } },
  { key: "youtube", label: "Comptes YouTube", group: "Canaux", values: { free: "1", starter: "3", pro: "10" } },
  { key: "whatsapp", label: "Comptes WhatsApp", group: "Canaux", values: { free: false, starter: "1", pro: "3" } },
  { key: "whatsapp_groups", label: "Groupes WhatsApp", group: "Canaux", values: { free: false, starter: "3 (+2 avec numéro dédié)", pro: "6 (+4 avec numéro dédié)" } },
  { key: "facebook", label: "Pages professionnelles Facebook", group: "Réseaux sociaux", values: { free: false, starter: "1", pro: "3" } },
  { key: "linkedin", label: "Pages LinkedIn", group: "Réseaux sociaux", values: { free: false, starter: false, pro: "1" } },
  { key: "instagram", label: "Comptes Instagram", group: "Réseaux sociaux", values: { free: false, starter: false, pro: "2" } },
  { key: "tiktok", label: "Comptes TikTok", group: "Réseaux sociaux", values: { free: false, starter: false, pro: "2" } },
  { key: "facebook_comments", label: "Réponse automatique aux commentaires Facebook", group: "Réseaux sociaux", values: { free: false, starter: true, pro: true } },
  { key: "instagram_comments", label: "Réponse automatique aux commentaires Instagram", group: "Réseaux sociaux", values: { free: false, starter: false, pro: true } },
  { key: "unified_comments", label: "Commentaires unifiés", group: "Réseaux sociaux", values: { free: false, starter: false, pro: true } },
  { key: "ai", label: "Crédits IA / mois", group: "Automatisation & communication", values: { free: "0", starter: "150", pro: "300" } },
  { key: "messaging", label: "Messagerie", group: "Automatisation & communication", values: { free: "Semi-automatique (FAQ, entreprise, catalogue)", starter: "Automatique + IA", pro: "Automatique + IA" } },
  { key: "broadcast", label: "Broadcast", group: "Automatisation & communication", values: { free: false, starter: "50 contacts / campagne", pro: "100 contacts / campagne" } },
  { key: "publications", label: "Publication immédiate et programmée", group: "Automatisation & communication", values: { free: true, starter: true, pro: true } },
  { key: "crm", label: "CRM & notes prospects", group: "Gestion", values: { free: true, starter: true, pro: true } },
  { key: "orders", label: "Commandes selon le secteur", group: "Gestion", values: { free: true, starter: true, pro: true } },
  { key: "appointments", label: "Rendez-vous selon le secteur", group: "Gestion", values: { free: true, starter: true, pro: true } },
  { key: "analytics", label: "Analytique des réseaux + site", group: "Gestion", values: { free: true, starter: true, pro: true } },
  { key: "finance", label: "Finance", group: "Gestion", values: { free: true, starter: true, pro: true } },
  { key: "push", label: "Notifications push", group: "Gestion", values: { free: true, starter: true, pro: true } },
  { key: "team", label: "Membres de l'équipe", group: "Gestion", values: { free: "1", starter: "3", pro: "6" } },
];

export const RECOMMENDED_PLAN_PRICES: Record<PlanKey, number> = {
  free: 0,
  starter: 15000,
  pro: 30000,
};
