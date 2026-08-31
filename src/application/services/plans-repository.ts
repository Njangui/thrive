import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

/**
 * Lot B — accès bas niveau aux tables `plans` / `plan_entitlements` /
 * `organization_subscriptions` (0012_plans_entitlements.sql). Module
 * volontairement séparé d'`entitlements-service.ts` : `ai-credits-
 * service.ts` a besoin des mêmes lectures (résoudre le plan d'une
 * organisation, lire une limite) pour `initializeCreditBalance()`, et
 * `entitlements-service.ts` a besoin de `getCreditStatus()` (ai-credits-
 * service.ts) pour la clé `ai_credits` — sans ce fichier intermédiaire,
 * les deux services s'importeraient l'un l'autre en cercle.
 *
 * Aucune fonction ici ne lève jamais pour une ligne absente : un tenant
 * mal configuré (créé avant ce lot, ou une clé d'entitlement pas encore
 * seedée) doit dégrader vers un comportement permissif ("starter" /
 * "illimité"), jamais planter une vérification de droits (critère
 * d'acceptation Lot B).
 */

export const PLAN_KEYS = ["starter", "business", "pro"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export type OrganizationSubscriptionStatus = "trialing" | "active" | "past_due" | "cancelled";

export interface OrganizationSubscription {
  organizationId: string;
  planKey: PlanKey;
  status: OrganizationSubscriptionStatus;
  trialStart: string | null;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
}

export interface PlanSummary {
  key: PlanKey;
  name: string;
  priceFcfa: number;
  description: string | null;
}

export interface PlanEntitlementRow {
  entitlementKey: string;
  limitValue: number; // -1 = illimité
}

function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && (PLAN_KEYS as readonly string[]).includes(value);
}

/**
 * Résout le plan effectif d'une organisation. Retourne toujours une
 * valeur exploitable : "starter" si aucune ligne `organization_subscriptions`
 * n'existe (tenant créé avant ce lot) ou en cas d'erreur de lecture —
 * ne lève jamais.
 */
export async function getOrganizationPlanKey(organizationId: string): Promise<PlanKey> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("organization_subscriptions")
    .select("plan_key")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    console.error(`getOrganizationPlanKey(${organizationId}) erreur de lecture, plan "starter" par défaut:`, error.message);
    return "starter";
  }
  if (!data || !isPlanKey(data.plan_key)) {
    return "starter";
  }
  return data.plan_key;
}

/**
 * Lit la ligne `organization_subscriptions` complète, avec des valeurs
 * par défaut cohérentes si elle n'existe pas encore (tenant pré-Lot B).
 * Utilisé par le dashboard "Mon abonnement" (countdown d'essai, statut).
 */
export async function getOrganizationSubscription(organizationId: string): Promise<OrganizationSubscription> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("organization_subscriptions")
    .select("plan_key, status, trial_start, trial_end, current_period_end")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    console.error(`getOrganizationSubscription(${organizationId}) erreur de lecture:`, error.message);
  }

  if (!data) {
    return {
      organizationId,
      planKey: "starter",
      status: "trialing",
      trialStart: null,
      trialEnd: null,
      currentPeriodEnd: null,
    };
  }

  return {
    organizationId,
    planKey: isPlanKey(data.plan_key) ? data.plan_key : "starter",
    status: (data.status as OrganizationSubscriptionStatus | null) ?? "trialing",
    trialStart: data.trial_start,
    trialEnd: data.trial_end,
    currentPeriodEnd: data.current_period_end,
  };
}

/**
 * Crée la ligne d'abonnement par défaut à l'onboarding (section 78 :
 * plan "starter", essai de `trialDays` jours). Idempotent : si une ligne
 * existe déjà pour cette organisation (ne devrait pas arriver, l'org
 * vient d'être créée, mais on reste défensif), on ne l'écrase pas.
 */
export async function createTrialSubscription(
  organizationId: string,
  planKey: PlanKey = "starter",
  trialDays = 14,
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const trialStart = new Date();
  const trialEnd = new Date(trialStart.getTime() + trialDays * 24 * 60 * 60 * 1000);

  const { error } = await supabase.from("organization_subscriptions").upsert(
    {
      organization_id: organizationId,
      plan_key: planKey,
      status: "trialing",
      trial_start: trialStart.toISOString(),
      trial_end: trialEnd.toISOString(),
    },
    { onConflict: "organization_id", ignoreDuplicates: true },
  );

  if (error) {
    throw new Error(`Impossible de créer l'abonnement par défaut: ${error.message}`);
  }
}

/**
 * Lit la limite configurée pour (plan, clé). Retourne -1 ("illimité")
 * si aucune ligne n'est configurée — traiter l'absence de configuration
 * comme un blocage casserait les tenants de démo créés avant ce lot
 * (critère d'acceptation Lot B, section "Enforcement").
 */
export async function getEntitlementLimit(planKey: PlanKey, entitlementKey: string): Promise<number> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("plan_entitlements")
    .select("limit_value")
    .eq("plan_key", planKey)
    .eq("entitlement_key", entitlementKey)
    .maybeSingle();

  if (error) {
    console.error(
      `getEntitlementLimit(${planKey}, ${entitlementKey}) erreur de lecture, "illimité" par défaut:`,
      error.message,
    );
    return -1;
  }
  if (!data) return -1;
  return data.limit_value;
}

/** Liste les entitlements d'un plan — utilisé par le dashboard pour la checklist de fonctionnalités. */
export async function listPlanEntitlements(planKey: PlanKey): Promise<PlanEntitlementRow[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("plan_entitlements")
    .select("entitlement_key, limit_value")
    .eq("plan_key", planKey);

  if (error) {
    console.error(`listPlanEntitlements(${planKey}) erreur de lecture:`, error.message);
    return [];
  }
  return (data ?? []).map((row) => ({ entitlementKey: row.entitlement_key, limitValue: row.limit_value }));
}

/** Liste les 3 plans (grille tarifaire) — utilisé par le dashboard pour la comparaison. */
export async function listPlans(): Promise<PlanSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("plans")
    .select("key, name, price_fcfa, description")
    .order("price_fcfa", { ascending: true });

  if (error) {
    console.error("listPlans() erreur de lecture:", error.message);
    return [];
  }
  return (data ?? [])
    .filter((row): row is typeof row & { key: PlanKey } => isPlanKey(row.key))
    .map((row) => ({ key: row.key, name: row.name, priceFcfa: row.price_fcfa, description: row.description }));
}

/**
 * Compte les lignes d'une table pour une organisation, sans jamais
 * planter si la table n'existe pas encore (ex: `whatsapp_groups` peut
 * appartenir à un autre lot pas encore fusionné). Utilisé pour les
 * clés d'entitlement "cumulatives" (voir entitlements-service.ts).
 */
/**
 * `statusIn` (Lot F) : filtre optionnel et rétrocompatible — sans lui,
 * comportement strictement identique à avant (compte toutes les lignes de
 * l'org). Permet à une table cumulative avec une colonne `status` (ex:
 * whatsapp_groups: 'connected' | 'disconnected' | 'error') de ne compter
 * que les lignes réellement actives contre le quota — sinon désactiver
 * une ressource ne libérerait jamais son quota, ce qui piégerait
 * durablement un tenant (voir entitlements-service.ts, CUMULATIVE_TABLE_BY_KEY).
 */
export async function countOrganizationRows(
  table: string,
  organizationId: string,
  statusIn?: string[],
): Promise<number> {
  const supabase = getSupabaseServiceClient();
  let query = supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  if (statusIn && statusIn.length > 0) {
    query = query.in("status", statusIn);
  }

  const { count, error } = await query;

  if (error) {
    console.warn(`countOrganizationRows("${table}") impossible (${error.message}), used=0 par défaut.`);
    return 0;
  }
  return count ?? 0;
}
