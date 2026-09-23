import Link from "next/link";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { getPlatformOverview } from "@/application/services/admin-overview-service";
import { getAdminFinancialOverview } from "@/application/services/admin-finance-service";
import { listAllPaymentsForAdmin } from "@/application/services/subscription-payment-service";
import { listOrganizationsForAdmin } from "@/application/services/admin-organizations-service";
import { AdminBadge, AdminCard, AdminSectionHeader, AdminStatCard, AdminTableCard, AdminEmptyState } from "./_components/ui";
import { AdminLineChart, AdminDonutChart, AppBarChart } from "./_components/charts";
import { IconAlert, IconBanknote, IconBot, IconTag, IconUsers } from "./_components/icons";

function formatFcfa(value: number): string {
  return `${Math.round(value).toLocaleString("fr-FR")} FCFA`;
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const PAYMENT_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  pending: { label: "En attente", tone: "warning" },
  completed: { label: "Payé", tone: "success" },
  failed: { label: "Échoué", tone: "danger" },
  refunded: { label: "Remboursé", tone: "neutral" },
  cancelled: { label: "Annulé", tone: "neutral" },
};

const ORG_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  active: { label: "Active", tone: "success" },
  suspended: { label: "Suspendue", tone: "danger" },
};

export default async function AdminOverviewPage() {
  await requirePlatformAdmin();
  const [overview, financial, payments, organizations] = await Promise.all([
    getPlatformOverview(),
    getAdminFinancialOverview(),
    listAllPaymentsForAdmin(5),
    listOrganizationsForAdmin(),
  ]);

  const recentOrganizations = organizations.slice(0, 5);
  const totalOrganizations = organizations.length;
  const { organizationsStatusBreakdown: breakdown } = overview;
  const donutSegments = [
    { label: "Payantes", value: breakdown.paid, color: "#00D1A0" },
    { label: "Gratuites", value: breakdown.free, color: "#38BDF8" },
    { label: "Suspendues", value: breakdown.suspended, color: "#F87171" },
    { label: "Autres", value: breakdown.other, color: "#CBD5E1" },
  ].filter((s) => s.value > 0);

  const zernioXaf = financial.zernio.netMonthlyUsd * financial.zernioUsdToXaf;
  const planItems = financial.subscribersByPlan.map((p) => ({ label: p.planName, value: p.count }));

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader
        title="Vue globale"
        description="Votre activité, vos abonnés, vos revenus et vos coûts de plateforme."
        action={<Link href="/admin/finance" className="adm-btn-primary">Ouvrir la finance</Link>}
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-8">
        <AdminStatCard label="Entreprises actives" value={String(overview.organizationsActive)} icon={<IconUsers className="h-4 w-4" />} />
        <AdminStatCard label="Abonnés payants" value={String(overview.organizationsSubscribed)} icon={<IconTag className="h-4 w-4" />} />
        <AdminStatCard label="Gratuites" value={String(overview.organizationsFree)} icon={<IconUsers className="h-4 w-4" />} />
        <AdminStatCard label="CA net · 30 j" value={formatFcfa(financial.netRevenue30dFcfa)} icon={<IconBanknote className="h-4 w-4" />} />
        <AdminStatCard label="Bénéfice brut" value={formatFcfa(financial.grossProfit30dFcfa)} helpText={`Marge ${financial.grossMargin30dPct == null ? "—" : financial.grossMargin30dPct.toFixed(1) + "%"}`} />
        <AdminStatCard label="Charges · 30 j" value={formatFcfa(financial.expenses30dFcfa)} icon={<IconAlert className="h-4 w-4" />} />
        <AdminStatCard label="Bénéfice net" value={formatFcfa(financial.netProfit30dFcfa)} helpText={`Marge ${financial.netMargin30dPct == null ? "—" : financial.netMargin30dPct.toFixed(1) + "%"}`} />
        <AdminStatCard label="Messages IA · 30 j" value={String(overview.aiMessagesLast30Days)} icon={<IconBot className="h-4 w-4" />} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.45fr_.8fr]">
        <AdminCard className="overflow-hidden">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="adm-eyebrow">Finance SaaS</p>
              <h2 className="adm-heading-2 mt-1">Revenus vs dépenses</h2>
              <p className="mt-1 text-xs adm-muted">30 derniers jours · paiements confirmés et dépenses internes enregistrées.</p>
            </div>
            <div className="rounded-xl bg-primary-50 px-3 py-2 text-right">
              <p className="text-[10px] font-bold uppercase tracking-wider text-primary-700">Résultat</p>
              <p className={`text-sm font-extrabold ${financial.net30dFcfa >= 0 ? "text-primary-700" : "text-danger-700"}`}>{formatFcfa(financial.net30dFcfa)}</p>
            </div>
          </div>
          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-500">Revenus</p>
              <AdminLineChart points={financial.revenueTrend30d} height={210} />
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-500">Dépenses enregistrées</p>
              <AdminLineChart points={financial.expenseTrend30d} height={210} />
            </div>
          </div>
        </AdminCard>

        <AdminCard>
          <p className="adm-eyebrow">Abonnements</p>
          <h2 className="adm-heading-2 mt-1">Abonnés par plan</h2>
          <div className="mt-4">
            {planItems.length ? <AppBarChart items={planItems} /> : <AdminEmptyState>Aucun abonnement actif.</AdminEmptyState>}
          </div>
          <div className="mt-3 space-y-2 border-t border-slate-100 pt-4">
            {financial.subscribersByPlan.map((plan) => (
              <div key={plan.planKey} className="flex items-center justify-between text-sm">
                <span className="text-slate-500">{plan.planName}</span>
                <span className="font-bold text-navy-900">{plan.count}</span>
              </div>
            ))}
          </div>
        </AdminCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <AdminCard className="border-primary/20 bg-[linear-gradient(135deg,#0F172A_0%,#132B35_100%)] text-white">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.18em] text-primary">Coût infrastructure social</p>
              <h2 className="mt-2 text-xl font-extrabold tracking-tight">Zernio</h2>
              <p className="mt-1 max-w-xl text-xs leading-5 text-white/55">Estimation mensuelle basée sur les comptes réellement connectés dans CRESYVA.</p>
            </div>
            <Link href="/admin/finance" className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/5">Détails</Link>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-white/5 p-4"><p className="text-[10px] uppercase tracking-wider text-white/40">Comptes</p><p className="mt-1 text-2xl font-extrabold">{financial.zernio.connectedAccounts}</p></div>
            <div className="rounded-2xl bg-white/5 p-4"><p className="text-[10px] uppercase tracking-wider text-white/40">/ mois</p><p className="mt-1 text-2xl font-extrabold text-primary">{formatUsd(financial.zernio.netMonthlyUsd)}</p></div>
            <div className="rounded-2xl bg-white/5 p-4"><p className="text-[10px] uppercase tracking-wider text-white/40">Pilotage FCFA</p><p className="mt-1 text-xl font-extrabold">{formatFcfa(zernioXaf)}</p></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-white/55">
            <span>2 gratuits : {financial.zernio.freeAccounts}</span>
            <span>$6 : {financial.zernio.tier6Accounts}</span>
            <span>$3 : {financial.zernio.tier3Accounts}</span>
            <span>$1 : {financial.zernio.tier1Accounts}</span>
          </div>
        </AdminCard>

        <AdminCard>
          <div className="flex items-center justify-between gap-3">
            <div><p className="adm-eyebrow">Répartition</p><h2 className="adm-heading-2 mt-1">Entreprises</h2></div>
            <span className="adm-badge-neutral">{totalOrganizations} au total</span>
          </div>
          <div className="mt-4">
            {donutSegments.length ? <AdminDonutChart segments={donutSegments} centerValue={String(totalOrganizations)} centerLabel="entreprises" /> : <AdminEmptyState>Aucune entreprise.</AdminEmptyState>}
          </div>
        </AdminCard>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AdminTableCard title="Paiements récents" action={<Link href="/admin/payments" className="text-xs font-bold text-primary-700">Tout voir</Link>}>
          {payments.length === 0 ? <AdminEmptyState>Aucun paiement enregistré.</AdminEmptyState> : (
            <table className="adm-table"><thead><tr><th>Entreprise</th><th>Statut</th><th>Montant</th></tr></thead><tbody>
              {payments.map((p) => <tr key={p.id}><td><p className="font-medium">{p.organizationName}</p><p className="text-xs adm-muted">{new Date(p.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}</p></td><td><AdminBadge tone={PAYMENT_STATUS[p.status]?.tone ?? "neutral"}>{PAYMENT_STATUS[p.status]?.label ?? p.status}</AdminBadge></td><td className="text-right font-semibold">{formatFcfa(p.amountFcfa)}</td></tr>)}
            </tbody></table>
          )}
        </AdminTableCard>

        <AdminTableCard title="Entreprises récentes" action={<Link href="/admin/organizations" className="text-xs font-bold text-primary-700">Tout voir</Link>}>
          {recentOrganizations.length === 0 ? <AdminEmptyState>Aucune entreprise inscrite.</AdminEmptyState> : (
            <table className="adm-table"><thead><tr><th>Entreprise</th><th>Statut</th><th>Inscrite le</th></tr></thead><tbody>
              {recentOrganizations.map((org) => <tr key={org.id}><td><p className="font-medium">{org.name}</p><p className="text-xs adm-muted">{org.slug}</p></td><td><AdminBadge tone={ORG_STATUS[org.status]?.tone ?? "neutral"}>{ORG_STATUS[org.status]?.label ?? org.status}</AdminBadge></td><td className="text-right adm-muted">{new Date(org.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}</td></tr>)}
            </tbody></table>
          )}
        </AdminTableCard>
      </section>
    </div>
  );
}
