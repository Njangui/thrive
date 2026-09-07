import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { listAllPaymentsForAdmin } from "@/application/services/subscription-payment-service";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  pending: { label: "En attente", className: "bg-warning-50 text-warning-700" },
  completed: { label: "Payé", className: "bg-success-50 text-success-700" },
  failed: { label: "Échoué", className: "bg-danger-50 text-danger-700" },
  refunded: { label: "Remboursé", className: "bg-navy-900/[0.06] text-slate-500" },
  cancelled: { label: "Annulé", className: "bg-navy-900/[0.06] text-slate-500" },
};

const TYPE_LABEL: Record<string, string> = {
  plan_subscription: "Abonnement",
  addon: "Add-on",
};

function formatFcfa(value: number): string {
  return `${value.toLocaleString("fr-FR")} FCFA`;
}

/**
 * Lot 4 (section 52 du master prompt) — page purement en lecture : les
 * changements de statut d'un paiement passent exclusivement par
 * handlePaymentWebhook() (subscription-payment-service.ts), jamais par
 * une action manuelle Super Admin (section 58 : "Ne jamais activer un
 * abonnement uniquement sur la base du frontend"). Pas de système BI —
 * juste de quoi repérer un paiement bloqué et rapprocher le chiffre
 * d'affaires confirmé (section 47 : "Ne pas créer un système BI
 * complexe pour le MVP").
 */
export default async function AdminPaymentsPage() {
  await requirePlatformAdmin();
  const payments = await listAllPaymentsForAdmin();

  const totalConfirmedFcfa = payments
    .filter((p) => p.status === "completed")
    .reduce((sum, p) => sum + p.amountFcfa, 0);
  const pendingCount = payments.filter((p) => p.status === "pending").length;
  const failedCount = payments.filter((p) => p.status === "failed").length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-jakarta text-2xl font-bold tracking-tight">Paiements</h1>
        <p className="mt-1 text-sm text-slate-500">
          Les {payments.length} paiements les plus récents, tous plans et add-ons confondus.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-navy-900/10 bg-white p-4">
          <p className="text-xs text-slate-500">Confirmé (total affiché)</p>
          <p className="mt-1 font-jakarta text-lg font-semibold">{formatFcfa(totalConfirmedFcfa)}</p>
        </div>
        <div className="rounded-xl border border-navy-900/10 bg-white p-4">
          <p className="text-xs text-slate-500">En attente</p>
          <p className="mt-1 font-jakarta text-lg font-semibold">{pendingCount}</p>
        </div>
        <div className="rounded-xl border border-navy-900/10 bg-white p-4">
          <p className="text-xs text-slate-500">Échoués</p>
          <p className="mt-1 font-jakarta text-lg font-semibold">{failedCount}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-navy-900/10 bg-white">
        {payments.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">Aucun paiement enregistré pour l&apos;instant.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-navy-900/10 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Entreprise</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Détail</th>
                <th className="px-4 py-2">Montant</th>
                <th className="px-4 py-2">Statut</th>
                <th className="px-4 py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-navy-900/[0.05] last:border-0">
                  <td className="px-4 py-2">{p.organizationName}</td>
                  <td className="px-4 py-2 text-slate-500">{TYPE_LABEL[p.paymentType] ?? p.paymentType}</td>
                  <td className="px-4 py-2 text-slate-500">
                    {p.paymentType === "plan_subscription" ? (p.planKey ?? "—") : (p.addonKey ?? "—")}
                    {p.addonQuantity ? ` × ${p.addonQuantity}` : ""}
                  </td>
                  <td className="px-4 py-2">{formatFcfa(p.amountFcfa)}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_LABEL[p.status]?.className ?? "bg-navy-900/[0.06] text-slate-500"}`}>
                      {STATUS_LABEL[p.status]?.label ?? p.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {new Date(p.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })}
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
