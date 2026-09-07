import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { listChannelsForAdmin } from "@/application/services/admin-channels-service";
import { env } from "@/lib/env";

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
      <h1 className="font-jakarta text-2xl font-bold tracking-tight">Canaux</h1>
      <p className="text-xs text-slate-500">
        &quot;Reconnecter&quot; ouvre un lien informatif vers le tableau de bord de l&apos;entreprise concernée —
        la reconnexion elle-même se fait depuis son propre compte, pas depuis cette console.
      </p>

      <div className="overflow-x-auto rounded-xl border border-navy-900/10 bg-white">
        {channels.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">Aucun canal enregistré.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-navy-900/10 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Entreprise</th>
                <th className="px-4 py-2">Canal</th>
                <th className="px-4 py-2">Statut</th>
                <th className="px-4 py-2">Dernière mise à jour</th>
                <th className="px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.id} className="border-b border-navy-900/[0.05] last:border-0">
                  <td className="px-4 py-2">{c.organizationName || "—"}</td>
                  <td className="px-4 py-2 text-slate-500">
                    {c.providerName} <span className="text-navy-900/40">({c.providerType})</span>
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        c.status === "connected"
                          ? "bg-success-50 text-success-700"
                          : c.status === "error"
                            ? "bg-danger-50 text-danger-700"
                            : "bg-navy-900/[0.06] text-slate-500"
                      }`}
                    >
                      {STATUS_LABELS[c.status] ?? c.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-500">{new Date(c.updatedAt).toLocaleString("fr-FR")}</td>
                  <td className="px-4 py-2">
                    {c.organizationSlug ? (
                      <a
                        href={`https://${c.organizationSlug}.${env.NEXT_PUBLIC_ROOT_DOMAIN}/dashboard`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-navy-900 underline"
                      >
                        Lien du tableau de bord
                      </a>
                    ) : (
                      <span className="text-xs text-slate-500">—</span>
                    )}
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
