import { redirect } from "next/navigation";
import { requireCurrentOrganization, requireMembership, getCurrentUserEmail } from "@/application/services/auth-service";
import { listAddons, getOrganizationAddons, purchaseAddon } from "@/application/services/addons-service";
import { AppError } from "@/lib/errors";

async function purchaseAddonAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const addonKey = String(formData.get("addonKey") ?? "");
  const quantity = Number(formData.get("quantity") ?? 1);
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  const email = await getCurrentUserEmail();

  if (!email) {
    redirect(`/dashboard/addons?error=${encodeURIComponent("Email de session introuvable — reconnectez-vous.")}`);
  }

  let paymentUrl: string;
  try {
    const result = await purchaseAddon(organizationId, addonKey, quantity, membership.userId, email as string);
    if (!result.paymentUrl) throw new Error("URL de paiement manquante dans la réponse NotchPay.");
    paymentUrl = result.paymentUrl;
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'achat de l'add-on.";
    redirect(`/dashboard/addons?error=${encodeURIComponent(message)}`);
  }

  redirect(paymentUrl);
}

export default async function AddonsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  const [catalogue, owned] = await Promise.all([listAddons(), getOrganizationAddons(organizationId)]);

  const ownedByKey = new Map(owned.map((o) => [o.addonKey, o.quantity]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Add-ons</h1>
        <p className="mt-1 text-sm text-muted">
          Des compléments payants pour dépasser les limites de votre forfait, sans en changer.
        </p>
      </div>

      {error && <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>}
      {success && (
        <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">{success}</p>
      )}

      {owned.length > 0 && (
        <div>
          <h2 className="font-display text-lg font-semibold">Vos add-ons actifs</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {owned.map((o) => (
              <li
                key={o.addonKey}
                className="flex items-center justify-between rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm"
              >
                <span className="font-medium text-ink">{o.name}</span>
                <span className="text-leaf">× {o.quantity}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="font-display text-lg font-semibold">Catalogue</h2>
        {catalogue.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Aucun add-on disponible à la vente pour le moment.</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {catalogue.map((addon) => (
              <div key={addon.key} className="flex flex-col rounded-brand border border-ink/10 bg-white p-4">
                <p className="font-display text-base font-semibold">{addon.name}</p>
                {addon.description && <p className="mt-1 text-xs text-muted">{addon.description}</p>}
                <p className="mt-2 text-lg font-semibold">
                  {addon.priceFcfa.toLocaleString("fr-FR")} FCFA
                  <span className="text-xs font-normal text-muted"> / unité</span>
                </p>
                {ownedByKey.has(addon.key) && (
                  <p className="mt-1 text-xs text-leaf">Déjà possédé : × {ownedByKey.get(addon.key)}</p>
                )}
                <form action={purchaseAddonAction} className="mt-3 flex items-end gap-2">
                  <input type="hidden" name="organizationId" value={organizationId} />
                  <input type="hidden" name="addonKey" value={addon.key} />
                  <label className="flex flex-col text-xs text-muted">
                    Quantité
                    <input
                      type="number"
                      name="quantity"
                      min={1}
                      defaultValue={1}
                      className="mt-1 w-16 rounded-brand border border-ink/20 px-2 py-1 text-sm text-ink"
                    />
                  </label>
                  <button
                    type="submit"
                    className="flex-1 rounded-brand bg-ink px-3 py-2 text-xs font-medium text-white transition hover:opacity-90"
                  >
                    Acheter
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
