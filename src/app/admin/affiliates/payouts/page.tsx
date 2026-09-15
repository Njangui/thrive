import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { listPendingPayouts, markPayoutPaid, rejectPayout } from "@/application/services/affiliate-payout-service";
import { AppError } from "@/lib/errors";
import { AdminCard, AdminSectionHeader, AdminBadge, AdminTableCard, AdminEmptyState } from "../../_components/ui";
import { AffiliatesSubNav } from "../_components/sub-nav";

async function markPaidAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const payoutId = String(formData.get("payoutId") ?? "");
  const paymentReference = String(formData.get("paymentReference") ?? "");
  try {
    await markPayoutPaid(payoutId, admin.userId, paymentReference);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la validation du paiement.";
    redirect(`/admin/affiliates/payouts?error=${encodeURIComponent(message)}`);
  }
  redirect("/admin/affiliates/payouts?success=" + encodeURIComponent("Paiement marqué comme effectué."));
}

async function rejectAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const payoutId = String(formData.get("payoutId") ?? "");
  const reason = String(formData.get("reason") ?? "Non traité");
  try {
    await rejectPayout(payoutId, admin.userId, reason);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors du rejet.";
    redirect(`/admin/affiliates/payouts?error=${encodeURIComponent(message)}`);
  }
  redirect("/admin/affiliates/payouts?success=" + encodeURIComponent("Demande rejetée."));
}

export default async function AdminPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  await requirePlatformAdmin();
  const { success, error } = await searchParams;
  const payouts = await listPendingPayouts();

  return (
    <div className="flex flex-col gap-5">
      <AdminSectionHeader title="Affiliation" description="Demandes de paiement en attente de traitement manuel." />
      <AffiliatesSubNav active="payouts" />

      {success && <AdminCard className="border-success-200 bg-success-50 text-sm text-success-700">{success}</AdminCard>}
      {error && <AdminCard className="border-danger-200 bg-danger-50 text-sm text-danger-700">{error}</AdminCard>}

      <AdminTableCard title={`${payouts.length} demande(s) en attente`}>
        {payouts.length === 0 ? (
          <AdminEmptyState>Aucune demande de paiement en attente.</AdminEmptyState>
        ) : (
          <table className="adm-table">
            <thead>
              <tr>
                <th>Affilié</th>
                <th>Montant</th>
                <th>Demandé le</th>
                <th>Statut</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td>{p.affiliateDisplayName}</td>
                  <td>
                    {p.amountFcfa} {p.currencyCode}
                  </td>
                  <td>{new Date(p.requestedAt).toLocaleDateString("fr-FR")}</td>
                  <td>
                    <AdminBadge tone="warning">{p.status}</AdminBadge>
                  </td>
                  <td className="text-right">
                    <div className="flex justify-end gap-2">
                      <form action={markPaidAction} className="flex items-center gap-2">
                        <input type="hidden" name="payoutId" value={p.id} />
                        <input name="paymentReference" placeholder="Référence virement" required className="adm-input !w-40" />
                        <button type="submit" className="text-xs font-medium text-success-600 hover:underline">
                          Marquer payé
                        </button>
                      </form>
                      <form action={rejectAction}>
                        <input type="hidden" name="payoutId" value={p.id} />
                        <button type="submit" className="text-xs font-medium text-danger-600 hover:underline">
                          Rejeter
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </AdminTableCard>
    </div>
  );
}
