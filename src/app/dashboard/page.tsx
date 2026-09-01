import { requireCurrentOrganization } from "@/application/services/auth-service";
import {
  getDashboardSummary,
  getRevenueTimeSeries,
  getRevenueBreakdown,
} from "@/application/services/dashboard-service";
import { getAnalyticsSummary } from "@/application/services/analytics-service";
import { KpiCard } from "./_components/kpi-card";
import { LineAreaChart } from "./_components/line-area-chart";
import { DonutChart } from "./_components/donut-chart";

function formatAmount(amount: number, currency: string): string {
  return `${amount.toLocaleString("fr-FR")} ${currency}`;
}

function formatDayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" });
}

export default async function DashboardHomePage() {
  const { organizationId } = await requireCurrentOrganization();
  const [summary, activity, revenueSeries, revenueBreakdown] = await Promise.all([
    getDashboardSummary(organizationId),
    getAnalyticsSummary(organizationId, 30),
    getRevenueTimeSeries(organizationId, 7),
    getRevenueBreakdown(organizationId, 30),
  ]);

  const revenueTrend =
    summary.revenueLast30DaysPrevious > 0
      ? {
          direction: (summary.revenueLast30Days >= summary.revenueLast30DaysPrevious ? "up" : "down") as
            | "up"
            | "down",
          text: `${summary.revenueLast30Days >= summary.revenueLast30DaysPrevious ? "+" : ""}${Math.round(
            ((summary.revenueLast30Days - summary.revenueLast30DaysPrevious) / summary.revenueLast30DaysPrevious) *
              100,
          )}% vs période précédente`,
        }
      : undefined;

  const revenueTotal = revenueBreakdown.reduce((sum, s) => sum + s.amount, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Bonjour 👋</h1>
        <p className="text-sm text-muted">Voici ce qui se passe avec votre boutique aujourd&apos;hui.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Revenus (30j)" value={formatAmount(summary.revenueLast30Days, summary.currency)} trend={revenueTrend} />
        <KpiCard label="Commandes en attente" value={String(summary.ordersPending)} />
        <KpiCard label="Nouveaux leads (7j)" value={String(summary.newLeadsLast7Days)} />
        <KpiCard
          label="Produits en rupture"
          value={String(summary.productsOutOfStock)}
          alert={summary.productsOutOfStock > 0}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-ink/5 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-ink">Évolution des ventes</h2>
            <span className="text-xs text-muted">7 derniers jours</span>
          </div>
          <div className="mt-2">
            <LineAreaChart
              points={revenueSeries.map((p) => ({ label: formatDayLabel(p.date), value: p.amount }))}
              formatValue={(v) => formatAmount(v, summary.currency)}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-ink/5 bg-white p-5 shadow-sm">
          <h2 className="font-display text-base font-semibold text-ink">Répartition des ventes</h2>
          <p className="text-xs text-muted">30 derniers jours</p>
          <div className="mt-4">
            <DonutChart
              slices={revenueBreakdown.map((s) => ({ label: s.label, percent: s.percent }))}
              centerLabel={summary.currency}
              centerValue={revenueTotal.toLocaleString("fr-FR")}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Dépenses (30j)" value={formatAmount(summary.expensesLast30Days, summary.currency)} />
        <KpiCard label="Résultat (30j)" value={formatAmount(summary.resultLast30Days, summary.currency)} />
        <KpiCard label="Clients" value={String(summary.customersCount)} />
        <KpiCard
          label="Conversations à traiter"
          value={String(summary.conversationsNeedingAttention)}
          alert={summary.conversationsNeedingAttention > 0}
        />
      </div>

      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight text-ink">Activité (30 derniers jours)</h2>
        <p className="text-xs text-muted">Visites de votre page publique et intérêt de vos clients.</p>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KpiCard label="Vues de votre page" value={String(activity.counts.page_view)} />
          <KpiCard label="Vues de produits" value={String(activity.counts.product_view)} />
          <KpiCard label="Clics WhatsApp/contact" value={String(activity.counts.cta_click)} />
          <KpiCard label="Publications diffusées" value={String(activity.counts.publication_published)} />
        </div>
      </div>
    </div>
  );
}
