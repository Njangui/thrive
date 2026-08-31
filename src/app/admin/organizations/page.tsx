import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import {
  listOrganizationsForAdmin,
  listPlansForAdmin,
  setOrganizationStatus,
  changeOrganizationPlan,
  grantAiCreditsToOrganization,
} from "@/application/services/admin-organizations-service";
import { AppError } from "@/lib/errors";

async function toggleStatusAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const organizationId = String(formData.get("organizationId") ?? "");
  const newStatus = String(formData.get("newStatus") ?? "") as "active" | "suspended";

  try {
    await setOrganizationStatus(organizationId, newStatus, admin.userId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors du changement de statut";
    redirect(`/admin/organizations?error=${encodeURIComponent(message)}`);
  }
  redirect("/admin/organizations");
}

async function changePlanAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const organizationId = String(formData.get("organizationId") ?? "");
  const newPlan = String(formData.get("newPlan") ?? "");

  try {
    await changeOrganizationPlan(organizationId, newPlan, admin.userId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors du changement de plan";
    redirect(`/admin/organizations?error=${encodeURIComponent(message)}`);
  }
  redirect("/admin/organizations");
}

async function grantCreditsAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const organizationId = String(formData.get("organizationId") ?? "");
  const amount = Number(formData.get("amount") ?? 0);

  try {
    await grantAiCreditsToOrganization(organizationId, amount, admin.userId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'ajout de crédits";
    redirect(`/admin/organizations?error=${encodeURIComponent(message)}`);
  }
  redirect("/admin/organizations");
}

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  suspended: "Suspendue",
};

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  trialing: "Essai",
  active: "Abonnement actif",
  past_due: "Impayé",
  cancelled: "Résilié",
};

function formatCredits(status: { includedCredits: number; usedCredits: number; remainingCredits: number }): string {
  if (status.includedCredits === -1) return "Illimité";
  return `${status.remainingCredits.toLocaleString("fr-FR")} / ${status.includedCredits.toLocaleString("fr-FR")} restants`;
}

export default async function AdminOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  await requirePlatformAdmin();
  const [organizations, plans] = await Promise.all([listOrganizationsForAdmin(), listPlansForAdmin()]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">Entreprises</h1>

      {error && (
        <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>
      )}

      <div className="flex flex-col gap-4">
        {organizations.map((org) => (
          <div key={org.id} className="rounded-brand border border-ink/10 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-display text-sm font-semibold">{org.name}</p>
                <p className="text-xs text-muted">{org.slug}</p>
              </div>
              <div className="flex gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    org.status === "active" ? "bg-leaf/10 text-leaf" : "bg-clay/10 text-clay"
                  }`}
                >
                  {STATUS_LABELS[org.status] ?? org.status}
                </span>
                <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs text-muted">
                  {SUBSCRIPTION_STATUS_LABELS[org.subscriptionStatus] ?? org.subscriptionStatus}
                </span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted sm:grid-cols-4">
              <p>
                Plan : <span className="text-ink">{org.planKey}</span>
              </p>
              <p>
                Essai jusqu&apos;au :{" "}
                <span className="text-ink">
                  {org.trialEnd ? new Date(org.trialEnd).toLocaleDateString("fr-FR") : "—"}
                </span>
              </p>
              <p>
                Créée le : <span className="text-ink">{new Date(org.createdAt).toLocaleDateString("fr-FR")}</span>
              </p>
              <p>
                Dernière activité :{" "}
                <span className="text-ink">
                  {org.lastActivityAt ? new Date(org.lastActivityAt).toLocaleDateString("fr-FR") : "—"}
                </span>
              </p>
            </div>

            <p className="mt-2 text-xs text-muted">
              Canaux connectés :{" "}
              {org.connectedChannels.length > 0 ? org.connectedChannels.join(", ") : "aucun"}
              {" · "}Crédits IA : {formatCredits(org.creditStatus)}
            </p>

            <div className="mt-4 flex flex-wrap gap-3 border-t border-ink/10 pt-3">
              <form action={toggleStatusAction}>
                <input type="hidden" name="organizationId" value={org.id} />
                <input
                  type="hidden"
                  name="newStatus"
                  value={org.status === "suspended" ? "active" : "suspended"}
                />
                <button
                  type="submit"
                  className={`rounded-brand px-3 py-1.5 text-xs font-medium text-white ${
                    org.status === "suspended" ? "bg-leaf" : "bg-clay"
                  }`}
                >
                  {org.status === "suspended" ? "Activer" : "Suspendre"}
                </button>
              </form>

              <form action={changePlanAction} className="flex items-center gap-1">
                <input type="hidden" name="organizationId" value={org.id} />
                <select
                  name="newPlan"
                  defaultValue={org.planKey}
                  className="rounded-brand border border-ink/15 px-2 py-1 text-xs"
                >
                  {plans.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button type="submit" className="rounded-brand bg-ink px-3 py-1.5 text-xs font-medium text-white">
                  Changer le plan
                </button>
              </form>

              <form action={grantCreditsAction} className="flex items-center gap-1">
                <input type="hidden" name="organizationId" value={org.id} />
                <input
                  name="amount"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Crédits IA"
                  className="w-28 rounded-brand border border-ink/15 px-2 py-1 text-xs"
                />
                <button type="submit" className="rounded-brand bg-ink px-3 py-1.5 text-xs font-medium text-white">
                  Ajouter crédits
                </button>
              </form>
            </div>
          </div>
        ))}

        {organizations.length === 0 && (
          <p className="rounded-brand border border-ink/10 bg-white p-6 text-sm text-muted">
            Aucune entreprise pour l&apos;instant.
          </p>
        )}
      </div>
    </div>
  );
}
