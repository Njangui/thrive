import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { resolveCurrencyForCountry } from "./country-service";

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
 * mal configuré doit rester exploitable sans planter. Depuis le passage
 * freemium, un plan absent retombe sur Discover et une clé commerciale
 * connue mais absente de la DB est bloquée à 0 (fail-closed) ; une clé
 * inconnue conserve le comportement historique illimité.
 */

export const PLAN_KEYS = ["free", "starter", "pro"] as const;

/** Entitlements commerciaux connus : une clé connue mais non seedée doit
 * bloquer par défaut, jamais devenir accidentellement illimitée. */
export const KNOWN_ENTITLEMENT_KEYS = new Set([
  "catalog_products", "whatsapp", "whatsapp_groups", "whatsapp_groups_dedicated_bonus",
  "telegram_bots", "telegram_groups", "youtube_accounts", "facebook_pages",
  "linkedin_pages", "instagram_accounts", "tiktok_accounts", "facebook_auto_comments",
  "twitter_accounts",
  "instagram_auto_comments", "unified_comments", "ai_credits", "broadcast_contacts",
  "team_members", "site_customization", "scheduled_publications", "immediate_publications",
  "analytics", "push_notifications", "finance", "prospect_notes", "crm",
  "semi_automatic_messaging", "automatic_messaging", "social_accounts",
  "facebook_messenger", "instagram_messages", "linkedin", "tiktok",
  // Freemium v2 (migration 0067) : verrous et quotas ajoutés au lot O.
  "telegram_channels", "tiktok_auto_comments", "orders", "appointments",
  "site_analytics", "follow_ups", "custom_domain", "remove_branding",
  "video_retention_days",
]);
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
 * valeur exploitable : "free" si aucune ligne `organization_subscriptions`
 * n'existe (tenant créé avant ce lot) ou en cas d'erreur de lecture — le mode freemium ne doit jamais accorder Starter par défaut.
 */
export async function getOrganizationPlanKey(organizationId: string): Promise<PlanKey> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("organization_subscriptions")
    .select("plan_key")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    console.error(`getOrganizationPlanKey(${organizationId}) erreur de lecture, plan "free" par défaut:`, error.message);
    return "free";
  }
  if (!data || !isPlanKey(data.plan_key)) {
    return "free";
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
      planKey: "free",
      status: "active",
      trialStart: null,
      trialEnd: null,
      currentPeriodEnd: null,
    };
  }

  return {
    organizationId,
    planKey: isPlanKey(data.plan_key) ? data.plan_key : "free",
    status: (data.status as OrganizationSubscriptionStatus | null) ?? "active",
    trialStart: data.trial_start,
    trialEnd: data.trial_end,
    currentPeriodEnd: data.current_period_end,
  };
}

/**
 * Crée la ligne d'abonnement par défaut à l'onboarding — passage en mode
 * freemium (sur demande explicite, la période d'essai est retirée) :
 * plan "free" permanent, `status='active'` dès la création, aucune
 * échéance (`trial_end`/`current_period_end` NULL). L'organisation reste
 * sur ce plan indéfiniment tant qu'elle ne choisit pas explicitement de
 * passer à un forfait payant (voir payPlanAction, subscription-payment-
 * service.ts::initiatePayment) — plus de compte à rebours forçant une
 * décision. Idempotent comme l'ancienne créateTrialSubscription : si une
 * ligne existe déjà pour cette organisation, on ne l'écrase pas.
 */
export async function createFreemiumSubscription(organizationId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { error } = await supabase.from("organization_subscriptions").upsert(
    {
      organization_id: organizationId,
      plan_key: "free",
      status: "active",
      trial_start: null,
      trial_end: null,
      current_period_end: null,
    },
    { onConflict: "organization_id", ignoreDuplicates: true },
  );

  if (error) {
    throw new Error(`Impossible de créer l'abonnement par défaut: ${error.message}`);
  }
}

/**
 * Repasse une organisation au plan "free" immédiatement, sans paiement
 * (downgrade self-service depuis /dashboard/subscription) — distinct de
 * `initiatePayment` (subscription-payment-service.ts), qui refuse
 * explicitement `planKey==='free'` : il n'y a rien à facturer ici.
 */
export async function switchToFreePlan(organizationId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { error } = await supabase
    .from("organization_subscriptions")
    .update({
      plan_key: "free",
      status: "active",
      trial_start: null,
      trial_end: null,
      current_period_end: null,
      last_renewal_reminder_sent_at: null,
    })
    .eq("organization_id", organizationId);

  if (error) {
    throw new Error(`Impossible de repasser au plan gratuit: ${error.message}`);
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
      `getEntitlementLimit(${planKey}, ${entitlementKey}) erreur de lecture, "0 pour clé connue / illimité pour clé inconnue":`,
      error.message,
    );
    return KNOWN_ENTITLEMENT_KEYS.has(entitlementKey) ? 0 : -1;
  }
  if (!data) return KNOWN_ENTITLEMENT_KEYS.has(entitlementKey) ? 0 : -1;
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
  columnFilter?: { column: string; values: string[] },
): Promise<number> {
  const supabase = getSupabaseServiceClient();
  let query = supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  if (statusIn && statusIn.length > 0) {
    query = query.in("status", statusIn);
  }
  // Lot O : filtre additionnel (ex: chat_type = 'channel' pour les canaux
  // Telegram, platform = 'facebook' pour les pages Facebook) — permet de
  // compter plusieurs quotas distincts dans une même table.
  if (columnFilter && columnFilter.values.length > 0) {
    query = query.in(columnFilter.column, columnFilter.values);
  }

  const { count, error } = await query;

  if (error) {
    console.warn(`countOrganizationRows("${table}") impossible (${error.message}), used=0 par défaut.`);
    return 0;
  }
  return count ?? 0;
}

/**
 * Country Engine (section 17) — résout le prix effectif d'un plan pour
 * un pays donné. Repli en 2 temps si aucune ligne `plan_prices` active
 * n'existe pour (plan, pays) :
 *   1. devise du pays (country-service.ts) si le pays est connu ;
 *   2. sinon XAF (comportement historique, seul marché avant le
 *      Country Engine) — voir country-service.ts::DEFAULT_CURRENCY_CODE.
 * et le MONTANT retombe toujours sur `plan.priceFcfa` dans ce cas.
 * C'est ce double repli qui garantit qu'un pays non encore configuré
 * par le Super Admin (ou le Cameroun lui-même, avant tout seed) se
 * comporte EXACTEMENT comme avant l'introduction du Country Engine —
 * jamais une conversion forex automatique (interdite par le cahier,
 * section 17), jamais un montant à 0 par erreur de configuration.
 */
export interface ResolvedPlanPrice {
  amount: number;
  currencyCode: string;
  source: "country_specific" | "fallback_default";
}

export async function resolvePlanPriceForCountry(plan: PlanSummary, countryCode: string): Promise<ResolvedPlanPrice> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("plan_prices")
    .select("amount, currency_code")
    .eq("plan_key", plan.key)
    .eq("country_code", countryCode)
    .eq("billing_interval", "monthly")
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error(
      `resolvePlanPriceForCountry(${plan.key}, ${countryCode}) erreur de lecture plan_prices, repli sur le prix par défaut:`,
      error.message,
    );
  }

  if (data) {
    return { amount: data.amount, currencyCode: data.currency_code, source: "country_specific" };
  }

  const currencyCode = await resolveCurrencyForCountry(countryCode);
  return { amount: plan.priceFcfa, currencyCode, source: "fallback_default" };
}

/** Grille tarifaire complète d'un pays (Super Admin /admin/countries/[code], section 19/29) — tous les plans, avec leur prix résolu pour ce pays. */
export async function listPlanPricesForCountry(countryCode: string): Promise<Array<PlanSummary & ResolvedPlanPrice>> {
  const plans = await listPlans();
  const resolved = await Promise.all(
    plans.map(async (plan) => ({ ...plan, ...(await resolvePlanPriceForCountry(plan, countryCode)) })),
  );
  return resolved;
}
