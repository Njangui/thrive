import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

export interface DashboardSummary {
  revenueLast30Days: number;
  /** Revenus des 30 jours PRÉCÉDENTS (jours -60 à -31), pour la tendance affichée à côté du KPI. */
  revenueLast30DaysPrevious: number;
  expensesLast30Days: number;
  resultLast30Days: number;
  ordersPending: number;
  newLeadsLast7Days: number;
  customersCount: number;
  conversationsNeedingAttention: number;
  productsOutOfStock: number;
  postsScheduled: number;
  currency: string;
}

/**
 * Une seule fonction qui rassemble tout ce que la section 7 demande sur la
 * vue principale — plusieurs requêtes ciblées en parallèle plutôt qu'un
 * chargement de toute la base (section 40 : "le dashboard ne doit pas
 * charger toute la base").
 */
export async function getDashboardSummary(organizationId: string): Promise<DashboardSummary> {
  const supabase = getSupabaseServiceClient();
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since60d = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: org },
    { data: revenues },
    { data: previousRevenues },
    { data: expenses },
    { count: ordersPending },
    { count: newLeads },
    { count: customersCount },
    { count: conversationsNeedingAttention },
    { count: productsOutOfStock },
    { count: postsScheduled },
  ] = await Promise.all([
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
    supabase.from("revenues").select("amount").eq("organization_id", organizationId).gte("created_at", since30d),
    supabase
      .from("revenues")
      .select("amount")
      .eq("organization_id", organizationId)
      .gte("created_at", since60d)
      .lt("created_at", since30d),
    supabase.from("expenses").select("amount").eq("organization_id", organizationId).gte("created_at", since30d),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "pending"),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gte("created_at", since7d),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "customer"),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("handoff_status", "pending_human"),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "out_of_stock"),
    supabase
      .from("social_posts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "scheduled"),
  ]);

  const revenueLast30Days = (revenues ?? []).reduce((sum, r) => sum + Number(r.amount), 0);
  const revenueLast30DaysPrevious = (previousRevenues ?? []).reduce((sum, r) => sum + Number(r.amount), 0);
  const expensesLast30Days = (expenses ?? []).reduce((sum, e) => sum + Number(e.amount), 0);

  return {
    revenueLast30Days,
    revenueLast30DaysPrevious,
    expensesLast30Days,
    resultLast30Days: revenueLast30Days - expensesLast30Days,
    ordersPending: ordersPending ?? 0,
    newLeadsLast7Days: newLeads ?? 0,
    customersCount: customersCount ?? 0,
    conversationsNeedingAttention: conversationsNeedingAttention ?? 0,
    productsOutOfStock: productsOutOfStock ?? 0,
    postsScheduled: postsScheduled ?? 0,
    currency: org?.currency ?? "XAF",
  };
}

export interface RevenuePoint {
  /** Format "YYYY-MM-DD", jour en heure locale du serveur (UTC). */
  date: string;
  amount: number;
}

/**
 * Série journalière des revenus sur les `days` derniers jours, pour le
 * graphique "Évolution des ventes" du nouveau tableau de bord. Réutilise la
 * table `revenues` déjà lue par `getDashboardSummary` ci-dessus (même source
 * que le KPI "Revenus (30j)") plutôt qu'une agrégation SQL côté base —
 * volumes attendus (PME) trop faibles pour que ça pèse, et ça évite une
 * fonction SQL dédiée pour un seul écran.
 */
export async function getRevenueTimeSeries(organizationId: string, days = 7): Promise<RevenuePoint[]> {
  const supabase = getSupabaseServiceClient();
  const since = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
  const sinceDateStr = since.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("revenues")
    .select("amount, revenue_date")
    .eq("organization_id", organizationId)
    .gte("revenue_date", sinceDateStr);

  if (error) throw new Error(`Erreur lecture série de revenus: ${error.message}`);

  const byDate = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    byDate.set(d, 0);
  }
  for (const row of data ?? []) {
    const key = String(row.revenue_date);
    byDate.set(key, (byDate.get(key) ?? 0) + Number(row.amount));
  }

  return Array.from(byDate.entries()).map(([date, amount]) => ({ date, amount }));
}

export interface RevenueCategorySlice {
  label: string;
  amount: number;
  percent: number;
}

/**
 * Répartition des revenus par catégorie sur les `days` derniers jours, pour
 * le donut "Répartition des ventes". `revenues.category` est un champ texte
 * libre déjà saisi depuis le module Finance (voir finance-forms.tsx) — même
 * repli `category ?? source ?? "Revenu"` que `listRecentFinanceEntries`
 * dans finance-service.ts, pour rester cohérent avec ce qui s'affiche déjà
 * ailleurs dans le dashboard plutôt que d'inventer une seconde convention.
 */
export async function getRevenueBreakdown(organizationId: string, days = 30): Promise<RevenueCategorySlice[]> {
  const supabase = getSupabaseServiceClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("revenues")
    .select("amount, category, source")
    .eq("organization_id", organizationId)
    .gte("revenue_date", since);

  if (error) throw new Error(`Erreur lecture répartition des revenus: ${error.message}`);

  const byLabel = new Map<string, number>();
  for (const row of data ?? []) {
    const label = row.category ?? row.source ?? "Revenu";
    byLabel.set(label, (byLabel.get(label) ?? 0) + Number(row.amount));
  }

  const total = Array.from(byLabel.values()).reduce((sum, v) => sum + v, 0);
  const sorted = Array.from(byLabel.entries()).sort((a, b) => b[1] - a[1]);

  const TOP_N = 5;
  const top = sorted.slice(0, TOP_N);
  const rest = sorted.slice(TOP_N).reduce((sum, [, v]) => sum + v, 0);

  const slices: RevenueCategorySlice[] = top.map(([label, amount]) => ({
    label,
    amount,
    percent: total > 0 ? Math.round((amount / total) * 100) : 0,
  }));

  if (rest > 0) {
    slices.push({ label: "Autres", amount: rest, percent: total > 0 ? Math.round((rest / total) * 100) : 0 });
  }

  return slices;
}
