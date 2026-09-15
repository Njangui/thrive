import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { listOrdersForOrg, type OrderListItem } from "./order-service";

export interface TrendInfo {
  direction: "up" | "down";
  /** Déjà formaté, ex: "18.2%" — la carte ajoute elle-même le signe/flèche. */
  percentLabel: string;
}

/**
 * `null` quand la comparaison n'a pas de sens (période précédente à zéro —
 * une variation en % depuis zéro est soit indéfinie soit trompeuse) plutôt
 * que d'inventer un pourcentage. Repose sur ce principe déjà établi dans
 * `admin-overview-service.ts`/`getDashboardSummary` : jamais de donnée
 * fabriquée pour remplir un composant visuel.
 */
function computeTrend(current: number, previous: number): TrendInfo | null {
  if (previous <= 0) return null;
  const percent = ((current - previous) / previous) * 100;
  return {
    direction: percent >= 0 ? "up" : "down",
    percentLabel: `${Math.abs(percent).toFixed(1)}%`,
  };
}

export interface DashboardSummary {
  revenueLast30Days: number;
  revenueTrend: TrendInfo | null;
  expensesLast30Days: number;
  resultLast30Days: number;
  ordersCreatedLast30Days: number;
  ordersTrend: TrendInfo | null;
  ordersPending: number;
  newCustomersLast30Days: number;
  newCustomersTrend: TrendInfo | null;
  newLeadsLast7Days: number;
  customersCount: number;
  conversationsNeedingAttention: number;
  productsOutOfStock: number;
  postsScheduled: number;
  /** Moyenne de `orders.total_amount` sur 30j (toutes commandes créées,
   * même définition que `ordersCreatedLast30Days` — pas seulement les
   * commandes terminées, pour rester cohérent avec ce compteur). `0` si
   * aucune commande sur la période, pas de division par zéro. */
  averageOrderValue: number;
  averageOrderValueTrend: TrendInfo | null;
  /**
   * `ordersCreatedLast30Days / vues de page (30j) * 100` — une
   * approximation assumée : `page_view` compte des VUES, pas des
   * visiteurs uniques (une même personne qui revient plusieurs fois est
   * comptée plusieurs fois), donc ce taux tend à sous-estimer la vraie
   * conversion par visiteur. Reste la meilleure donnée réellement
   * disponible (pas de tracking de sessions/visiteurs uniques dans ce
   * schéma) — préférable à ne rien afficher, tant que l'approximation est
   * documentée plutôt que présentée comme un taux de conversion exact.
   * `null` si aucune vue de page sur la période (rien à diviser).
   */
  conversionRate: number | null;
  conversionRateTrend: TrendInfo | null;
  currency: string;
}

/**
 * Une seule fonction qui rassemble tout ce que la section 7 demande sur la
 * vue principale — plusieurs requêtes ciblées en parallèle plutôt qu'un
 * chargement de toute la base (section 40 : "le dashboard ne doit pas
 * charger toute la base").
 *
 * Étendu (chantier d'unification design, sept. 2026, réplique pixel par
 * pixel d'une référence fournie) : `revenueTrend`/`ordersTrend`/
 * `newCustomersTrend`/`averageOrderValueTrend`/`conversionRateTrend`
 * comparent la fenêtre 30j courante à la fenêtre 30j PRÉCÉDENTE (J-60 à
 * J-30) — deux requêtes de plus par métrique comparée, jamais un delta
 * interpolé. Volontairement PAS de trend sur `productsOutOfStock` :
 * aucune table ne conserve l'historique des changements de statut stock
 * (vérifié : pas de `stock_movements` avec horodatage dans le schéma),
 * donc aucune comparaison honnête n'est possible — reste une carte "à
 * surveiller" (voir `DashStatCard` `alert`), pas un delta inventé.
 */
export async function getDashboardSummary(organizationId: string): Promise<DashboardSummary> {
  const supabase = getSupabaseServiceClient();
  const now = new Date();
  const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since60d = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: org },
    { data: revenues },
    { data: previousRevenues },
    { data: expenses },
    { count: ordersPending },
    { data: ordersLast30Days },
    { data: ordersPrevious30Days },
    { count: newCustomersLast30Days },
    { count: newCustomersPrevious30Days },
    { count: newLeads },
    { count: customersCount },
    { count: conversationsNeedingAttention },
    { count: productsOutOfStock },
    { count: postsScheduled },
    { count: pageViewsLast30Days },
    { count: pageViewsPrevious30Days },
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
    supabase.from("orders").select("total_amount").eq("organization_id", organizationId).gte("created_at", since30d),
    supabase
      .from("orders")
      .select("total_amount")
      .eq("organization_id", organizationId)
      .gte("created_at", since60d)
      .lt("created_at", since30d),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "customer")
      .gte("created_at", since30d),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "customer")
      .gte("created_at", since60d)
      .lt("created_at", since30d),
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
    supabase
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("event_type", "page_view")
      .gte("created_at", since30d),
    supabase
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("event_type", "page_view")
      .gte("created_at", since60d)
      .lt("created_at", since30d),
  ]);

  const revenueLast30Days = (revenues ?? []).reduce((sum, r) => sum + Number(r.amount), 0);
  const revenuePrevious30Days = (previousRevenues ?? []).reduce((sum, r) => sum + Number(r.amount), 0);
  const expensesLast30Days = (expenses ?? []).reduce((sum, e) => sum + Number(e.amount), 0);

  const ordersCreatedLast30Days = (ordersLast30Days ?? []).length;
  const ordersCreatedPrevious30Days = (ordersPrevious30Days ?? []).length;
  const averageOrderValue =
    ordersCreatedLast30Days > 0
      ? (ordersLast30Days ?? []).reduce((sum, o) => sum + Number(o.total_amount), 0) / ordersCreatedLast30Days
      : 0;
  const averageOrderValuePrevious =
    ordersCreatedPrevious30Days > 0
      ? (ordersPrevious30Days ?? []).reduce((sum, o) => sum + Number(o.total_amount), 0) / ordersCreatedPrevious30Days
      : 0;

  const conversionRate = (pageViewsLast30Days ?? 0) > 0 ? (ordersCreatedLast30Days / (pageViewsLast30Days ?? 0)) * 100 : null;
  const conversionRatePrevious =
    (pageViewsPrevious30Days ?? 0) > 0 ? (ordersCreatedPrevious30Days / (pageViewsPrevious30Days ?? 0)) * 100 : null;

  return {
    revenueLast30Days,
    revenueTrend: computeTrend(revenueLast30Days, revenuePrevious30Days),
    expensesLast30Days,
    resultLast30Days: revenueLast30Days - expensesLast30Days,
    ordersCreatedLast30Days,
    ordersTrend: computeTrend(ordersCreatedLast30Days, ordersCreatedPrevious30Days),
    ordersPending: ordersPending ?? 0,
    newCustomersLast30Days: newCustomersLast30Days ?? 0,
    newCustomersTrend: computeTrend(newCustomersLast30Days ?? 0, newCustomersPrevious30Days ?? 0),
    newLeadsLast7Days: newLeads ?? 0,
    customersCount: customersCount ?? 0,
    conversationsNeedingAttention: conversationsNeedingAttention ?? 0,
    productsOutOfStock: productsOutOfStock ?? 0,
    postsScheduled: postsScheduled ?? 0,
    averageOrderValue,
    averageOrderValueTrend: computeTrend(averageOrderValue, averageOrderValuePrevious),
    conversionRate,
    conversionRateTrend:
      conversionRate !== null && conversionRatePrevious !== null ? computeTrend(conversionRate, conversionRatePrevious) : null,
    currency: org?.currency ?? "XAF",
  };
}

export interface DashboardActivityItem {
  key: string;
  label: string;
  detail: string;
  createdAt: string;
}

export interface CriticalStockItem {
  id: string;
  name: string;
  currentStock: number;
  minStock: number;
}

export interface ProductPerformanceItem {
  key: string;
  label: string;
  quantity: number;
  revenue: number;
}

export interface DashboardCharts {
  /** Toujours `days` points, même à 0 FCFA — jamais un jour manquant qui
   * romprait l'axe du graphique (même logique que `revenueTrend7d` dans
   * `admin-overview-service.ts`). Basé sur `revenue_date`, pas
   * `created_at` : une vente saisie en retard doit apparaître au bon
   * jour du graphique. */
  revenueTrend: { date: string; label: string; amountFcfa: number }[];
  /** Classement par produit/service vendu (`order_items`) — alimente
   * "Meilleures ventes", à ne pas confondre avec `salesByCategory`
   * ci-dessous (le donut). */
  topProducts: ProductPerformanceItem[];
  /**
   * Répartition du revenu par VRAIE catégorie (`categories`, via
   * `order_items -> products -> category_id`) — désormais possible
   * depuis l'introduction des catégories sélectionnées par secteur
   * d'activité (voir `catalog-service.ts::seedDefaultCategories`) ; avant
   * ce chantier, `products` n'avait pas de catégorisation fiable et le
   * donut utilisait `topProducts` en repli (voir l'historique de ce
   * fichier). "Sans catégorie" regroupe les lignes non catégorisées,
   * jamais forcées dans une catégorie choisie arbitrairement. Top 5 +
   * "Autres" au-delà, pour rester lisible.
   */
  salesByCategory: { label: string; revenue: number }[];
  recentOrders: OrderListItem[];
  /** Triée par sévérité (le plus au-dessous de son seuil min_stock en
   * premier), pas par date — c'est ce qui rend la liste utile. */
  criticalStock: CriticalStockItem[];
  recentActivity: DashboardActivityItem[];
}

/**
 * Données du graphique + des listes de l'accueil dashboard (chantier
 * d'unification design, sept. 2026). Séparé de `getDashboardSummary` :
 * ce sont des requêtes plus lourdes (agrégation `order_items`, tri), pas
 * de raison de les payer partout où seul le résumé chiffré est utilisé
 * (ex: `finance/page.tsx`).
 */
export async function getDashboardCharts(organizationId: string, days = 14): Promise<DashboardCharts> {
  const supabase = getSupabaseServiceClient();
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: revenueRows }, { data: orderItemRows }, { orders: recentOrders }, { data: recentLeadEvents }, { data: recentRevenueEvents }] =
    await Promise.all([
      supabase
        .from("revenues")
        .select("amount, revenue_date")
        .eq("organization_id", organizationId)
        .gte("revenue_date", since.toISOString().slice(0, 10)),
      supabase
        .from("order_items")
        .select(
          "label, unit_price, quantity, product_id, products(categories(name)), orders!inner(status, organization_id, created_at)",
        )
        .eq("organization_id", organizationId)
        .neq("orders.status", "cancelled")
        .gte("orders.created_at", since30d),
      listOrdersForOrg(organizationId, { page: 1, pageSize: 5 }),
      supabase
        .from("leads")
        .select("id, full_name, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("revenues")
        .select("id, amount, currency, created_at, source")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  // `current_stock <= min_stock` ne se filtre pas en SQL PostgREST (deux
  // colonnes de la même ligne) — lu en entier (déjà scope PAR organisation,
  // pas un plein scan) puis filtré/trié en JS.
  const { data: allActiveProducts } = await supabase
    .from("products")
    .select("id, name, current_stock, min_stock")
    .eq("organization_id", organizationId)
    .eq("is_active", true);

  const criticalStock: CriticalStockItem[] = (allActiveProducts ?? [])
    .map((p) => ({ id: p.id as string, name: p.name as string, currentStock: Number(p.current_stock), minStock: Number(p.min_stock) }))
    .filter((p) => p.minStock > 0 && p.currentStock <= p.minStock)
    .sort((a, b) => a.currentStock - a.minStock - (b.currentStock - b.minStock))
    .slice(0, 5);

  const dayFormatter = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" });
  const revenueTrend = Array.from({ length: days }, (_, i) => {
    const day = new Date(since);
    day.setDate(since.getDate() + i);
    const dateStr = day.toISOString().slice(0, 10);
    const amountFcfa = (revenueRows ?? [])
      .filter((r) => r.revenue_date === dateStr)
      .reduce((sum, r) => sum + Number(r.amount), 0);
    return { date: dateStr, label: dayFormatter.format(day), amountFcfa };
  });

  const productTotals = new Map<string, { label: string; quantity: number; revenue: number }>();
  const categoryTotals = new Map<string, number>();
  for (const row of (orderItemRows ?? []) as unknown as {
    label: string;
    unit_price: number;
    quantity: number;
    product_id: string | null;
    products?: { categories?: { name?: string | null } | null } | null;
  }[]) {
    const key = row.product_id ?? row.label;
    const existing = productTotals.get(key) ?? { label: row.label, quantity: 0, revenue: 0 };
    const lineRevenue = Number(row.unit_price) * Number(row.quantity);
    existing.quantity += Number(row.quantity);
    existing.revenue += lineRevenue;
    productTotals.set(key, existing);

    // "Sans catégorie" regroupe les lignes libres (product_id null, ex.
    // frais/service ponctuel tapé à la main) ET les produits catalogués
    // qui n'ont pas encore de catégorie choisie — jamais forcé dans une
    // catégorie qu'ils n'ont pas.
    const categoryLabel = row.products?.categories?.name ?? "Sans catégorie";
    categoryTotals.set(categoryLabel, (categoryTotals.get(categoryLabel) ?? 0) + lineRevenue);
  }
  const topProducts: ProductPerformanceItem[] = Array.from(productTotals.entries())
    .map(([key, v]) => ({ key, label: v.label, quantity: v.quantity, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // Top 5 catégories + "Autres" regroupant le reste, plutôt qu'un donut
  // à 15 parts illisible dès qu'un commerçant a un catalogue varié.
  const sortedCategories = Array.from(categoryTotals.entries()).sort((a, b) => b[1] - a[1]);
  const salesByCategory: { label: string; revenue: number }[] = sortedCategories.slice(0, 5).map(([label, revenue]) => ({
    label,
    revenue,
  }));
  const otherRevenue = sortedCategories.slice(5).reduce((sum, [, revenue]) => sum + revenue, 0);
  if (otherRevenue > 0) salesByCategory.push({ label: "Autres", revenue: otherRevenue });

  const activity: DashboardActivityItem[] = [
    ...recentOrders.map((o) => ({
      key: `order-${o.id}`,
      label: `Nouvelle commande #${o.id.slice(0, 8)}`,
      detail: `${o.contactName ?? "Client"} — ${o.totalAmount.toLocaleString("fr-FR")} ${o.currency}`,
      createdAt: o.createdAt,
    })),
    ...((recentLeadEvents ?? []) as { id: string; full_name: string | null; created_at: string }[]).map((l) => ({
      key: `lead-${l.id}`,
      label: "Nouveau client inscrit",
      detail: l.full_name ?? "Contact sans nom",
      createdAt: l.created_at,
    })),
    ...((recentRevenueEvents ?? []) as { id: string; amount: number; currency: string; created_at: string; source: string | null }[]).map((r) => ({
      key: `revenue-${r.id}`,
      label: "Paiement reçu",
      detail: `${Number(r.amount).toLocaleString("fr-FR")} ${r.currency}${r.source ? ` — ${r.source}` : ""}`,
      createdAt: r.created_at,
    })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);

  return {
    revenueTrend,
    topProducts,
    salesByCategory,
    recentOrders,
    criticalStock,
    recentActivity: activity,
  };
}
