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
  /** null si le tenant n'est pas en période d'essai. */
  trialDaysRemaining: number | null;
  usage: UsageGauge[];
  features: FeatureFlag[];
  plans: PlanComparisonRow[];
}

const USAGE_GAUGES: { key: string; label: string; mode: "cumulative" | "capped" }[] = [
  { key: "ai_credits", label: "Crédits IA", mode: "cumulative" },
  { key: "whatsapp_groups", label: "Groupes WhatsApp", mode: "cumulative" },
  { key: "broadcast_contacts", label: "Contacts par campagne de diffusion", mode: "capped" },
  { key: "social_accounts", label: "Comptes réseaux sociaux par publication", mode: "capped" },
];

const FEATURE_FLAGS: { key: string; label: string }[] = [
  { key: "facebook_messenger", label: "Messages Facebook Messenger" },
  { key: "instagram_messages", label: "Messages Instagram" },
  { key: "linkedin", label: "Publications LinkedIn" },
  { key: "tiktok", label: "Publications TikTok" },
];

function computeTrialDaysRemaining(status: OrganizationSubscriptionStatus, trialEnd: string | null): number | null {
  if (status !== "trialing" || !trialEnd) return null;
  const msRemaining = new Date(trialEnd).getTime() - Date.now();
  return Math.max(Math.ceil(msRemaining / (24 * 60 * 60 * 1000)), 0);
}

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
    trialDaysRemaining: computeTrialDaysRemaining(subscription.status, subscription.trialEnd),
    usage,
    features,
    plans: plans.map((p) => ({ ...p, isCurrent: p.key === subscription.planKey })),
  };
}
