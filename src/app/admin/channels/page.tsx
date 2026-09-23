import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { listChannelsForAdmin } from "@/application/services/admin-channels-service";
import { env } from "@/lib/env";
import { AdminBadge, AdminSectionHeader, AdminTableCard, AdminEmptyState } from "../_components/ui";

const STATUS_LABELS: Record<string, string> = {
  connected: "Connecté",
  disconnected: "Déconnecté",
  error: "Erreur",
  pending: "En attente",
};

export default async function AdminChannelsPage() {
  await requirePlatformAdmin();
  const channels = await listChannelsForAdmin();

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader title="Canaux" description="Surveillez les connexions sociales et messagerie de vos entreprises." action={<span className="adm-badge-neutral">{channels.length} connexions</span>} />
      <AdminTableCard title="Connexions enregistrées">
        {channels.length === 0 ? <AdminEmptyState>Aucun canal enregistré.</AdminEmptyState> : (
          <table className="adm-table"><thead><tr><th>Entreprise</th><th>Canal</th><th>Statut</th><th>Mise à jour</th><th>Action</th></tr></thead><tbody>
            {channels.map((c) => <tr key={c.id}>
              <td><p className="font-semibold">{c.organizationName || "—"}</p><p className="text-xs adm-muted">{c.organizationSlug || ""}</p></td>
              <td><p className="font-medium">{c.providerName}</p><p className="text-xs adm-muted">{c.providerType}</p></td>
              <td><AdminBadge tone={c.status === "connected" ? "success" : c.status === "error" ? "danger" : c.status === "pending" ? "warning" : "neutral"}>{STATUS_LABELS[c.status] ?? c.status}</AdminBadge></td>
              <td className="adm-muted">{new Date(c.updatedAt).toLocaleString("fr-FR")}</td>
              <td>{c.organizationSlug ? <a href={`https://${c.organizationSlug}.${env.NEXT_PUBLIC_ROOT_DOMAIN}/dashboard`} target="_blank" rel="noreferrer" className="text-xs font-bold text-primary-700 hover:underline">Ouvrir le dashboard</a> : <span className="adm-muted">—</span>}</td>
            </tr>)}
          </tbody></table>
        )}
      </AdminTableCard>
    </div>
  );
}
