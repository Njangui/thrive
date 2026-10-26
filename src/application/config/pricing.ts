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
  { key: "custom_domain", label: "Domaine personnalisé", group: "Vitrine & catalogue", values: { free: "Sur demande, hors forfait", starter: "Sur demande, hors forfait", pro: "Sur demande, hors forfait" } },
  { key: "remove_branding", label: "Site sans badge « propulsé par Flexco »", group: "Vitrine & catalogue", values: { free: false, starter: true, pro: true } },
  { key: "catalog", label: "Catalogue", group: "Vitrine & catalogue", values: { free: "100 produits max", starter: "1 000 produits max", pro: "2 000 produits max" } },
  { key: "telegram_bots", label: "Bots Telegram", group: "Canaux", values: { free: "1", starter: "3", pro: "10" } },
  { key: "telegram_channels", label: "Canaux Telegram", group: "Canaux", values: { free: "1", starter: "3", pro: "12" } },
  { key: "telegram_groups", label: "Groupes Telegram", group: "Canaux", values: { free: "1", starter: "2", pro: "8" } },
  { key: "youtube", label: "Comptes YouTube", group: "Canaux", values: { free: "1", starter: "3", pro: "10" } },
  { key: "whatsapp", label: "Comptes WhatsApp", group: "Canaux", values: { free: false, starter: "1", pro: "3" } },
  { key: "whatsapp_groups", label: "Groupes WhatsApp", group: "Canaux", values: { free: false, starter: "3 (+2 avec numéro dédié)", pro: "6 (+4 avec numéro dédié)" } },
  { key: "facebook", label: "Pages professionnelles Facebook", group: "Réseaux sociaux", values: { free: false, starter: "1", pro: "3" } },
  { key: "linkedin", label: "Pages LinkedIn", group: "Réseaux sociaux", values: { free: false, starter: false, pro: "1" } },
  { key: "instagram", label: "Comptes Instagram", group: "Réseaux sociaux", values: { free: false, starter: false, pro: "2" } },
  { key: "tiktok", label: "Comptes TikTok", group: "Réseaux sociaux", values: { free: false, starter: false, pro: "2" } },
  { key: "facebook_comments", label: "Réponse automatique aux commentaires Facebook", group: "Réseaux sociaux", values: { free: false, starter: true, pro: true } },
  { key: "instagram_comments", label: "Réponse automatique aux commentaires Instagram", group: "Réseaux sociaux", values: { free: false, starter: false, pro: true } },
  { key: "tiktok_comments", label: "Réponse automatique aux commentaires TikTok", group: "Réseaux sociaux", values: { free: false, starter: false, pro: true } },
  { key: "unified_comments", label: "Commentaires unifiés", group: "Réseaux sociaux", values: { free: false, starter: "Facebook", pro: "Facebook + Instagram" } },
  { key: "first_comment", label: "Premier commentaire automatique", group: "Réseaux sociaux", values: { free: false, starter: "Facebook", pro: "Facebook, Instagram, LinkedIn, TikTok" } },
  { key: "ai", label: "Crédits IA / mois", group: "Automatisation & communication", values: { free: "0", starter: "150", pro: "300" } },
  { key: "messaging", label: "Messagerie", group: "Automatisation & communication", values: { free: "Semi-automatique (FAQ, entreprise, catalogue)", starter: "Automatique + IA", pro: "Automatique + IA" } },
  { key: "unified_inbox", label: "Messagerie unifiée", group: "Automatisation & communication", values: { free: "Telegram", starter: "WhatsApp, Telegram, Messenger", pro: "WhatsApp, Telegram, Messenger, Instagram" } },
  { key: "broadcast", label: "Diffusion vers vos contacts", group: "Automatisation & communication", values: { free: false, starter: "50 contacts / campagne", pro: "100 contacts / campagne" } },
  { key: "publications", label: "Publication immédiate et programmée", group: "Automatisation & communication", values: { free: true, starter: true, pro: true } },
  { key: "prospect_notes", label: "Notes sur les prospects", group: "Gestion", values: { free: true, starter: true, pro: true } },
  { key: "crm", label: "CRM complet (pipeline, score, relances automatiques)", group: "Gestion", values: { free: false, starter: true, pro: true } },
  { key: "orders", label: "Commandes selon le secteur", group: "Gestion", values: { free: false, starter: true, pro: true } },
  { key: "appointments", label: "Rendez-vous selon le secteur", group: "Gestion", values: { free: false, starter: true, pro: true } },
  { key: "analytics", label: "Analytique des réseaux", group: "Gestion", values: { free: true, starter: true, pro: true } },
  { key: "site_analytics", label: "Analytique du site", group: "Gestion", values: { free: false, starter: true, pro: true } },
  { key: "video_retention", label: "Conservation des vidéos du catalogue", group: "Vitrine & catalogue", values: { free: "7 jours", starter: "30 jours", pro: "90 jours" } },
  { key: "finance", label: "Finance", group: "Gestion", values: { free: true, starter: true, pro: true } },
  { key: "push", label: "Notifications push", group: "Gestion", values: { free: true, starter: true, pro: true } },
  { key: "team", label: "Membres de l'équipe", group: "Gestion", values: { free: "1", starter: "3", pro: "6" } },
];

export const RECOMMENDED_PLAN_PRICES: Record<PlanKey, number> = {
  free: 0,
  starter: 15000,
  pro: 30000,
};

/**
 * Source UNIQUE des quotas affichés (décision Q11, audit P-tarifs) : les chiffres de la page /tarifs
 * sont lus dans `plan_entitlements` (la table qui applique réellement les limites côté serveur),
 * pas recopiés à la main. Le texte statique de PRICING_FEATURES ne sert plus que de repli pour
 * les lignes non numériques ou absentes de la base.
 */
export type LimitsByPlan = Partial<Record<PlanKey, Record<string, number>>>;

const countOrOff = (n: number): string | boolean => (n === 0 ? false : n === -1 ? "Illimité" : String(n));

const LIMIT_FORMATTERS: Record<string, { entitlement: string; format: (n: number, limits: Record<string, number>) => string | boolean }> = {
  catalog: { entitlement: "catalog_products", format: (n) => (n === -1 ? "Illimité" : `${n} produits max`) },
  telegram_bots: { entitlement: "telegram_bots", format: countOrOff },
  telegram_channels: { entitlement: "telegram_channels", format: countOrOff },
  telegram_groups: { entitlement: "telegram_groups", format: countOrOff },
  youtube: { entitlement: "youtube_accounts", format: countOrOff },
  whatsapp: { entitlement: "whatsapp", format: countOrOff },
  whatsapp_groups: {
    entitlement: "whatsapp_groups",
    format: (n, limits) => {
      const base = countOrOff(n);
      const bonus = limits["whatsapp_groups_dedicated_bonus"] ?? 0;
      return typeof base === "string" && bonus > 0 ? `${base} (+${bonus} avec numéro dédié)` : base;
    },
  },
  facebook: { entitlement: "facebook_pages", format: countOrOff },
  linkedin: { entitlement: "linkedin_pages", format: countOrOff },
  instagram: { entitlement: "instagram_accounts", format: countOrOff },
  tiktok: { entitlement: "tiktok_accounts", format: countOrOff },
  ai: { entitlement: "ai_credits", format: (n) => (n === -1 ? "Illimité" : String(n)) },
  broadcast: { entitlement: "broadcast_contacts", format: (n) => (n === 0 ? false : n === -1 ? "Illimité" : `${n} contacts / campagne`) },
  video_retention: { entitlement: "video_retention_days", format: (n) => (n === -1 ? "Illimitée" : `${n} jours`) },
  team: { entitlement: "team_members", format: countOrOff },
};

/** Pure : remplace les valeurs chiffrées par celles de la base, garde le texte statique si la limite n'est pas configurée. */
export function applyDbLimits(features: PricingFeature[], limits: LimitsByPlan): PricingFeature[] {
  return features.map((feature) => {
    const formatter = LIMIT_FORMATTERS[feature.key];
    if (!formatter) return feature;
    const values = { ...feature.values };
    for (const plan of PLAN_ORDER) {
      const planLimits = limits[plan];
      const raw = planLimits?.[formatter.entitlement];
      if (planLimits && typeof raw === "number") values[plan] = formatter.format(raw, planLimits);
    }
    return { ...feature, values };
  });
}
