import Link from "next/link";
import { requireCurrentOrganization } from "@/application/services/auth-service";
import { getDashboardSummary, getDashboardCharts } from "@/application/services/dashboard-service";
import { getAnalyticsSummary } from "@/application/services/analytics-service";
import { DashCard, DashStatCard, DashTableCard, DashEmptyState } from "./_components/ui";
import { ORDER_STATUS_LABELS, ORDER_STATUS_STYLES } from "./_components/order-status";
import { AppLineChart, AppDonutChart } from "@/app/_components/app-charts";
import { getIndustryUi } from "@/application/config/industry-ui";
import { getEnabledModules } from "@/application/services/module-service";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

function formatAmount(amount: number, currency: string): string {
  return `${amount.toLocaleString("fr-FR")} ${currency}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
}

/**
 * Accueil dashboard marchand — réplique pixel par pixel d'une référence
 * visuelle fournie (sept. 2026), même philosophie que `admin/page.tsx`
 * ("Section 79 — repasse design") : chaque chiffre/graphique vient
 * directement de `getDashboardSummary()`/`getDashboardCharts()`/
 * `getAnalyticsSummary()`, rien n'est interpolé ou inventé pour remplir
 * la mise en page. Pas de sélecteur de période (la référence en a un) :
 * aucune plage n'est réellement câblée derrière, donc pas de faux
 * contrôle — même choix que la Vue globale Super Admin.
 *
 * Écarts assumés et documentés vs la référence :
 *  - Pas de salutation nominative ("Bonjour Marie Claire !") : aucun
 *    écran de ce projet n'écrit `profiles.full_name` à ce jour (voir
 *    `landing-config-service.ts`), donc aucun prénom réel à afficher.
 *  - "Taux de conversion" est une approximation assumée (vues de page,
 *    pas visiteurs uniques) — voir la note de `DashboardSummary.conversionRate`.
 *  - "Produits en rupture" n'est plus une carte du haut (voir la
 *    référence la plus récente, qui l'a remplacée par Conversion/Panier
 *    moyen) : reste visible dans "Stock critique" plus bas, sans flèche
 *    de tendance fabriquée — aucun historique de statut stock en base.
 */
export default async function DashboardHomePage() {
  const { organizationId } = await requireCurrentOrganization();
  const [summary, charts, activity, organization, enabledModules] = await Promise.all([
    getDashboardSummary(organizationId),
    getDashboardCharts(organizationId, 14),
    getAnalyticsSummary(organizationId, 30),
    getSupabaseServiceClient().from("organizations").select("name, industry").eq("id", organizationId).maybeSingle(),
    getEnabledModules(organizationId),
  ]);

  const industry = getIndustryUi(organization.data?.industry);
  const hasInventory = enabledModules.includes("inventory");

  const donutPalette = ["#00D1A0", "#34D4B5", "#A7F3E0", "#F0EDFB", "#94A3B8"];
  const donutSegments = charts.salesByCategory.map((c, i) => ({
    label: c.label,
    value: c.revenue,
    color: donutPalette[i] ?? "#94A3B8",
  }));
  const totalCategoryRevenue = charts.salesByCategory.reduce((sum, c) => sum + c.revenue, 0);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3"><span className="hidden h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 sm:flex">✦</span><div><p className="adm-eyebrow">{industry.eyebrow}</p><h1 className="adm-heading-1 mt-1">Bonjour 👋</h1></div></div>
          <p className="mt-1 text-sm adm-muted">Voici ce qui se passe avec {organization.data?.name ?? "votre entreprise"}.</p>
        </div>
        <span className="adm-badge-neutral shrink-0">Fenêtre : 30 derniers jours</span>
      </div>

      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <DashStatCard
          label="Ventes totales (30j)"
          value={formatAmount(summary.revenueLast30Days, summary.currency)}
          trend={summary.revenueTrend}
        />
        <DashStatCard
          label="Commandes (30j)"
          value={String(summary.ordersCreatedLast30Days)}
          trend={summary.ordersTrend}
          helpText={`${summary.ordersPending} en attente`}
        />
        <DashStatCard
          label="Nouveaux clients (30j)"
          value={String(summary.newCustomersLast30Days)}
          trend={summary.newCustomersTrend}
        />
        <DashStatCard
          label="Taux de conversion"
          value={summary.conversionRate !== null ? `${summary.conversionRate.toFixed(2)}%` : "—"}
          trend={summary.conversionRateTrend}
          helpText={summary.conversionRate === null ? "Pas encore de vues" : undefined}
        />
        <DashStatCard
          label="Panier moyen"
          value={formatAmount(Math.round(summary.averageOrderValue), summary.currency)}
          trend={summary.averageOrderValueTrend}
        />
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="overflow-hidden rounded-[24px] bg-navy-900 p-5 text-white shadow-[0_20px_45px_-28px_rgba(14,17,48,.65)] sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-[.16em] text-violet-300">Votre espace</span>
              <h2 className="mt-2 font-jakarta text-xl font-extrabold tracking-tight sm:text-2xl">{industry.label}</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-white/55">{industry.catalogDescription} Les outils visibles dans votre menu sont automatiquement adaptés à cette activité.</p>
            </div>
            <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-xl sm:flex">✦</span>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href={enabledModules.includes("catalog") ? "/dashboard/products" : "/dashboard"} className="rounded-xl bg-violet-600 px-3.5 py-2.5 text-xs font-semibold text-white transition hover:bg-violet-500">{industry.primaryAction}</Link>
            {enabledModules.includes("appointments") && <Link href="/dashboard/appointments" className="rounded-xl bg-white/10 px-3.5 py-2.5 text-xs font-semibold text-white transition hover:bg-white/15">Nouveau rendez-vous</Link>}
            {enabledModules.includes("orders") && <Link href="/dashboard/orders" className="rounded-xl bg-white/10 px-3.5 py-2.5 text-xs font-semibold text-white transition hover:bg-white/15">Voir les commandes</Link>}
          </div>
        </div>
        <div className="rounded-[24px] border border-violet-200 bg-violet-50 p-5 sm:p-6">
          <span className="text-[10px] font-bold uppercase tracking-[.16em] text-violet-600">Assistant</span>
          <h2 className="mt-2 font-jakarta text-lg font-extrabold">Besoin d’un coup de main ?</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Retrouvez vos conversations, votre FAQ et les outils d’assistance depuis un seul endroit.</p>
          <Link href="/dashboard/ai" className="mt-4 inline-flex rounded-xl bg-white px-3.5 py-2.5 text-xs font-semibold text-violet-700 shadow-sm ring-1 ring-violet-200 transition hover:bg-violet-100">Ouvrir l’assistant →</Link>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
        <DashCard className="min-w-0 overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="adm-heading-2">Évolution des ventes</h2>
            <span className="adm-label">14 derniers jours</span>
          </div>
          <div className="mt-4">
            <AppLineChart points={charts.revenueTrend.map((p) => ({ label: p.label, value: p.amountFcfa }))} />
          </div>
        </DashCard>

        <DashCard className="min-w-0">
          <h2 className="adm-heading-2">Répartition des ventes</h2>
          <p className="text-xs adm-muted">Par catégorie (30j)</p>
          <div className="mt-4">
            {donutSegments.length > 0 ? (
              <AppDonutChart
                segments={donutSegments}
                centerValue={formatAmount(totalCategoryRevenue, summary.currency)}
                centerLabel="ventes"
              />
            ) : (
              <DashEmptyState>Aucune vente sur la période.</DashEmptyState>
            )}
          </div>
        </DashCard>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <DashTableCard
          title="Commandes récentes"
          action={
            <Link href="/dashboard/orders" className="text-xs font-medium text-violet-600 hover:underline">
              Voir toutes
            </Link>
          }
        >
          {charts.recentOrders.length === 0 ? (
            <DashEmptyState>Aucune commande pour l&apos;instant.</DashEmptyState>
          ) : (
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Statut</th>
                  <th>Montant</th>
                </tr>
              </thead>
              <tbody>
                {charts.recentOrders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <p className="font-medium">{o.contactName ?? "Client"}</p>
                      <p className="text-xs adm-muted">{formatDate(o.createdAt)}</p>
                    </td>
                    <td>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${ORDER_STATUS_STYLES[o.status]}`}>
                        {ORDER_STATUS_LABELS[o.status]}
                      </span>
                    </td>
                    <td className="text-right font-semibold">{formatAmount(o.totalAmount, o.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DashTableCard>

        <DashTableCard
          title="Stock critique"
          action={
            <Link href="/dashboard/products" className="text-xs font-medium text-violet-600 hover:underline">
              Voir tout
            </Link>
          }
        >
          {charts.criticalStock.length === 0 ? (
            <DashEmptyState>Aucun signal critique pour le moment.</DashEmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-navy-900/5 px-5 pb-4">
              {charts.criticalStock.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-navy-900">{p.name}</p>
                    <p className="text-xs adm-muted">
                      Stock : {p.currentStock} (seuil : {p.minStock})
                    </p>
                  </div>
                  <span className="adm-badge-danger shrink-0">
                    {p.currentStock <= 0 ? "Rupture" : "Rupture imminente"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DashTableCard>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <DashTableCard title="Activité récente">
          {charts.recentActivity.length === 0 ? (
            <DashEmptyState>Rien à signaler pour l&apos;instant.</DashEmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-navy-900/5 px-5 pb-4">
              {charts.recentActivity.map((item) => (
                <li key={item.key} className="flex items-start justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-navy-900">{item.label}</p>
                    <p className="text-xs adm-muted">{item.detail}</p>
                  </div>
                  <span className="shrink-0 text-xs adm-muted">{timeAgo(item.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </DashTableCard>

        <DashTableCard
          title="Meilleures ventes"
          action={
            <Link href="/dashboard/products" className="text-xs font-medium text-violet-600 hover:underline">
              Voir toutes
            </Link>
          }
        >
          {charts.topProducts.length === 0 ? (
            <DashEmptyState>Aucune vente sur la période.</DashEmptyState>
          ) : (
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Ventes</th>
                  <th>Revenus</th>
                </tr>
              </thead>
              <tbody>
                {charts.topProducts.map((p) => (
                  <tr key={p.key}>
                    <td className="font-medium">{p.label}</td>
                    <td>{p.quantity}</td>
                    <td className="text-right font-semibold">{formatAmount(p.revenue, summary.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DashTableCard>
      </div>

      <div>
        <h2 className="adm-heading-2">Trafic & engagement (30 derniers jours)</h2>
        <p className="text-xs adm-muted">Visites de votre page publique et intérêt de vos clients.</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <DashCard padding="p-4">
            <p className="adm-label">Vues de votre page</p>
            <p className="adm-value mt-1">{activity.counts.page_view}</p>
          </DashCard>
          <DashCard padding="p-4">
            <p className="adm-label">Vues de produits</p>
            <p className="adm-value mt-1">{activity.counts.product_view}</p>
          </DashCard>
          <DashCard padding="p-4">
            <p className="adm-label">Clics WhatsApp/contact</p>
            <p className="adm-value mt-1">{activity.counts.cta_click}</p>
          </DashCard>
          <DashCard padding="p-4">
            <p className="adm-label">Publications diffusées</p>
            <p className="adm-value mt-1">{activity.counts.publication_published}</p>
          </DashCard>
        </div>
      </div>
    </div>
  );
}
