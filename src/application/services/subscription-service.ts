import { canUseFeature, type EntitlementCheckResult } from "./entitlements-service";
import { getOrganizationSubscription, listPlans, type OrganizationSubscriptionStatus, type PlanKey } from "./plans-repository";

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
  { key: "broadcast_contacts", label: "Contacts par campagne de diffusion", mode: "capped" },
  { key: "social_accounts", label: "Comptes réseaux sociaux par publication", mode: "capped" },
];

export const FEATURE_FLAGS: { key: string; label: string }[] = [
  { key: "whatsapp", label: "WhatsApp (messagerie)" },
  { key: "facebook_messenger", label: "Messages Facebook Messenger" },
  { key: "instagram_messages", label: "Messages Instagram" },
  { key: "linkedin", label: "Publications LinkedIn" },
  { key: "tiktok", label: "Publications TikTok" },
];

export async function getSubscriptionOverview(organizationId: string): Promise<SubscriptionOverview> {
  const [subscription, plans] = await Promise.all([
    getOrganizationSubscription(organizationId),
    listPlans(),
  ]);

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
    plans: plans.map((p) => ({ ...p, isCurrent: p.key === subscription.planKey })),
  };
}
