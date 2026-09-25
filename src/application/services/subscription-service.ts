import { canUseFeature, type EntitlementCheckResult } from "./entitlements-service";
import { getOrganizationSubscription, listPlanPricesForCountry, type OrganizationSubscriptionStatus, type PlanKey } from "./plans-repository";
import { getOrganizationCountryCode } from "./country-service";

/**
 * Lot B (section 78) — agrège tout ce dont la page /dashboard/subscription
 * a besoin. Réutilise `canUseFeature()` pour CHAQUE jauge affichée plutôt
 * que de relire les tables directement : garantit que ce que le
 * commerçant voit correspond exactement à ce qui est appliqué côté
 * serveur (une seule source de vérité, jamais deux implémentations qui
 * pourraient diverger).
 */

export interface UsageGauge {
  key: string;
  label: string;
  /** cumulative = jauge "N / limite" ; capped = plafond par action, pas de compteur cumulé à afficher. */
  mode: "cumulative" | "capped";
  result: EntitlementCheckResult;
}

export interface FeatureFlag {
  key: string;
  label: string;
  included: boolean;
}

export interface PlanComparisonRow {
  key: PlanKey;
  name: string;
  priceFcfa: number;
  description: string | null;
  isCurrent: boolean;
}

export interface SubscriptionOverview {
  planKey: PlanKey;
  planName: string;
  status: OrganizationSubscriptionStatus;
  usage: UsageGauge[];
  features: FeatureFlag[];
  plans: PlanComparisonRow[];
}

/**
 * Lot 4 : exporté (n'était qu'un détail interne de ce fichier jusqu'ici)
 * pour qu'`admin-plans-service.ts` réutilise EXACTEMENT le même
 * catalogue de clés/libellés côté Super Admin plutôt que d'en tenir une
 * seconde liste qui pourrait diverger (section 100 du master prompt :
 * "ne pas dupliquer la logique... une seule source de vérité par
 * responsabilité"). 'ai_credits' délègue à getCreditStatus() pour la
 * LECTURE d'usage (voir canUseFeature ci-dessous) mais sa limite de base
 * reste bien une ligne `plan_entitlements` comme les autres clés — donc
 * éditable au même titre depuis /admin/plans.
 */
export const USAGE_GAUGES: { key: string; label: string; mode: "cumulative" | "capped" }[] = [
  { key: "ai_credits", label: "Crédits IA", mode: "cumulative" },
  { key: "catalog_products", label: "Produits du catalogue", mode: "cumulative" },
  { key: "team_members", label: "Membres de l’équipe", mode: "cumulative" },
  { key: "whatsapp_groups", label: "Groupes WhatsApp", mode: "cumulative" },
  // Lot O — multi-comptes réels : jauges « N / limite » sur les comptes et
  // destinations effectivement enregistrés.
  { key: "telegram_bots", label: "Bots Telegram", mode: "cumulative" },
  { key: "telegram_channels", label: "Canaux Telegram", mode: "cumulative" },
  { key: "telegram_groups", label: "Groupes Telegram", mode: "cumulative" },
  { key: "youtube_accounts", label: "Comptes YouTube", mode: "cumulative" },
  { key: "facebook_pages", label: "Pages Facebook", mode: "cumulative" },
  { key: "instagram_accounts", label: "Comptes Instagram", mode: "cumulative" },
  { key: "linkedin_pages", label: "Pages LinkedIn", mode: "cumulative" },
  { key: "tiktok_accounts", label: "Comptes TikTok", mode: "cumulative" },
  { key: "broadcast_contacts", label: "Contacts par campagne de diffusion", mode: "capped" },
];

export const FEATURE_FLAGS: { key: string; label: string }[] = [
  { key: "whatsapp", label: "WhatsApp (messagerie)" },
  { key: "facebook_messenger", label: "Messages Facebook Messenger" },
  { key: "instagram_messages", label: "Messages Instagram" },
  { key: "automatic_messaging", label: "Messagerie automatique avec IA" },
  { key: "crm", label: "CRM complet (pipeline, score, relances)" },
  { key: "orders", label: "Commandes" },
  { key: "appointments", label: "Rendez-vous" },
  { key: "site_analytics", label: "Analytique du site" },
  { key: "custom_domain", label: "Domaine personnalisé" },
  { key: "remove_branding", label: "Retrait du badge flexco " },
  { key: "facebook_auto_comments", label: "Réponse automatique aux commentaires Facebook" },
  { key: "instagram_auto_comments", label: "Réponse automatique aux commentaires Instagram" },
  { key: "unified_comments", label: "Commentaires unifiés" },
  { key: "linkedin", label: "Publications LinkedIn" },
  { key: "tiktok", label: "Publications TikTok" },
];

export async function getSubscriptionOverview(organizationId: string): Promise<SubscriptionOverview> {
  // CORRECTIF (2026-09-21, signalement utilisateur : prix affiché au
  // dashboard 30 000 FCFA alors que le checkout facturait 39 900 FCFA)
  // — auparavant `listPlans()` lisait le prix PAR DÉFAUT de `plans`,
  // alors qu'`initiatePayment()` (subscription-payment-service.ts)
  // facture le prix RÉSOLU POUR LE PAYS de l'organisation via
  // `resolvePlanPriceForCountry()` (Country Engine, `plan_prices`).
  // Une ligne `plan_prices` active mais désynchronisée de
  // `plans.price_fcfa` faisait donc diverger silencieusement "ce qui
  // est montré" de "ce qui est facturé". `listPlanPricesForCountry()`
  // applique exactement la même résolution (et le même repli) que le
  // paiement : ce que voit le commerçant est GARANTI identique à ce
  // qu'il paiera, quel que soit son pays.
  const [subscription, countryCode] = await Promise.all([
    getOrganizationSubscription(organizationId),
    getOrganizationCountryCode(organizationId),
  ]);
  const plans = await listPlanPricesForCountry(countryCode);

  const [usageResults, featureResults] = await Promise.all([
    Promise.all(USAGE_GAUGES.map((g) => canUseFeature(organizationId, g.key, 1))),
    Promise.all(FEATURE_FLAGS.map((f) => canUseFeature(organizationId, f.key, 1))),
  ]);

  const usage: UsageGauge[] = USAGE_GAUGES.map((g, i) => ({
    key: g.key,
    label: g.label,
    mode: g.mode,
    // requestedAmount=1 dans canUseFeature ci-dessus : les tableaux ont
    // toujours la même longueur (map 1:1), l'accès indexé est donc sûr
    // malgré `noUncheckedIndexedAccess`.
    result: usageResults[i] as EntitlementCheckResult,
  }));

  const features: FeatureFlag[] = FEATURE_FLAGS.map((f, i) => ({
    key: f.key,
    label: f.label,
    included: (featureResults[i] as EntitlementCheckResult).allowed,
  }));

  const currentPlan = plans.find((p) => p.key === subscription.planKey);

  return {
    planKey: subscription.planKey,
    planName: currentPlan?.name ?? subscription.planKey,
    status: subscription.status,
    usage,
    features,
    // `p.amount` (prix RÉSOLU pour le pays de cette organisation), jamais
    // `p.priceFcfa` (prix par défaut brut, toujours présent sur `p` mais
    // qui a causé le bug d'origine : c'est lui qui divergeait du montant
    // réellement facturé). Voir le commentaire au-dessus de l'appel à
    // `listPlanPricesForCountry()` plus haut dans cette fonction.
    plans: plans.map((p) => ({
      key: p.key,
      name: p.name,
      priceFcfa: p.amount,
      description: p.description,
      isCurrent: p.key === subscription.planKey,
    })),
  };
}
