import { redirect } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import { createRevenue, createExpense, listRecentFinanceEntries } from "@/application/services/finance-service";
import { getTenantFinancialOverview } from "@/application/services/tenant-finance-service";
import { AppLineChart, AppBarChart } from "@/app/_components/app-charts";
import { AppError } from "@/lib/errors";
import { FinanceForms } from "./finance-forms";

async function createRevenueAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin", "manager", "accountant"]);

  try {
    await createRevenue({
      organizationId,
      amount: Number(formData.get("amount") ?? 0),
      category: String(formData.get("category") ?? "") || undefined,
      source: String(formData.get("source") ?? "") || undefined,
      note: String(formData.get("note") ?? "") || undefined,
      date: String(formData.get("date") ?? "") || undefined,
      actorUserId: membership.userId,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'enregistrement du revenu";
    redirect(`/dashboard/finance?error=${encodeURIComponent(message)}`);
  }
  redirect("/dashboard/finance?success=" + encodeURIComponent("Revenu enregistré."));
}

async function createExpenseAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin", "manager", "accountant"]);

  try {
    await createExpense({
      organizationId,
      amount: Number(formData.get("amount") ?? 0),
      categoryName: String(formData.get("category") ?? "") || undefined,
      description: String(formData.get("description") ?? "") || undefined,
      expenseClass: String(formData.get("expenseClass") ?? "operating") as "cost_of_revenue" | "operating" | "tax",
      actorUserId: membership.userId,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'enregistrement de la dépense";
    redirect(`/dashboard/finance?error=${encodeURIComponent(message)}`);
  }
  redirect("/dashboard/finance?success=" + encodeURIComponent("Dépense enregistrée."));
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();

  const [entries, financial] = await Promise.all([
    listRecentFinanceEntries(organizationId, 20),
    getTenantFinancialOverview(organizationId),
  ]);

  const format = (value: number) => `${Math.round(value).toLocaleString("fr-FR")} ${financial.currency}`;
  const margin = (value: number | null) => value == null ? "—" : `${value.toFixed(1)}%`;
  const expenseBars = financial.expenseBreakdown30d.map((item) => ({ label: item.label, value: item.value }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="adm-eyebrow">Pilotage financier</p><h1 className="adm-heading-1 mt-1">Finance de votre entreprise</h1><p className="mt-1 text-sm adm-muted">30 derniers jours · revenus reconnus, coûts, marges, bénéfices et trésorerie.</p></div>
        <span className="adm-badge-neutral">Devise : {financial.currency}</span>
      </div>

      {error && <p className="adm-alert-danger">{error}</p>}
      {success && <p className="adm-alert-success">{success}</p>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="adm-card"><p className="adm-label">Chiffre d&apos;affaires</p><p className="adm-value mt-2">{format(financial.revenue30d)}</p><p className="mt-1 text-xs adm-muted">Revenus reconnus</p></div>
        <div className="adm-card"><p className="adm-label">Bénéfice brut</p><p className={`adm-value mt-2 ${financial.grossProfit30d >= 0 ? "text-success-600" : "text-danger-600"}`}>{format(financial.grossProfit30d)}</p><p className="mt-1 text-xs adm-muted">Marge brute : {margin(financial.grossMarginPct)}</p></div>
        <div className="adm-card"><p className="adm-label">Charges d&apos;exploitation</p><p className="adm-value mt-2">{format(financial.operatingExpenses30d)}</p><p className="mt-1 text-xs adm-muted">Hors coûts directs</p></div>
        <div className="adm-card"><p className="adm-label">Bénéfice net</p><p className={`adm-value mt-2 ${financial.netProfit30d >= 0 ? "text-success-600" : "text-danger-600"}`}>{format(financial.netProfit30d)}</p><p className="mt-1 text-xs adm-muted">Marge nette : {margin(financial.netMarginPct)}</p></div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="adm-card min-w-0 overflow-hidden">
          <div className="flex items-start justify-between gap-3"><div><p className="adm-eyebrow">Performance</p><h2 className="adm-heading-2 mt-1">CA, bénéfice brut et bénéfice net</h2></div><span className="adm-label">30 jours</span></div>
          <div className="mt-4"><AppLineChart points={financial.revenueTrend30d.map((p) => ({ label: p.label, value: p.value }))} /></div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs"><div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-500">CA</span><strong className="mt-1 block">{format(financial.revenue30d)}</strong></div><div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-500">Coût des ventes</span><strong className="mt-1 block">{format(financial.cogs30d)}</strong></div><div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-500">Encaissements</span><strong className="mt-1 block">{format(financial.cashCollected30d)}</strong></div></div>
        </div>
        <div className="adm-card"><p className="adm-eyebrow">Santé financière</p><h2 className="adm-heading-2 mt-1">Les chiffres à surveiller</h2><div className="mt-4 space-y-3"><div className="flex justify-between gap-4 border-b border-slate-100 pb-3"><span className="text-sm text-slate-500">Marge brute</span><strong>{margin(financial.grossMarginPct)}</strong></div><div className="flex justify-between gap-4 border-b border-slate-100 pb-3"><span className="text-sm text-slate-500">Marge nette</span><strong>{margin(financial.netMarginPct)}</strong></div><div className="flex justify-between gap-4 border-b border-slate-100 pb-3"><span className="text-sm text-slate-500">Créances ouvertes</span><strong>{format(financial.receivablesOpen)}</strong></div><div className="flex justify-between gap-4"><span className="text-sm text-slate-500">Créances en retard</span><strong className="text-danger-600">{format(financial.receivablesOverdue)}</strong></div></div></div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="adm-card min-w-0"><p className="adm-eyebrow">Tendance</p><h2 className="adm-heading-2 mt-1">Bénéfice net · 30 jours</h2><div className="mt-4"><AppLineChart points={financial.netProfitTrend30d} /></div></div>
        <div className="adm-card min-w-0"><p className="adm-eyebrow">Coûts</p><h2 className="adm-heading-2 mt-1">Répartition des dépenses</h2><div className="mt-4"><AppBarChart items={expenseBars} /></div></div>
      </section>

      <section className="adm-card overflow-x-auto"><p className="adm-eyebrow">Historique</p><h2 className="adm-heading-2 mt-1">12 derniers mois</h2><table className="adm-table mt-4"><thead><tr><th>Mois</th><th>CA</th><th>Coûts directs</th><th>Bénéfice brut</th><th>Charges</th><th>Bénéfice net</th></tr></thead><tbody>{financial.monthlyTrend.map((m) => <tr key={m.label}><td>{m.label}</td><td>{format(m.revenue)}</td><td>{format(m.cogs)}</td><td className="font-semibold">{format(m.grossProfit)}</td><td>{format(m.operatingExpenses)}</td><td className={m.netProfit >= 0 ? "font-bold text-success-600" : "font-bold text-danger-600"}>{format(m.netProfit)}</td></tr>)}</tbody></table></section>

      <FinanceForms organizationId={organizationId} createRevenueAction={createRevenueAction} createExpenseAction={createExpenseAction} />

      <div className="adm-card overflow-x-auto">
        <div className="flex items-center justify-between gap-3"><div><p className="adm-eyebrow">Détail</p><h2 className="adm-heading-2 mt-1">Dernières écritures</h2></div><span className="adm-badge-neutral">20 dernières</span></div>
        {entries.length === 0 ? <p className="py-8 text-sm adm-muted">Aucune écriture pour l&apos;instant.</p> : <table className="adm-table mt-3"><thead><tr><th>Date</th><th>Libellé</th><th>Montant</th></tr></thead><tbody>{entries.map((e) => <tr key={`${e.type}-${e.id}`}><td className="adm-muted">{e.date}</td><td>{e.label}</td><td className={`text-right font-semibold ${e.type === "revenue" ? "text-success-600" : "text-danger-600"}`}>{e.type === "revenue" ? "+" : "-"}{format(e.amount)}</td></tr>)}</tbody></table>}
      </div>
    </div>
  );
}
