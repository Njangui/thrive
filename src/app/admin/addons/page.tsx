import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { listAddons } from "@/application/services/addons-service";
import { createAddon, updateAddon, getTrialDays, setTrialDays } from "@/application/services/admin-addons-service";
import { AppError } from "@/lib/errors";

async function createAddonAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();

  try {
    await createAddon(
      {
        key: String(formData.get("key") ?? ""),
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? "") || undefined,
        priceFcfa: Number(formData.get("priceFcfa") ?? 0),
        entitlementKey: String(formData.get("entitlementKey") ?? ""),
        incrementValue: Number(formData.get("incrementValue") ?? 0),
      },
      admin.userId,
    );
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la création de l'add-on";
    redirect(`/admin/addons?error=${encodeURIComponent(message)}`);
  }

  redirect("/admin/addons?success=" + encodeURIComponent("Add-on créé."));
}

async function toggleAddonAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const key = String(formData.get("key") ?? "");
  const active = formData.get("active") === "true";

  try {
    await updateAddon(key, { active: !active }, admin.userId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la mise à jour de l'add-on";
    redirect(`/admin/addons?error=${encodeURIComponent(message)}`);
  }

  redirect("/admin/addons?success=" + encodeURIComponent(active ? "Add-on désactivé." : "Add-on réactivé."));
}

async function updateTrialDaysAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const days = Number(formData.get("trialDays") ?? 0);

  try {
    await setTrialDays(days, admin.userId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la mise à jour du réglage";
    redirect(`/admin/addons?error=${encodeURIComponent(message)}`);
  }

  redirect("/admin/addons?success=" + encodeURIComponent("Durée d'essai mise à jour."));
}

export default async function AdminAddonsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  await requirePlatformAdmin();
  const { error, success } = await searchParams;
  const [addons, trialDays] = await Promise.all([listAddons(true), getTrialDays()]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Add-ons</h1>
        <p className="mt-1 text-sm text-muted">Catalogue plateforme et réglages globaux (Lot G).</p>
      </div>

      {error && <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>}
      {success && (
        <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">{success}</p>
      )}

      <section>
        <h2 className="font-display text-lg font-semibold">Réglages plateforme</h2>
        <form action={updateTrialDaysAction} className="mt-3 flex items-end gap-2">
          <label className="flex flex-col text-sm">
            Durée d&apos;essai par défaut (jours)
            <input
              type="number"
              name="trialDays"
              min={1}
              defaultValue={trialDays}
              className="mt-1 w-32 rounded-brand border border-ink/20 px-3 py-2 text-sm text-ink"
            />
          </label>
          <button type="submit" className="rounded-brand bg-ink px-3 py-2 text-xs font-medium text-white hover:opacity-90">
            Enregistrer
          </button>
        </form>
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold">Créer un add-on</h2>
        <form action={createAddonAction} className="mt-3 grid grid-cols-1 gap-3 rounded-brand border border-ink/10 bg-white p-4 sm:grid-cols-2">
          <label className="flex flex-col text-sm">
            Clé (unique, ex: extra_ai_credits_100)
            <input name="key" required className="mt-1 rounded-brand border border-ink/20 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col text-sm">
            Nom affiché
            <input name="name" required className="mt-1 rounded-brand border border-ink/20 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col text-sm sm:col-span-2">
            Description
            <input name="description" className="mt-1 rounded-brand border border-ink/20 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col text-sm">
            Prix (FCFA)
            <input type="number" name="priceFcfa" min={0} required className="mt-1 rounded-brand border border-ink/20 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col text-sm">
            Clé d&apos;entitlement ciblée (ex: ai_credits, whatsapp_groups)
            <input name="entitlementKey" required className="mt-1 rounded-brand border border-ink/20 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col text-sm">
            Incrément accordé
            <input type="number" name="incrementValue" min={1} required className="mt-1 rounded-brand border border-ink/20 px-3 py-2 text-sm" />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="rounded-brand bg-ink px-4 py-2 text-xs font-medium text-white hover:opacity-90">
              Créer l&apos;add-on
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold">Catalogue ({addons.length})</h2>
        <div className="mt-3 overflow-x-auto rounded-brand border border-ink/10 bg-white">
          {addons.length === 0 ? (
            <p className="p-6 text-sm text-muted">Aucun add-on créé pour l&apos;instant.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-2">Clé</th>
                  <th className="px-4 py-2">Nom</th>
                  <th className="px-4 py-2">Prix</th>
                  <th className="px-4 py-2">Cible</th>
                  <th className="px-4 py-2">Incrément</th>
                  <th className="px-4 py-2">Statut</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {addons.map((addon) => (
                  <tr key={addon.key} className="border-b border-ink/5 last:border-0">
                    <td className="px-4 py-2 font-mono text-xs text-muted">{addon.key}</td>
                    <td className="px-4 py-2">{addon.name}</td>
                    <td className="px-4 py-2">{addon.priceFcfa.toLocaleString("fr-FR")} FCFA</td>
                    <td className="px-4 py-2 font-mono text-xs">{addon.entitlementKey}</td>
                    <td className="px-4 py-2">+{addon.incrementValue}</td>
                    <td className={`px-4 py-2 font-medium ${addon.active ? "text-leaf" : "text-muted"}`}>
                      {addon.active ? "Actif" : "Désactivé"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <form action={toggleAddonAction}>
                        <input type="hidden" name="key" value={addon.key} />
                        <input type="hidden" name="active" value={String(addon.active)} />
                        <button type="submit" className="text-xs text-ink underline hover:no-underline">
                          {addon.active ? "Désactiver" : "Réactiver"}
                        </button>
                      </form>
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
