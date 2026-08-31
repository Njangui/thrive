import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { listPhoneNumbersForAdmin, addPhoneNumber } from "@/application/services/admin-numbers-service";
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

const STATUS_LABELS: Record<string, string> = {
  available: "Disponible",
  assigned: "Assigné",
  suspended: "Suspendu",
};

export default async function AdminNumbersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  await requirePlatformAdmin();
  const numbers = await listPhoneNumbersForAdmin();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">Numéros</h1>

      {error && (
        <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>
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

      <div className="overflow-hidden rounded-brand border border-ink/10 bg-white">
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
