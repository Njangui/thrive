import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import {
  listDomainsForAdmin,
  listTldPricingForAdmin,
  upsertTldPricing,
  listDomainRequestsForAdmin,
  resolveDomainRequest,
} from "@/application/services/admin-domains-service";
import { AppError } from "@/lib/errors";

async function upsertTldPricingAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();

  try {
    await upsertTldPricing(
      String(formData.get("tld") ?? ""),
      Number(formData.get("supplierPriceFcfa") ?? 0),
      Number(formData.get("marginFcfa") ?? 0),
      formData.get("active") === "on",
      admin.userId,
    );
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'enregistrement de la tarification";
    redirect(`/admin/domains?error=${encodeURIComponent(message)}`);
  }

  redirect("/admin/domains?success=" + encodeURIComponent("Tarification enregistrée."));
}

async function resolveDomainRequestAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const requestId = String(formData.get("requestId") ?? "");
  const newStatus = String(formData.get("newStatus") ?? "") as "processing" | "registered" | "failed" | "cancelled";
  const resolutionNote = String(formData.get("resolutionNote") ?? "") || undefined;

  try {
    await resolveDomainRequest(requestId, newStatus, admin.userId, resolutionNote);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la résolution de la demande";
    redirect(`/admin/domains?error=${encodeURIComponent(message)}`);
  }

  redirect("/admin/domains?success=" + encodeURIComponent("Demande mise à jour."));
}

const REQUEST_STATUS_LABEL: Record<string, { label: string; className: string }> = {
  requested: { label: "En attente", className: "bg-clay/10 text-clay" },
  processing: { label: "En cours", className: "bg-ink/10 text-ink" },
  registered: { label: "Enregistré", className: "bg-leaf/10 text-leaf" },
  failed: { label: "Échoué", className: "bg-clay/10 text-clay" },
  cancelled: { label: "Annulé", className: "bg-ink/5 text-muted" },
};

export default async function AdminDomainsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  await requirePlatformAdmin();
  const { error, success } = await searchParams;
  const [domains, tldPricing, domainRequests] = await Promise.all([
    listDomainsForAdmin(),
    listTldPricingForAdmin(),
    listDomainRequestsForAdmin(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-2xl font-bold tracking-tight">Domaines</h1>

      {error && <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>}
      {success && (
        <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">{success}</p>
      )}

      <section>
        <h2 className="font-display text-lg font-semibold">Domaines branchés</h2>
        <div className="mt-3 overflow-x-auto rounded-brand border border-ink/10 bg-white">
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
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold">Tarification</h2>
        <p className="mt-1 text-sm text-muted">Prix vendu = prix fournisseur + marge (calculé, jamais stocké).</p>

        <form
          action={upsertTldPricingAction}
          className="mt-3 grid grid-cols-1 gap-3 rounded-brand border border-ink/10 bg-white p-4 sm:grid-cols-4 sm:items-end"
        >
          <label className="flex flex-col text-sm">
            Extension (ex: .cm)
            <input name="tld" required placeholder=".cm" className="mt-1 rounded-brand border border-ink/20 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col text-sm">
            Prix fournisseur (FCFA)
            <input type="number" name="supplierPriceFcfa" min={0} required className="mt-1 rounded-brand border border-ink/20 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col text-sm">
            Marge (FCFA)
            <input type="number" name="marginFcfa" min={0} required className="mt-1 rounded-brand border border-ink/20 px-3 py-2 text-sm" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked className="h-4 w-4" />
            Actif (en vente)
          </label>
          <div className="sm:col-span-4">
            <button type="submit" className="rounded-brand bg-ink px-4 py-2 text-xs font-medium text-white hover:opacity-90">
              Enregistrer la tarification
            </button>
          </div>
        </form>

        <div className="mt-3 overflow-x-auto rounded-brand border border-ink/10 bg-white">
          {tldPricing.length === 0 ? (
            <p className="p-6 text-sm text-muted">Aucune extension tarifée pour l&apos;instant.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-2">Extension</th>
                  <th className="px-4 py-2">Fournisseur</th>
                  <th className="px-4 py-2">Marge</th>
                  <th className="px-4 py-2">Prix vendu</th>
                  <th className="px-4 py-2">Statut</th>
                </tr>
              </thead>
              <tbody>
                {tldPricing.map((t) => (
                  <tr key={t.tld} className="border-b border-ink/5 last:border-0">
                    <td className="px-4 py-2 font-mono">{t.tld}</td>
                    <td className="px-4 py-2 text-muted">{t.supplierPriceFcfa.toLocaleString("fr-FR")} FCFA</td>
                    <td className="px-4 py-2 text-muted">{t.marginFcfa.toLocaleString("fr-FR")} FCFA</td>
                    <td className="px-4 py-2 font-medium">{t.soldPriceFcfa.toLocaleString("fr-FR")} FCFA</td>
                    <td className={`px-4 py-2 font-medium ${t.active ? "text-leaf" : "text-muted"}`}>
                      {t.active ? "Actif" : "Désactivé"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold">Demandes ({domainRequests.filter((r) => r.status === "requested").length} en attente)</h2>
        <div className="mt-3 flex flex-col gap-3">
          {domainRequests.length === 0 ? (
            <p className="rounded-brand border border-ink/10 bg-white p-6 text-sm text-muted">
              Aucune demande de domaine pour l&apos;instant.
            </p>
          ) : (
            domainRequests.map((r) => {
              const statusInfo = REQUEST_STATUS_LABEL[r.status] ?? { label: r.status, className: "bg-ink/5 text-muted" };
              const isFinal = r.status === "registered" || r.status === "failed" || r.status === "cancelled";
              return (
                <div key={r.id} className="rounded-brand border border-ink/10 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-ink">{r.domainName}</p>
                      <p className="text-xs text-muted">
                        {r.organizationName} — demandé le {new Date(r.requestedAt).toLocaleDateString("fr-FR")} — prix vendu{" "}
                        {r.soldPriceFcfa.toLocaleString("fr-FR")} FCFA
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${statusInfo.className}`}>{statusInfo.label}</span>
                  </div>
                  {r.resolutionNote && <p className="mt-2 text-xs text-muted">Note : {r.resolutionNote}</p>}

                  {!isFinal && (
                    <form action={resolveDomainRequestAction} className="mt-3 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="requestId" value={r.id} />
                      <label className="flex flex-col text-xs text-muted">
                        Nouveau statut
                        <select name="newStatus" defaultValue={r.status === "requested" ? "processing" : "registered"} className="mt-1 rounded-brand border border-ink/20 px-2 py-1.5 text-sm">
                          <option value="processing">En cours de traitement</option>
                          <option value="registered">Enregistré</option>
                          <option value="failed">Échoué</option>
                          <option value="cancelled">Annulé</option>
                        </select>
                      </label>
                      <label className="flex flex-1 flex-col text-xs text-muted">
                        Note (optionnel)
                        <input name="resolutionNote" className="mt-1 rounded-brand border border-ink/20 px-2 py-1.5 text-sm" />
                      </label>
                      <button type="submit" className="rounded-brand bg-ink px-3 py-2 text-xs font-medium text-white hover:opacity-90">
                        Mettre à jour
                      </button>
                    </form>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
