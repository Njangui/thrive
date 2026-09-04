import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCurrentOrganization, requireMembership } from "@/application/services/auth-service";
import { listServicesForOrg, toggleServiceStatus, type ServiceStatus } from "@/application/services/service-service";
import { AppError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  active: "Actif",
  inactive: "Inactif",
};

async function toggleServiceStatusAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  const serviceId = String(formData.get("serviceId") ?? "");
  const newStatus = String(formData.get("newStatus") ?? "") as ServiceStatus;

  try {
    await toggleServiceStatus(serviceId, organizationId, newStatus);
    redirect(
      `/dashboard/services?success=${encodeURIComponent(newStatus === "active" ? "Service activé." : "Service désactivé.")}`,
    );
  } catch (error) {
    if (error instanceof AppError) {
      redirect(`/dashboard/services?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
}

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();

  const services = await listServicesForOrg(organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Services</h1>
          <p className="mt-1 text-sm text-muted">
            Vos prestations — utilisées sur votre site, dans les réponses de l&apos;assistant et pour les
            rendez-vous.
          </p>
        </div>
        <Link href="/dashboard/services/new" className="rounded-brand bg-leaf px-4 py-2 text-sm font-medium text-white">
          + Ajouter un service
        </Link>
      </div>

      {success && <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">{success}</p>}
      {error && <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>}

      <div className="overflow-hidden rounded-brand border border-ink/10 bg-white">
        {services.length === 0 ? (
          <div className="p-6 text-sm text-muted">
            <p className="font-medium text-ink">Vous n&apos;avez encore aucun service.</p>
            <p className="mt-1">
              Ajoutez vos prestations (coiffure, réparation, consultation...) pour qu&apos;elles apparaissent sur
              votre site et que votre assistant puisse en parler à vos clients.
            </p>
            <Link href="/dashboard/services/new" className="mt-3 inline-block text-leaf hover:underline">
              Ajouter mon premier service →
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-2">Nom</th>
                <th className="px-4 py-2">Catégorie</th>
                <th className="px-4 py-2">Prix</th>
                <th className="px-4 py-2">Durée</th>
                <th className="px-4 py-2">Statut</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-2">{s.name}</td>
                  <td className="px-4 py-2 text-muted">{s.categoryName ?? "—"}</td>
                  <td className="px-4 py-2">{s.price.toLocaleString("fr-FR")} FCFA</td>
                  <td className="px-4 py-2 text-muted">{s.durationMinutes ? `${s.durationMinutes} min` : "—"}</td>
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
                      <Link href={`/dashboard/services/${s.id}/edit`} className="text-xs font-medium text-leaf hover:underline">
                        Modifier
                      </Link>
                      <form action={toggleServiceStatusAction}>
                        <input type="hidden" name="organizationId" value={organizationId} />
                        <input type="hidden" name="serviceId" value={s.id} />
                        <input type="hidden" name="newStatus" value={s.status === "active" ? "inactive" : "active"} />
                        <SubmitButton pendingLabel="..." className="text-xs font-medium text-muted hover:underline disabled:opacity-60">
                          {s.status === "active" ? "Désactiver" : "Activer"}
                        </SubmitButton>
                      </form>
                    </div>
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
