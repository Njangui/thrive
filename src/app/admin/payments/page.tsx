import Link from "next/link";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { listAllPaymentsForAdmin } from "@/application/services/subscription-payment-service";
import { AdminBadge, AdminCard, AdminSectionHeader, AdminTableCard, AdminEmptyState } from "../_components/ui";

const STATUS_LABEL: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  pending: { label: "En attente", tone: "warning" },
  completed: { label: "Payé", tone: "success" },
  failed: { label: "Échoué", tone: "danger" },
  refunded: { label: "Remboursé", tone: "neutral" },
  cancelled: { label: "Annulé", tone: "neutral" },
};
const TYPE_LABEL: Record<string, string> = { plan_subscription: "Abonnement", addon: "Add-on", dedicated_number: "Numéro dédié" };
const formatFcfa = (value: number) => `${Math.round(value).toLocaleString("fr-FR")} FCFA`;

export default async function AdminPaymentsPage() {
  await requirePlatformAdmin();
  const payments = await listAllPaymentsForAdmin();
  const totalConfirmedFcfa = payments.filter((p) => p.status === "completed").reduce((sum, p) => sum + p.amountFcfa, 0);
  const pendingCount = payments.filter((p) => p.status === "pending").length;
  const failedCount = payments.filter((p) => p.status === "failed").length;

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader title="Paiements SaaS" description={`Les ${payments.length} paiements les plus récents, tous plans et add-ons confondus.`} action={<Link href="/admin/finance" className="adm-btn-primary">Voir la finance</Link>} />
      <div className="grid gap-4 sm:grid-cols-3">
        <AdminCard><p className="adm-label">Confirmé · affiché</p><p className="adm-value mt-2">{formatFcfa(totalConfirmedFcfa)}</p></AdminCard>
        <AdminCard><p className="adm-label">En attente</p><p className="adm-value mt-2">{pendingCount}</p></AdminCard>
        <AdminCard><p className="adm-label">Échoués</p><p className="adm-value mt-2">{failedCount}</p></AdminCard>
      </div>
      <AdminTableCard title="Historique des paiements" action={<AdminBadge tone="neutral">Lecture seule</AdminBadge>}>
        {payments.length === 0 ? <AdminEmptyState>Aucun paiement enregistré pour l&apos;instant.</AdminEmptyState> : (
          <table className="adm-table"><thead><tr><th>Entreprise</th><th>Type</th><th>Détail</th><th>Montant</th><th>Statut</th><th>Date</th></tr></thead><tbody>
            {payments.map((p) => <tr key={p.id}><td className="font-semibold">{p.organizationName}</td><td className="adm-muted">{TYPE_LABEL[p.paymentType] ?? p.paymentType}</td><td className="adm-muted">{p.paymentType === "plan_subscription" ? (p.planKey ?? "—") : (p.addonKey ?? "—")}{p.addonQuantity ? ` × ${p.addonQuantity}` : ""}</td><td className="font-bold">{formatFcfa(p.amountFcfa)}</td><td><AdminBadge tone={STATUS_LABEL[p.status]?.tone ?? "neutral"}>{STATUS_LABEL[p.status]?.label ?? p.status}</AdminBadge></td><td className="adm-muted">{new Date(p.createdAt).toLocaleDateString("fr-FR")}</td></tr>)}
          </tbody></table>
        )}
      </AdminTableCard>
    </div>
  );
}
