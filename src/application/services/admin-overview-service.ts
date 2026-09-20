import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

export interface PlatformOverview {
  organizationsActive: number;
  /** Entreprises sur l'offre gratuite (plan `free`, abonnement actif) — remplace l'ancien compteur « en essai » (freemium). */
  organizationsFree: number;
  /** Entreprises sur une offre PAYANTE (plan ≠ `free`) dont l'abonnement est actif. */
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
   * 100%, donc priorité : suspendue > payante > gratuite > autre
   * (past_due/cancelled/ancien essai/sans ligne d'abonnement/statut inattendu).
   */
  organizationsStatusBreakdown: { paid: number; free: number; suspended: number; other: number };
}

/**
 * Compteurs d'abonnement de la vue globale — fonction PURE (testée), extraite de
 * `getPlatformOverview` pour que la règle de comptage ne dépende d'aucune requête.
 *
 * Modèle freemium : le plan d'entrée est `free` (permanent, `status='active'`), il n'y a plus
 * de période d'essai. Les compteurs se chevauchent volontairement (une organisation payante
 * est aussi « active »), le donut, lui, est mutuellement exclusif :
 *  - « actives »    = abonnement `status = 'active'` (gratuit ou payant) ;
 *  - « gratuites »  = abonnement actif sur le plan `free` ;
 *  - « abonnées »   = abonnement actif sur un plan PAYANT (`plan_key <> 'free'`). Avant le
 *    freemium ce compteur valait `plan_key <> 'starter'` (Starter = plan d'entrée pendant
 *    l'essai) : il aurait aujourd'hui compté les organisations gratuites comme abonnées et
 *    ignoré les clients Starter, qui paient. Un abonnement `past_due`/`cancelled` ne compte
 *    plus comme « abonné » : le compteur dit qui paie MAINTENANT ;
 *  - « suspendues » = organizations.status = 'suspended' — SEULE source pour cette notion,
 *    orthogonale à l'abonnement (voir admin-organizations-service.ts).
 * Une organisation sans ligne `organization_subscriptions` (créée avant Lot B) garde le repli
 * historique de plans-repository.ts (starter / `trialing`) : ni gratuite ni abonnée, elle
 * tombe dans « autres » du donut.
 */
export function summarizeSubscriptions(
  orgs: { id: string; status: string }[],
  subs: { organization_id: string; plan_key: string; status: string }[],
): {
  active: number;
  free: number;
  subscribed: number;
  suspended: number;
  breakdown: PlatformOverview["organizationsStatusBreakdown"];
} {
  const subsByOrg = new Map(subs.map((s) => [s.organization_id, s]));

  let active = 0;
  let free = 0;
  let subscribed = 0;
  let suspended = 0;
  const breakdown = { paid: 0, free: 0, suspended: 0, other: 0 };

  for (const o of orgs) {
    const sub = subsByOrg.get(o.id);
    const isActive = sub?.status === "active";
    const isFree = isActive && sub?.plan_key === "free";
    const isPaid = isActive && sub !== undefined && sub.plan_key !== "free";

    if (isActive) active += 1;
    if (isFree) free += 1;
    if (isPaid) subscribed += 1;
    if (o.status === "suspended") suspended += 1;

    if (o.status === "suspended") breakdown.suspended += 1;
    else if (isPaid) breakdown.paid += 1;
    else if (isFree) breakdown.free += 1;
    else breakdown.other += 1;
  }

  return { active, free, subscribed, suspended, breakdown };
}

/**
 * Section 79 : vue globale plateforme. Volontairement simple (le cahier
 * Lot C est explicite : "pas de dashboard analytics complexe") — quelques
 * compteurs en requêtes parallèles, même philosophie que
 * `dashboard-service.ts` (getDashboardSummary) mais côté plateforme.
 * Les règles de comptage d'abonnement sont dans `summarizeSubscriptions`.
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

  const summary = summarizeSubscriptions(orgs ?? [], subs ?? []);

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
    organizationsActive: summary.active,
    organizationsFree: summary.free,
    organizationsSubscribed: summary.subscribed,
    organizationsSuspended: summary.suspended,
    revenueLast30Days: (revenues ?? []).reduce((sum, r) => sum + Number(r.amount), 0),
    aiMessagesLast30Days: aiMessages ?? 0,
    revenueTrend7d,
    organizationsStatusBreakdown: summary.breakdown,
  };
}
