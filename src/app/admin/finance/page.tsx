import { redirect } from "next/navigation";
import Link from "next/link";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { createPlatformCost, createPlatformExpense, getAdminFinancialOverview, updatePlatformCost, updateZernioUsdToXafRate, type ExpenseClass, type PlatformCostCategory } from "@/application/services/admin-finance-service";
import { AppBarChart, AppLineChart } from "@/app/_components/app-charts";
import { AppError } from "@/lib/errors";
import { AdminBadge, AdminCard, AdminSectionHeader, AdminTableCard } from "../_components/ui";

const CATEGORY_LABELS: Record<string, string> = {
  zernio: "Zernio", hosting: "Hébergement", database: "Base de données", storage: "Stockage", email: "E-mail", ai: "IA",
  payment: "Paiement", domain: "Domaines", phone: "Numéros", marketing: "Marketing", affiliate: "Affiliation", salary: "Salaires",
  legal: "Juridique", accounting: "Comptabilité", monitoring: "Monitoring", other: "Autre",
};
const CLASS_LABELS: Record<string, string> = { cost_of_revenue: "Coût de revient", operating: "Exploitation", tax: "Impôt / taxe" };
const formatFcfa = (value: number) => `${Math.round(value).toLocaleString("fr-FR")} FCFA`;
const formatUsd = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const margin = (value: number | null) => value == null ? "—" : `${value.toFixed(1)}%`;

async function addExpenseAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  try {
    await createPlatformExpense({
      category: String(formData.get("category") ?? "other"), label: String(formData.get("label") ?? ""), amountFcfa: Number(formData.get("amountFcfa") ?? 0),
      expenseDate: String(formData.get("expenseDate") ?? ""), vendor: String(formData.get("vendor") ?? "") || undefined,
      notes: String(formData.get("notes") ?? "") || undefined, expenseClass: String(formData.get("expenseClass") ?? "operating") as ExpenseClass,
    }, admin.userId);
  } catch (error) { redirect(`/admin/finance?error=${encodeURIComponent(error instanceof AppError ? error.message : "Impossible d'enregistrer la dépense.")}`); }
  redirect("/admin/finance?success=expense");
}

async function addPlatformCostAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  try {
    await createPlatformCost({
      provider: String(formData.get("provider") ?? ""), label: String(formData.get("label") ?? ""), category: String(formData.get("category") ?? "other") as PlatformCostCategory,
      costClass: String(formData.get("costClass") ?? "cost_of_revenue") as ExpenseClass, billingType: String(formData.get("billingType") ?? "fixed") as "fixed" | "usage" | "one_time",
      billingCycle: String(formData.get("billingCycle") ?? "monthly") as "monthly" | "annual" | "one_time", monthlyBudgetFcfa: Number(formData.get("monthlyBudgetFcfa") ?? 0) || null,
      monthlyBudgetUsd: Number(formData.get("monthlyBudgetUsd") ?? 0) || null, startsOn: String(formData.get("startsOn") ?? new Date().toISOString().slice(0, 10)), notes: String(formData.get("notes") ?? "") || undefined,
    }, admin.userId);
  } catch (error) { redirect(`/admin/finance?error=${encodeURIComponent(error instanceof AppError ? error.message : "Impossible d'enregistrer le coût.")}`); }
  redirect("/admin/finance?success=cost");
}

async function updatePlatformCostAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  try {
    await updatePlatformCost({
      id: String(formData.get("id") ?? ""),
      monthlyBudgetFcfa: Number(formData.get("monthlyBudgetFcfa") ?? 0) || null,
      monthlyBudgetUsd: Number(formData.get("monthlyBudgetUsd") ?? 0) || null,
      active: String(formData.get("active") ?? "true") === "true",
      notes: String(formData.get("notes") ?? "") || null,
    }, admin.userId);
  } catch (error) {
    redirect(`/admin/finance?error=${encodeURIComponent(error instanceof AppError ? error.message : "Impossible de mettre à jour le coût.")}`);
  }
  redirect("/admin/finance?success=cost-update");
}

async function updateRateAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  try { await updateZernioUsdToXafRate(Number(formData.get("rate") ?? 0), admin.userId); }
  catch (error) { redirect(`/admin/finance?error=${encodeURIComponent(error instanceof AppError ? error.message : "Impossible de modifier le taux.")}`); }
  redirect("/admin/finance?success=rate");
}

export default async function AdminFinancePage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  await requirePlatformAdmin();
  const { error, success } = await searchParams;
  const financial = await getAdminFinancialOverview();
  const zernioXaf = financial.zernio.netMonthlyUsd * financial.zernioUsdToXaf;

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader title="Finance plateforme" description="Pilotez le chiffre d'affaires tokoo , les coûts de revient, les charges, la marge et le bénéfice net." action={<Link href="/admin/payments" className="adm-btn-secondary">Paiements</Link>} />
      {error && <div className="adm-alert-danger">{error}</div>}
      {success && <div className="adm-alert-success">{success === "cost" ? "Coût récurrent enregistré." : success === "cost-update" ? "Budget du coût mis à jour." : success === "rate" ? "Taux USD/FCFA enregistré." : "Opération enregistrée."}</div>}

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-6">
        <AdminCard><p className="adm-label">CA brut · 30 j</p><p className="adm-value mt-2">{formatFcfa(financial.grossRevenue30dFcfa)}</p></AdminCard>
        <AdminCard><p className="adm-label">Remboursements</p><p className="adm-value mt-2">{formatFcfa(financial.refunds30dFcfa)}</p></AdminCard>
        <AdminCard><p className="adm-label">Bénéfice brut</p><p className="adm-value mt-2 text-success-600">{formatFcfa(financial.grossProfit30dFcfa)}</p><p className="mt-1 text-xs adm-muted">Marge {margin(financial.grossMargin30dPct)}</p></AdminCard>
        <AdminCard><p className="adm-label">Charges</p><p className="adm-value mt-2">{formatFcfa(financial.operatingExpenses30dFcfa)}</p></AdminCard>
        <AdminCard><p className="adm-label">Impôts / taxes</p><p className="adm-value mt-2">{formatFcfa(financial.taxes30dFcfa)}</p></AdminCard>
        <AdminCard className={financial.netProfit30dFcfa >= 0 ? "border-primary/20" : "border-danger-600/20"}><p className="adm-label">Bénéfice net</p><p className={`adm-value mt-2 ${financial.netProfit30dFcfa >= 0 ? "text-success-600" : "text-danger-600"}`}>{formatFcfa(financial.netProfit30dFcfa)}</p><p className="mt-1 text-xs adm-muted">Marge {margin(financial.netMargin30dPct)}</p></AdminCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <AdminCard className="min-w-0 overflow-hidden"><div className="flex items-start justify-between gap-3"><div><p className="adm-eyebrow">Rentabilité</p><h2 className="adm-heading-2 mt-1">Évolution du chiffre d&apos;affaires</h2></div><span className="adm-badge-neutral">30 jours</span></div><div className="mt-4"><AppLineChart points={financial.revenueTrend30d} /></div><div className="mt-3 grid grid-cols-3 gap-2"><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">CA net</p><strong className="mt-1 block text-sm">{formatFcfa(financial.netRevenue30dFcfa)}</strong></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Coût de revient</p><strong className="mt-1 block text-sm">{formatFcfa(financial.costOfRevenue30dFcfa)}</strong></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Résultat</p><strong className={`mt-1 block text-sm ${financial.netProfit30dFcfa >= 0 ? "text-success-600" : "text-danger-600"}`}>{formatFcfa(financial.netProfit30dFcfa)}</strong></div></div></AdminCard>
        <AdminCard><p className="adm-eyebrow">Abonnements</p><h2 className="adm-heading-2 mt-1">Abonnés et revenus par plan</h2><div className="mt-4"><AppBarChart items={financial.subscribersByPlan.map((p) => ({ label: p.planName, value: p.count }))} /></div><div className="mt-3 space-y-2 border-t border-slate-100 pt-3">{financial.subscribersByPlan.map((p) => <div key={p.planKey} className="flex justify-between gap-3 text-sm"><span className="text-slate-500">{p.planName} · {p.count}</span><strong>{formatFcfa(p.revenue30d)}</strong></div>)}</div></AdminCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.35fr_.65fr]">
        <AdminCard className="min-w-0"><p className="adm-eyebrow">12 mois</p><h2 className="adm-heading-2 mt-1">Courbe de rentabilité</h2><div className="mt-4"><AppLineChart points={financial.twelveMonthTrend.map((m) => ({ label: m.label, value: m.netProfit }))} /></div></AdminCard>
        <AdminCard><p className="adm-eyebrow">Structure des coûts</p><h2 className="adm-heading-2 mt-1">Dépenses · 30 j</h2><div className="mt-4"><AppBarChart items={financial.expenseBreakdown30d.map((e) => ({ label: CATEGORY_LABELS[e.category] ?? e.label, value: e.value }))} /></div></AdminCard>
      </section>

      <AdminCard className="overflow-hidden border-primary/20 bg-navy-900 text-white">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-primary">Coût de revient · infrastructure sociale</p><h2 className="mt-2 text-2xl font-extrabold">Zernio · {formatUsd(financial.zernio.netMonthlyUsd)} / mois</h2><p className="mt-1 text-sm text-white/55">{financial.zernio.connectedAccounts} comptes connectés · estimation actuelle.</p></div><div className="rounded-2xl bg-white/5 px-4 py-3 text-right"><p className="text-[10px] uppercase tracking-wider text-white/40">Équivalent FCFA</p><strong className="mt-1 block text-lg text-primary">{formatFcfa(zernioXaf)}</strong></div></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-5">{[["2 gratuits", financial.zernio.freeAccounts], ["$6 / compte", financial.zernio.tier6Accounts], ["$3 / compte", financial.zernio.tier3Accounts], ["$1 / compte", financial.zernio.tier1Accounts], ["> 2 000 · custom", financial.zernio.customAccounts]].map(([label, value]) => <div key={String(label)} className="rounded-2xl bg-white/5 p-4"><p className="text-[10px] uppercase tracking-wider text-white/40">{label}</p><p className="mt-1 text-2xl font-extrabold">{value}</p></div>)}</div>
        <p className="mt-4 text-[11px] leading-5 text-white/40">Les frais d&apos;usage variables de Zernio, numéros, X/Twitter, publicités ou autres services externes doivent être enregistrés séparément lorsqu&apos;ils apparaissent sur la facture.</p>
      </AdminCard>

      <section className="grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
        <AdminCard><p className="adm-eyebrow">Budget récurrent</p><h2 className="adm-heading-2 mt-1">Coûts mensuels connus</h2><p className="mt-2 text-xs leading-5 adm-muted">Ajoute ici Vercel, Supabase, stockage, e-mail, IA, domaines, numéros, monitoring, comptabilité, etc. Les budgets ne sont pas comptés comme dépenses réelles tant qu&apos;une facture/dépense n&apos;est pas enregistrée.</p><div className="mt-5 rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Budget mensuel configuré</p><p className="mt-1 text-xl font-extrabold text-navy-900">{formatFcfa(financial.recurringBudgetFcfa)}</p></div><form action={addPlatformCostAction} className="mt-5 grid gap-2"><div className="grid grid-cols-2 gap-2"><input name="provider" required placeholder="Fournisseur" className="adm-input" /><input name="label" required placeholder="Ex. Vercel Pro" className="adm-input" /></div><div className="grid grid-cols-2 gap-2"><select name="category" className="adm-input">{Object.entries(CATEGORY_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select><select name="costClass" className="adm-input"><option value="cost_of_revenue">Coût de revient</option><option value="operating">Exploitation</option><option value="tax">Impôt / taxe</option></select></div><div className="grid grid-cols-2 gap-2"><input name="monthlyBudgetFcfa" type="number" min="0" placeholder="Budget mensuel FCFA" className="adm-input" /><input name="monthlyBudgetUsd" type="number" min="0" step="0.01" placeholder="Budget mensuel USD" className="adm-input" /></div><div className="grid grid-cols-2 gap-2"><select name="billingType" className="adm-input"><option value="fixed">Fixe</option><option value="usage">À l&apos;usage</option><option value="one_time">Ponctuel</option></select><input name="startsOn" type="date" defaultValue={new Date().toISOString().slice(0,10)} className="adm-input" /></div><button className="adm-btn-primary" type="submit">Ajouter au référentiel des coûts</button></form></AdminCard>
        <AdminCard><p className="adm-eyebrow">Référentiel</p><h2 className="adm-heading-2 mt-1">Services et fournisseurs</h2><div className="mt-4 overflow-x-auto"><table className="adm-table"><thead><tr><th>Fournisseur</th><th>Service</th><th>Classe</th><th>Budget</th></tr></thead><tbody>{financial.recurringCosts.length ? financial.recurringCosts.map((c) => <tr key={c.id}><td className="font-semibold">{c.provider}</td><td>{c.label}<p className="text-xs adm-muted">{CATEGORY_LABELS[c.category] ?? c.category}</p></td><td><AdminBadge tone={c.costClass === "cost_of_revenue" ? "violet" : c.costClass === "tax" ? "warning" : "neutral"}>{CLASS_LABELS[c.costClass]}</AdminBadge></td><td className="min-w-[230px] text-right">
  <form action={updatePlatformCostAction} className="ml-auto flex max-w-[260px] flex-col gap-1.5">
    <input type="hidden" name="id" value={c.id} />
    <div className="flex gap-1.5">
      <input name="monthlyBudgetFcfa" type="number" min="0" step="1" defaultValue={c.monthlyBudgetFcfa ?? ""} placeholder="FCFA / mois" className="adm-input min-w-0 flex-1 px-2 py-1.5 text-xs" />
      <input name="monthlyBudgetUsd" type="number" min="0" step="0.01" defaultValue={c.monthlyBudgetUsd ?? ""} placeholder="USD / mois" className="adm-input min-w-0 flex-1 px-2 py-1.5 text-xs" />
    </div>
    <div className="flex items-center justify-end gap-2">
      <label className="flex items-center gap-1.5 text-[11px] adm-muted"><input type="checkbox" name="active" value="true" defaultChecked={c.active} /> actif</label>
      <button type="submit" className="adm-btn-secondary px-2.5 py-1 text-xs">Enregistrer</button>
    </div>
  </form>
</td></tr>) : <tr><td colSpan={4} className="py-10 text-center adm-muted">Aucun coût récurrent configuré.</td></tr>}</tbody></table></div></AdminCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-[.72fr_1.28fr]">
        <AdminCard><p className="adm-eyebrow">Nouvelle dépense réelle</p><h2 className="adm-heading-2 mt-1">Enregistrer une facture</h2><form action={addExpenseAction} className="mt-5 flex flex-col gap-3"><select name="category" className="adm-input">{Object.entries(CATEGORY_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select><select name="expenseClass" defaultValue="operating" className="adm-input"><option value="cost_of_revenue">Coût de revient</option><option value="operating">Charge d&apos;exploitation</option><option value="tax">Impôt / taxe</option></select><input name="label" required placeholder="Libellé" className="adm-input" /><div className="grid grid-cols-2 gap-2"><input name="amountFcfa" required min="1" type="number" placeholder="Montant FCFA" className="adm-input" /><input name="expenseDate" required type="date" defaultValue={new Date().toISOString().slice(0,10)} className="adm-input" /></div><input name="vendor" placeholder="Fournisseur" className="adm-input" /><textarea name="notes" rows={3} placeholder="Note interne" className="adm-input" /><button className="adm-btn-primary" type="submit">Ajouter la dépense</button></form><div className="mt-5 border-t border-slate-100 pt-4"><p className="adm-eyebrow">Taux de pilotage</p><form action={updateRateAction} className="mt-2 flex gap-2"><input name="rate" type="number" min="0.01" step="0.01" defaultValue={financial.zernioUsdToXaf} className="adm-input flex-1" /><button className="adm-btn-secondary" type="submit">Enregistrer</button></form></div></AdminCard>
        <AdminTableCard title="Dépenses réelles récentes" action={<AdminBadge tone="neutral">30 derniers jours</AdminBadge>}>{financial.recentExpenses.length ? <table className="adm-table"><thead><tr><th>Date</th><th>Dépense</th><th>Classe</th><th>Montant</th></tr></thead><tbody>{financial.recentExpenses.map((e) => <tr key={e.id}><td className="adm-muted">{new Date(`${e.expenseDate}T00:00:00`).toLocaleDateString("fr-FR")}</td><td><p className="font-semibold">{e.label}</p><p className="text-xs adm-muted">{e.vendor ?? CATEGORY_LABELS[e.category] ?? e.category}</p></td><td><AdminBadge tone={e.expenseClass === "cost_of_revenue" ? "violet" : e.expenseClass === "tax" ? "warning" : "neutral"}>{CLASS_LABELS[e.expenseClass]}</AdminBadge></td><td className="text-right font-bold">{formatFcfa(e.amountFcfa)}</td></tr>)}</tbody></table> : <p className="px-5 py-10 text-center text-sm adm-muted">Aucune dépense enregistrée.</p>}</AdminTableCard>
      </section>

      <AdminCard><p className="adm-eyebrow">Définition</p><h2 className="adm-heading-2 mt-1">Comment lire tes chiffres</h2><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4"><div className="rounded-2xl bg-slate-50 p-4"><strong>CA net</strong><p className="mt-1 text-xs leading-5 adm-muted">Paiements SaaS confirmés, après les remboursements suivis dans le système.</p></div><div className="rounded-2xl bg-slate-50 p-4"><strong>Bénéfice brut</strong><p className="mt-1 text-xs leading-5 adm-muted">CA net − coûts directement nécessaires à la livraison du service.</p></div><div className="rounded-2xl bg-slate-50 p-4"><strong>Bénéfice d&apos;exploitation</strong><p className="mt-1 text-xs leading-5 adm-muted">Bénéfice brut − charges d&apos;exploitation.</p></div><div className="rounded-2xl bg-slate-50 p-4"><strong>Bénéfice net</strong><p className="mt-1 text-xs leading-5 adm-muted">Résultat final après coûts directs, exploitation et impôts/taxes enregistrés.</p></div></div></AdminCard>
    </div>
  );
}
