import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { KNOWN_ENTITLEMENT_KEYS, PLAN_KEYS, getOrganizationPlanKey, getOrganizationRealPlanKey, type PlanKey } from "./plans-repository";
import { isFeatureEnabled } from "./entitlements-service";

/**
 * Diagnostic d'accès (Super Admin) : pourquoi une fonctionnalité est
 * verrouillée pour une entreprise. Montre, sans deviner, ce que l'application
 * lit réellement : ligne d'abonnement, plan réel/effectif, limites en base,
 * décisions prises, derniers paiements.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fonctionnalités testées : les verrous de plan les plus visibles. */
export const DIAGNOSTIC_FEATURES = [
  "site_customization",
  "unified_comments",
  "automatic_messaging",
  "remove_branding",
  "site_analytics",
] as const;

export interface MissingEntitlement {
  planKey: PlanKey;
  entitlementKey: string;
}

/** Pure : combinaisons (plan × clé connue) sans ligne dans `plan_entitlements`. */
export function findMissingEntitlements(rows: { plan_key: string; entitlement_key: string }[]): MissingEntitlement[] {
  const present = new Set(rows.map((r) => `${r.plan_key}:${r.entitlement_key}`));
  const missing: MissingEntitlement[] = [];
  for (const entitlementKey of [...KNOWN_ENTITLEMENT_KEYS].sort()) {
    for (const planKey of PLAN_KEYS) {
      if (!present.has(`${planKey}:${entitlementKey}`)) missing.push({ planKey, entitlementKey });
    }
  }
  return missing;
}

/** Pure : phrase de lecture rapide pour le Super Admin. */
export function explainAccess(input: {
  hasSubscriptionRow: boolean;
  realPlan: PlanKey;
  effectivePlan: PlanKey;
}): string {
  if (!input.hasSubscriptionRow) {
    return "Aucune ligne d'abonnement : l'application traite ce compte comme Discover (gratuit). Si le client a payé, le paiement n'a pas été appliqué (voir les derniers paiements).";
  }
  if (input.effectivePlan !== input.realPlan) {
    return `Plan souscrit « ${input.realPlan} », mais l'abonnement n'est plus à jour (impayé ou terminé depuis plus de 3 jours) : les droits appliqués sont ceux du plan « ${input.effectivePlan} ».`;
  }
  return `Les droits appliqués sont ceux du plan « ${input.realPlan} ».`;
}

export interface OrganizationDiagnostic {
  organizationId: string;
  organizationName: string;
  subscription: { plan_key: string; status: string; trial_end: string | null; current_period_end: string | null } | null;
  realPlan: PlanKey;
  effectivePlan: PlanKey;
  explanation: string;
  features: { key: string; enabled: boolean; limit: number }[];
  limitsInDb: { plan_key: string; entitlement_key: string; limit_value: number }[];
  payments: { plan_key: string | null; status: string; amount_fcfa: number; created_at: string; payment_type: string }[];
}

export interface DiagnosticResult {
  matches: { id: string; name: string }[];
  detail: OrganizationDiagnostic | null;
  missingEntitlements: MissingEntitlement[];
}

export async function runDiagnostic(query: string): Promise<DiagnosticResult> {
  const supabase = getSupabaseServiceClient();
  const q = query.trim();

  const { data: grid } = await supabase.from("plan_entitlements").select("plan_key, entitlement_key");
  const missingEntitlements = findMissingEntitlements((grid ?? []) as { plan_key: string; entitlement_key: string }[]);
  if (!q) return { matches: [], detail: null, missingEntitlements };

  const orgQuery = supabase.from("organizations").select("id, name").limit(8);
  const { data: orgs } = UUID_RE.test(q) ? await orgQuery.eq("id", q) : await orgQuery.ilike("name", `%${q.replace(/[%_]/g, "")}%`);
  const matches = (orgs ?? []) as { id: string; name: string }[];
  const only = matches.length === 1 ? matches[0] : undefined;
  if (!only) return { matches, detail: null, missingEntitlements };

  const [{ data: sub }, realPlan, effectivePlan, payments] = await Promise.all([
    supabase.from("organization_subscriptions").select("plan_key, status, trial_end, current_period_end").eq("organization_id", only.id).maybeSingle(),
    getOrganizationRealPlanKey(only.id),
    getOrganizationPlanKey(only.id),
    supabase
      .from("subscription_payments")
      .select("plan_key, status, amount_fcfa, created_at, payment_type")
      .eq("organization_id", only.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  const planSet = [...new Set([realPlan, effectivePlan])];
  const [{ data: limits }, features] = await Promise.all([
    supabase.from("plan_entitlements").select("plan_key, entitlement_key, limit_value").in("plan_key", planSet).in("entitlement_key", [...DIAGNOSTIC_FEATURES]),
    Promise.all(DIAGNOSTIC_FEATURES.map(async (key) => ({ key: key as string, ...(await isFeatureEnabled(only.id, key)) }))),
  ]);

  return {
    matches,
    missingEntitlements,
    detail: {
      organizationId: only.id,
      organizationName: only.name,
      subscription: (sub as OrganizationDiagnostic["subscription"]) ?? null,
      realPlan,
      effectivePlan,
      explanation: explainAccess({ hasSubscriptionRow: Boolean(sub), realPlan, effectivePlan }),
      features,
      limitsInDb: (limits ?? []) as OrganizationDiagnostic["limitsInDb"],
      payments: (payments.data ?? []) as OrganizationDiagnostic["payments"],
    },
  };
}
