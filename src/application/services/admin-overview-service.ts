import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

export interface PlatformOverview {
  organizationsActive: number;
  organizationsTrialing: number;
  organizationsSubscribed: number;
  organizationsSuspended: number;
  revenueLast30Days: number;
  aiMessagesLast30Days: number;
}

/**
 * Section 79 : vue globale plateforme. Volontairement simple (le cahier
 * Lot C est explicite : "pas de dashboard analytics complexe") — quelques
 * compteurs en requêtes parallèles, même philosophie que
 * `dashboard-service.ts` (getDashboardSummary) mais côté plateforme.
 *
 * FUSION Lot B : "actives"/"en essai"/"abonnées" sont désormais dérivées
 * d'`organization_subscriptions` (source de vérité réelle du plan/statut
 * d'abonnement depuis 0012_plans_entitlements.sql), plus de
 * `organizations.plan`/`status` pour ces 3 métriques. Un tenant sans
 * ligne `organization_subscriptions` (créé avant Lot B) est traité comme
 * "starter"/"trialing" par défaut, cohérent avec plans-repository.ts —
 * dupliqué ici en JS (plutôt que N appels à getOrganizationSubscription)
 * car c'est un agrégat, pas une fiche par entreprise.
 *  - "actives"    = organization_subscriptions.status = 'active'
 *  - "en essai"   = organization_subscriptions.status = 'trialing' (ou
 *    absence de ligne, qui vaut "trialing" par défaut)
 *  - "abonnées"   = plan_key <> 'starter'
 *  - "suspendues" = organizations.status = 'suspended' — reste la SEULE
 *    source pour cette notion, orthogonale à l'abonnement, jamais touchée
 *    par Lot B (voir admin-organizations-service.ts).
 *  - "usage IA agrégé" = nombre de messages `sender = 'ai'` sur 30 jours
 *    (signal réel disponible, indépendant du système de crédits Lot B).
 */
export async function getPlatformOverview(): Promise<PlatformOverview> {
  const supabase = getSupabaseServiceClient();
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: orgs, error: orgsError }, { data: subs }, { data: revenues }, { count: aiMessages }] =
    await Promise.all([
      supabase.from("organizations").select("id, status"),
      supabase.from("organization_subscriptions").select("organization_id, plan_key, status"),
      supabase.from("revenues").select("amount").gte("created_at", since30d),
      supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("sender", "ai")
        .gte("created_at", since30d),
    ]);

  if (orgsError) throw new Error(`Erreur lecture organizations: ${orgsError.message}`);

  const subsByOrg = new Map((subs ?? []).map((s) => [s.organization_id, s]));

  let active = 0;
  let trialing = 0;
  let subscribed = 0;
  let suspended = 0;

  for (const o of orgs ?? []) {
    const sub = subsByOrg.get(o.id);
    const status = sub?.status ?? "trialing";
    const planKey = sub?.plan_key ?? "starter";
    if (status === "active") active += 1;
    if (status === "trialing") trialing += 1;
    if (planKey !== "starter") subscribed += 1;
    if (o.status === "suspended") suspended += 1;
  }

  return {
    organizationsActive: active,
    organizationsTrialing: trialing,
    organizationsSubscribed: subscribed,
    organizationsSuspended: suspended,
    revenueLast30Days: (revenues ?? []).reduce((sum, r) => sum + Number(r.amount), 0),
    aiMessagesLast30Days: aiMessages ?? 0,
  };
}
