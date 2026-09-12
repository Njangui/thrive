import { redirect } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import { listServices, createService, updateService, deleteService } from "@/application/services/service-catalog-service";
import { AppError } from "@/lib/errors";

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  active: "Actif",
  inactive: "Inactif",
  out_of_stock: "Indisponible",
};

async function createServiceAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    await createService({
      organizationId,
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? "") || undefined,
      categoryName: String(formData.get("category") ?? "") || undefined,
      priceFcfa: Number(formData.get("price") ?? 0),
      durationMinutes: formData.get("duration") ? Number(formData.get("duration")) : undefined,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la création de la prestation";
    redirect(`/dashboard/services?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/services?success=" + encodeURIComponent("Prestation créée."));
}

async function toggleServiceStatusAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);
  const serviceId = String(formData.get("serviceId") ?? "");
  const currentStatus = String(formData.get("currentStatus") ?? "");

  try {
    await updateService(organizationId, serviceId, { status: currentStatus === "active" ? "inactive" : "active" });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la mise à jour";
    redirect(`/dashboard/services?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/services");
}

async function deleteServiceAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);
  const serviceId = String(formData.get("serviceId") ?? "");

  try {
    await deleteService(organizationId, serviceId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la suppression";
    redirect(`/dashboard/services?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/services?success=" + encodeURIComponent("Prestation supprimée."));
}

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  const services = await listServices(organizationId);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">Prestations</h1>
      <p className="text-sm text-muted">
        Vos services (coupe, consultation, réparation...) — utilisés comme le catalogue produits : sur votre site,
        dans WhatsApp et par l&apos;assistant IA pour répondre sans deviner de prix.
      </p>

      {error && <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>}
      {success && (
        <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">{success}</p>
      )}

      <section>
        <h2 className="font-display text-lg font-semibold">Ajouter une prestation</h2>
        <form
          action={createServiceAction}
          className="mt-3 grid grid-cols-1 gap-3 rounded-brand border border-ink/10 bg-white p-4 sm:grid-cols-2"
        >
          <input type="hidden" name="organizationId" value={organizationId} />
          <label className="flex flex-col text-sm">
            Nom
            <input name="name" required className="mt-1 rounded-brand border border-ink/15 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col text-sm">
            Prix (FCFA)
            <input type="number" name="price" min={0} required className="mt-1 rounded-brand border border-ink/15 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col text-sm">
            Durée (minutes, optionnel)
            <input type="number" name="duration" min={0} className="mt-1 rounded-brand border border-ink/15 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col text-sm">
            Catégorie (optionnel)
            <input name="category" placeholder="Ex : Coiffure" className="mt-1 rounded-brand border border-ink/15 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col text-sm sm:col-span-2">
            Description
            <textarea name="description" rows={2} className="mt-1 rounded-brand border border-ink/15 px-3 py-2 text-sm" />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="rounded-brand bg-leaf px-4 py-2 text-xs font-medium text-white">
              Créer la prestation
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold">Vos prestations ({services.length})</h2>
        <div className="mt-3 overflow-hidden rounded-brand border border-ink/10 bg-white">
          {services.length === 0 ? (
            <p className="p-6 text-sm text-muted">
              Aucune prestation pour l&apos;instant. Ajoutez-en une pour qu&apos;elle apparaisse sur votre site et
              soit reconnue par l&apos;assistant WhatsApp.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-2">Nom</th>
                  <th className="px-4 py-2">Prix</th>
                  <th className="px-4 py-2">Durée</th>
                  <th className="px-4 py-2">Catégorie</th>
                  <th className="px-4 py-2">Statut</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id} className="border-b border-ink/5 last:border-0">
                    <td className="px-4 py-2 font-medium">{s.name}</td>
                    <td className="px-4 py-2">{s.priceFcfa.toLocaleString("fr-FR")} FCFA</td>
                    <td className="px-4 py-2 text-muted">{s.durationMinutes ? `${s.durationMinutes} min` : "—"}</td>
                    <td className="px-4 py-2 text-muted">{s.categoryName ?? "—"}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          s.status === "active" ? "bg-leaf/10 text-leaf" : "bg-ink/10 text-muted"
                        }`}
                      >
                        {STATUS_LABELS[s.status] ?? s.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <form action={toggleServiceStatusAction}>
                          <input type="hidden" name="organizationId" value={organizationId} />
                          <input type="hidden" name="serviceId" value={s.id} />
                          <input type="hidden" name="currentStatus" value={s.status} />
                          <button type="submit" className="text-xs font-medium text-leaf hover:underline">
                            {s.status === "active" ? "Désactiver" : "Activer"}
                          </button>
                        </form>
                        <form action={deleteServiceAction}>
                          <input type="hidden" name="organizationId" value={organizationId} />
                          <input type="hidden" name="serviceId" value={s.id} />
                          <button type="submit" className="text-xs text-clay hover:underline">
                            Supprimer
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
