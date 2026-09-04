import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import {
  listPhoneNumbersForAdmin,
  addPhoneNumber,
  assignPhoneNumberToOrganization,
  unassignPhoneNumber,
} from "@/application/services/admin-numbers-service";
import { listOrganizationsForAdmin } from "@/application/services/admin-organizations-service";
import { AppError } from "@/lib/errors";

async function addPhoneNumberAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const phoneE164 = String(formData.get("phoneE164") ?? "");
  const country = String(formData.get("country") ?? "") || undefined;

  try {
    await addPhoneNumber(phoneE164, country, admin.userId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'ajout du numéro";
    redirect(`/admin/numbers?error=${encodeURIComponent(message)}`);
  }
  redirect("/admin/numbers");
}

/**
 * Lot 4 — voir RAPPORT_LOT_4.md. Assigne un numéro en pool à une
 * entreprise ; débloque le bonus "+N groupes WhatsApp" (section 55)
 * dès que la ligne `phone_numbers.status` passe à 'assigned'.
 */
async function assignPhoneNumberAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const numberId = String(formData.get("numberId") ?? "");
  const organizationId = String(formData.get("organizationId") ?? "");

  if (!organizationId) {
    redirect(`/admin/numbers?error=${encodeURIComponent("Choisissez une entreprise avant d'assigner.")}`);
    return;
  }

  try {
    await assignPhoneNumberToOrganization(numberId, organizationId, admin.userId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'assignation du numéro";
    redirect(`/admin/numbers?error=${encodeURIComponent(message)}`);
  }
  redirect("/admin/numbers?success=" + encodeURIComponent("Numéro assigné."));
}

async function unassignPhoneNumberAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const numberId = String(formData.get("numberId") ?? "");

  try {
    await unassignPhoneNumber(numberId, admin.userId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors du retrait du numéro";
    redirect(`/admin/numbers?error=${encodeURIComponent(message)}`);
  }
  redirect("/admin/numbers?success=" + encodeURIComponent("Numéro retiré — repli dans le pool disponible."));
}

const STATUS_LABELS: Record<string, string> = {
  available: "Disponible",
  assigned: "Assigné",
  suspended: "Suspendu",
};

export default async function AdminNumbersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  await requirePlatformAdmin();
  const [numbers, organizations] = await Promise.all([listPhoneNumbersForAdmin(), listOrganizationsForAdmin()]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Numéros</h1>
        <p className="mt-1 text-sm text-muted">
          Un numéro assigné débloque le bonus &laquo;&nbsp;groupes WhatsApp&nbsp;&raquo; de son plan (section 55).
        </p>
      </div>

      {error && (
        <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>
      )}
      {success && (
        <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">{success}</p>
      )}

      <form
        action={addPhoneNumberAction}
        className="flex flex-wrap items-end gap-2 rounded-brand border border-ink/10 bg-white p-4"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted" htmlFor="phoneE164">
            Numéro (format E.164)
          </label>
          <input
            id="phoneE164"
            name="phoneE164"
            required
            placeholder="+237690000000"
            className="rounded-brand border border-ink/15 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted" htmlFor="country">
            Pays (optionnel)
          </label>
          <input
            id="country"
            name="country"
            placeholder="CM"
            className="rounded-brand border border-ink/15 px-3 py-2 text-sm"
          />
        </div>
        <button type="submit" className="rounded-brand bg-ink px-4 py-2 text-sm font-medium text-white">
          + Ajouter un numéro
        </button>
      </form>

      <div className="overflow-x-auto rounded-brand border border-ink/10 bg-white">
        {numbers.length === 0 ? (
          <p className="p-6 text-sm text-muted">Aucun numéro enregistré.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-2">Numéro</th>
                <th className="px-4 py-2">Pays</th>
                <th className="px-4 py-2">Statut</th>
                <th className="px-4 py-2">Entreprise</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {numbers.map((n) => (
                <tr key={n.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-2">{n.phoneE164}</td>
                  <td className="px-4 py-2 text-muted">{n.country ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        n.status === "assigned" ? "bg-leaf/10 text-leaf" : "bg-ink/10 text-muted"
                      }`}
                    >
                      {STATUS_LABELS[n.status] ?? n.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted">{n.organizationName ?? "—"}</td>
                  <td className="px-4 py-2 text-right">
                    {n.organizationId ? (
                      <form action={unassignPhoneNumberAction}>
                        <input type="hidden" name="numberId" value={n.id} />
                        <button type="submit" className="text-xs text-clay hover:underline">
                          Retirer
                        </button>
                      </form>
                    ) : n.status === "suspended" ? (
                      <span className="text-xs text-muted">Suspendu</span>
                    ) : (
                      <form action={assignPhoneNumberAction} className="flex items-center justify-end gap-1">
                        <input type="hidden" name="numberId" value={n.id} />
                        <select
                          name="organizationId"
                          defaultValue=""
                          className="rounded-brand border border-ink/15 px-2 py-1 text-xs"
                        >
                          <option value="" disabled>
                            Choisir une entreprise…
                          </option>
                          {organizations.map((org) => (
                            <option key={org.id} value={org.id}>
                              {org.name}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="rounded-brand bg-ink px-2 py-1 text-xs font-medium text-white">
                          Assigner
                        </button>
                      </form>
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
