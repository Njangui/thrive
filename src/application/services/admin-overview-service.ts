import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

export interface PlatformOverview {
  organizationsActive: number;
  organizationsTrialing: number;
  organizationsSubscribed: number;
  organizationsSuspended: number;
  revenueLast30Days: number;
  aiMessagesLast30Days: number;
  /**
   * Repasse design (vue globale) : revenus `revenues.amount` groupés par
   * jour sur les 7 derniers jours, pour le graphique d'évolution. Calculé
   * à partir du MÊME jeu de lignes que `revenueLast30Days` (une seule
   * requête, filtrée en JS) plutôt qu'un second aller-retour DB. Toujours
   * exactement 7 points, même à 0 FCFA — jamais de jour manquant qui
   * romprait l'axe du graphique.
   */
  revenueTrend7d: { date: string; label: string; amountFcfa: number }[];
  /**
   * Répartition des entreprises en buckets MUTUELLEMENT EXCLUSIFS (somme
   * = nombre total d'organisations), pour le donut de la vue globale.
   * Différent des 4 compteurs ci-dessus, qui sont volontairement des
   * entonnoirs qui se chevauchent (une organisation "abonnée" est aussi
   * "active", par ex.) — un donut a besoin de parts qui s'additionnent à
   * 100%, donc priorité : suspendue > active > en essai > autre
   * (past_due/cancelled/statut inattendu).
   */
  organizationsStatusBreakdown: { active: number; trialing: number; suspended: number; other: number };
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
      supabase.from("revenues").select("amount, created_at").gte("created_at", since30d),
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

  const breakdown = { active: 0, trialing: 0, suspended: 0, other: 0 };

  for (const o of orgs ?? []) {
    const sub = subsByOrg.get(o.id);
    const status = sub?.status ?? "trialing";
    const planKey = sub?.plan_key ?? "starter";
    if (status === "active") active += 1;
    if (status === "trialing") trialing += 1;
    if (planKey !== "starter") subscribed += 1;
    if (o.status === "suspended") suspended += 1;

    if (o.status === "suspended") breakdown.suspended += 1;
    else if (status === "active") breakdown.active += 1;
    else if (status === "trialing") breakdown.trialing += 1;
    else breakdown.other += 1;
  }

  const dayFormatter = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" });
  const revenueTrend7d = Array.from({ length: 7 }, (_, i) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (6 - i));
    const nextDay = new Date(day);
    nextDay.setDate(day.getDate() + 1);
    const amountFcfa = (revenues ?? [])
      .filter((r) => {
        const createdAt = new Date(r.created_at as string);
        return createdAt >= day && createdAt < nextDay;
      })
      .reduce((sum, r) => sum + Number(r.amount), 0);
    return { date: day.toISOString().slice(0, 10), label: dayFormatter.format(day), amountFcfa };
  });

  return {
    organizationsActive: active,
    organizationsTrialing: trialing,
    organizationsSubscribed: subscribed,
    organizationsSuspended: suspended,
    revenueLast30Days: (revenues ?? []).reduce((sum, r) => sum + Number(r.amount), 0),
    aiMessagesLast30Days: aiMessages ?? 0,
    revenueTrend7d,
    organizationsStatusBreakdown: breakdown,
  };
}
