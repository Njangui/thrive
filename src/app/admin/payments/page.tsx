import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { listAllPaymentsForAdmin, refundPayment } from "@/application/services/subscription-payment-service";
import { AppError } from "@/lib/errors";
import { AdminBadge, AdminCard, AdminSectionHeader, AdminTableCard, AdminEmptyState } from "../_components/ui";

const STATUS_LABEL: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  pending: { label: "En attente", tone: "warning" },
  processing: { label: "Traitement en cours", tone: "warning" },
  effect_failed: { label: "Encaissé, effet à rejouer", tone: "danger" },
  completed: { label: "Payé", tone: "success" },
  failed: { label: "Échoué", tone: "danger" },
  refunded: { label: "Remboursé", tone: "neutral" },
  cancelled: { label: "Annulé", tone: "neutral" },
};
const TYPE_LABEL: Record<string, string> = { plan_subscription: "Abonnement", addon: "Add-on", dedicated_number: "Numéro dédié" };
async function refundAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const paymentId = String(formData.get("paymentId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || "Remboursement";
  try {
    const { commission } = await refundPayment(paymentId, admin.userId, reason);
    const note =
      commission === "reversed" ? " Commission d'affiliation annulée." : commission === "already_paid" ? " Attention : la commission d'affiliation était déjà versée (à récupérer à la main)." : "";
    redirect(`/admin/payments?success=${encodeURIComponent("Remboursement enregistré." + note)}`);
  } catch (error) {
    // redirect() lève une exception spéciale : on ne l'avale pas.
    if (error && typeof error === "object" && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw error;
    const message = error instanceof AppError ? error.message : "Erreur lors de l'enregistrement du remboursement.";
    redirect(`/admin/payments?error=${encodeURIComponent(message)}`);
  }
}

const formatFcfa = (value: number) => `${Math.round(value).toLocaleString("fr-FR")} FCFA`;

export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  await requirePlatformAdmin();
  const { success, error } = await searchParams;
  const payments = await listAllPaymentsForAdmin();
  const totalConfirmedFcfa = payments.filter((p) => p.status === "completed").reduce((sum, p) => sum + p.amountFcfa, 0);
  const pendingCount = payments.filter((p) => p.status === "pending").length;
  const failedCount = payments.filter((p) => p.status === "failed").length;

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader title="Paiements SaaS" description={`Les ${payments.length} paiements les plus récents, tous plans et add-ons confondus.`} action={<Link href="/admin/finance" className="adm-btn-primary">Voir la finance</Link>} />
      {success && <AdminCard className="border-success-200 bg-success-50 text-sm text-success-700">{success}</AdminCard>}
      {error && <AdminCard className="border-danger-200 bg-danger-50 text-sm text-danger-700">{error}</AdminCard>}
      <div className="grid gap-4 sm:grid-cols-3">
        <AdminCard><p className="adm-label">Confirmé · affiché</p><p className="adm-value mt-2">{formatFcfa(totalConfirmedFcfa)}</p></AdminCard>
        <AdminCard><p className="adm-label">En attente</p><p className="adm-value mt-2">{pendingCount}</p></AdminCard>
        <AdminCard><p className="adm-label">Échoués</p><p className="adm-value mt-2">{failedCount}</p></AdminCard>
      </div>
      <AdminTableCard title="Historique des paiements" action={<AdminBadge tone="neutral">Remboursement : enregistrement seulement (l&apos;argent se rend depuis Fapshi)</AdminBadge>}>
        {payments.length === 0 ? <AdminEmptyState>Aucun paiement enregistré pour l&apos;instant.</AdminEmptyState> : (
          <table className="adm-table"><thead><tr><th>Entreprise</th><th>Type</th><th>Détail</th><th>Montant</th><th>Statut</th><th>Date</th><th></th></tr></thead><tbody>
            {payments.map((p) => <tr key={p.id}><td className="font-semibold">{p.organizationName}</td><td className="adm-muted">{TYPE_LABEL[p.paymentType] ?? p.paymentType}</td><td className="adm-muted">{p.paymentType === "plan_subscription" ? (p.planKey ?? "—") : (p.addonKey ?? "—")}{p.addonQuantity ? ` × ${p.addonQuantity}` : ""}</td><td className="font-bold">{formatFcfa(p.amountFcfa)}</td><td><AdminBadge tone={STATUS_LABEL[p.status]?.tone ?? "neutral"}>{STATUS_LABEL[p.status]?.label ?? p.status}</AdminBadge></td><td className="adm-muted">{new Date(p.createdAt).toLocaleDateString("fr-FR")}</td><td>{p.status === "completed" ? <form action={refundAction} className="flex gap-1"><input type="hidden" name="paymentId" value={p.id} /><input name="reason" placeholder="Motif" className="adm-input !py-1 text-xs" /><button type="submit" className="adm-btn-secondary !py-1 text-xs">Rembourser</button></form> : null}</td></tr>)}
          </tbody></table>
        )}
      </AdminTableCard>
    </div>
  );
}
