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
  pending: "bg-ink/10 text-muted",
  sent: "bg-leaf/10 text-leaf",
  failed: "bg-clay/10 text-clay",
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
          <Link href="/dashboard/groups" className="text-sm text-leaf hover:underline">
            ← Retour aux groupes
          </Link>
          <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">
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
        <Link href="/dashboard/groups" className="text-sm text-leaf hover:underline">
          ← Retour aux groupes
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Diffusion du {new Date(detail.scheduledAt).toLocaleString("fr-FR")}
          </h1>
          <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs">
            {BROADCAST_STATUS_LABELS[detail.status] ?? detail.status}
          </span>
        </div>
      </div>

      <section className="rounded-brand border border-ink/10 bg-white p-4">
        <h2 className="font-display text-lg font-semibold">Produits diffusés ({detail.products.length})</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {detail.products.map((p) => (
            <li key={p.id} className="flex items-center justify-between border-b border-ink/5 pb-2 last:border-0">
              <span>{p.name}</span>
              <span className="text-muted">{p.unitPrice.toLocaleString("fr-FR")} FCFA</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-brand border border-ink/10 bg-white p-4">
        <h2 className="font-display text-lg font-semibold">
          Groupes ciblés ({detail.sentCount}/{detail.targetCount} envoyé(s))
        </h2>
        <table className="mt-3 w-full text-sm">
          <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-2 py-2">Groupe</th>
              <th className="px-2 py-2">Statut</th>
              <th className="px-2 py-2">Détail</th>
            </tr>
          </thead>
          <tbody>
            {detail.targets.map((t) => (
              <tr key={t.id} className="border-b border-ink/5 last:border-0">
                <td className="px-2 py-2">{t.groupName}</td>
                <td className="px-2 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${TARGET_STATUS_STYLES[t.status] ?? "bg-ink/10 text-ink"}`}>
                    {TARGET_STATUS_LABELS[t.status] ?? t.status}
                  </span>
                </td>
                <td className="px-2 py-2 text-xs text-muted">{t.errorMessage ?? (t.sentAt ? new Date(t.sentAt).toLocaleString("fr-FR") : "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
