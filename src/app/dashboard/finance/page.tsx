import { redirect } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import { createRevenue, createExpense, listRecentFinanceEntries } from "@/application/services/finance-service";
import { getDashboardSummary } from "@/application/services/dashboard-service";
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
      note: String(formData.get("note") ?? "") || undefined,
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

  const [summary, entries] = await Promise.all([
    getDashboardSummary(organizationId),
    listRecentFinanceEntries(organizationId, 20),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">Finance</h1>

      {error && (
        <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>
      )}
      {success && (
        <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">{success}</p>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-brand border border-ink/10 bg-white p-4">
          <p className="text-xs text-muted">CA (30j)</p>
          <p className="mt-1 font-display text-lg font-semibold text-leaf">
            {summary.revenueLast30Days.toLocaleString("fr-FR")} {summary.currency}
          </p>
        </div>
        <div className="rounded-brand border border-ink/10 bg-white p-4">
          <p className="text-xs text-muted">Dépenses (30j)</p>
          <p className="mt-1 font-display text-lg font-semibold text-clay">
            {summary.expensesLast30Days.toLocaleString("fr-FR")} {summary.currency}
          </p>
        </div>
        <div className="rounded-brand border border-ink/10 bg-white p-4">
          <p className="text-xs text-muted">Résultat (30j)</p>
          <p className="mt-1 font-display text-lg font-semibold">
            {summary.resultLast30Days.toLocaleString("fr-FR")} {summary.currency}
          </p>
        </div>
      </div>

      <FinanceForms
        organizationId={organizationId}
        createRevenueAction={createRevenueAction}
        createExpenseAction={createExpenseAction}
      />

      <div className="overflow-hidden rounded-brand border border-ink/10 bg-white">
        {entries.length === 0 ? (
          <p className="p-6 text-sm text-muted">Aucune écriture pour l&apos;instant.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Libellé</th>
                <th className="px-4 py-2">Montant</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={`${e.type}-${e.id}`} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-2 text-muted">{e.date}</td>
                  <td className="px-4 py-2">{e.label}</td>
                  <td className={`px-4 py-2 font-medium ${e.type === "revenue" ? "text-leaf" : "text-clay"}`}>
                    {e.type === "revenue" ? "+" : "-"}
                    {e.amount.toLocaleString("fr-FR")} {summary.currency}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
