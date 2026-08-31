import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { listDomainsForAdmin } from "@/application/services/admin-domains-service";

export default async function AdminDomainsPage() {
  await requirePlatformAdmin();
  const domains = await listDomainsForAdmin();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">Domaines</h1>

      <div className="overflow-hidden rounded-brand border border-ink/10 bg-white">
        {domains.length === 0 ? (
          <p className="p-6 text-sm text-muted">Aucun domaine enregistré.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-2">Domaine</th>
                <th className="px-4 py-2">Entreprise</th>
                <th className="px-4 py-2">Principal</th>
                <th className="px-4 py-2">Vérifié</th>
              </tr>
            </thead>
            <tbody>
              {domains.map((d) => (
                <tr key={d.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-2">{d.domain}</td>
                  <td className="px-4 py-2 text-muted">{d.organizationName}</td>
                  <td className="px-4 py-2">{d.isPrimary ? "Oui" : "—"}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        d.verified ? "bg-leaf/10 text-leaf" : "bg-clay/10 text-clay"
                      }`}
                    >
                      {d.verified ? "Vérifié" : "Non vérifié"}
                    </span>
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
