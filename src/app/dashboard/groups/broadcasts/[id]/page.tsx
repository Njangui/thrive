import Link from "next/link";
import { requireCurrentOrganization } from "@/application/services/auth-service";
import { getBroadcastDetail } from "@/application/services/whatsapp-group-service";
import { NotFoundError } from "@/lib/errors";

const BROADCAST_STATUS_LABELS: Record<string, string> = {
  scheduled: "Programmée",
  processing: "En cours",
  completed: "Terminée",
  failed: "Échouée",
  cancelled: "Annulée",
};

const TARGET_STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  sent: "Envoyé",
  failed: "Échec",
};

const TARGET_STATUS_STYLES: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  sent: "bg-success-50 text-success-700",
  failed: "bg-danger-50 text-danger-700",
};

export default async function BroadcastDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organizationId } = await requireCurrentOrganization();

  let detail;
  try {
    detail = await getBroadcastDetail(organizationId, id);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return (
        <div className="flex flex-col gap-4">
          <Link href="/dashboard/groups" className="text-sm text-violet-600 hover:underline">
            ← Retour aux groupes
          </Link>
          <p className="adm-alert-danger">
            Diffusion introuvable.
          </p>
        </div>
      );
    }
    throw error;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/dashboard/groups" className="text-sm text-violet-600 hover:underline">
          ← Retour aux groupes
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <h1 className="font-jakarta text-2xl font-bold tracking-tight">
            Diffusion du {new Date(detail.scheduledAt).toLocaleString("fr-FR")}
          </h1>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
            {BROADCAST_STATUS_LABELS[detail.status] ?? detail.status}
          </span>
        </div>
      </div>

      <section className="rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)] p-4">
        <h2 className="font-jakarta text-lg font-semibold">Produits diffusés ({detail.products.length})</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {detail.products.map((p) => (
            <li key={p.id} className="flex items-center justify-between border-b border-navy-900/5 pb-2 last:border-0">
              <span>{p.name}</span>
              <span className="text-slate-500">{p.unitPrice.toLocaleString("fr-FR")} FCFA</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)] p-4">
        <h2 className="font-jakarta text-lg font-semibold">
          Groupes ciblés ({detail.sentCount}/{detail.targetCount} envoyé(s))
        </h2>
        <table className="mt-3 w-full text-sm">
          <thead className="border-b border-navy-900/10 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Groupe</th>
              <th className="px-2 py-2">Statut</th>
              <th className="px-2 py-2">Détail</th>
            </tr>
          </thead>
          <tbody>
            {detail.targets.map((t) => (
              <tr key={t.id} className="border-b border-navy-900/5 last:border-0">
                <td className="px-2 py-2">{t.groupName}</td>
                <td className="px-2 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${TARGET_STATUS_STYLES[t.status] ?? "bg-slate-100 text-navy-900"}`}>
                    {TARGET_STATUS_LABELS[t.status] ?? t.status}
                  </span>
                </td>
                <td className="px-2 py-2 text-xs text-slate-500">{t.errorMessage ?? (t.sentAt ? new Date(t.sentAt).toLocaleString("fr-FR") : "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
