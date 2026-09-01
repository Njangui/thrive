import { redirect } from "next/navigation";
import Link from "next/link";
import { requireCurrentOrganization, requireMembership } from "@/application/services/auth-service";
import { getActiveProducts } from "@/application/services/catalog-service";
import { createCampaignFromProducts, checkSocialProviderConnected } from "@/application/services/marketing-service";
import { AppError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";
import { TargetRowsField } from "../target-rows-field";

/**
 * Même convention que dashboard/groups/page.tsx (nowInCameroonAsDatetimeLocal)
 * MAIS pas de conversion UTC ici : `createCampaignFromProducts.firstSlotAt`
 * attend une chaîne locale NUE (voir son commentaire), interprétée avec le
 * fuseau transmis séparément — donc on affiche/attend directement l'heure
 * du Cameroun sans décalage, contrairement à `cameroonLocalToUtcIso` côté
 * diffusions WhatsApp.
 */
function nowInCameroonAsDatetimeLocal(minutesFromNow = 60): string {
  const shifted = new Date(Date.now() + 60 * 60 * 1000 + minutesFromNow * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

async function createCampaignAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  const productIds = formData.getAll("productIds").map(String);
  const platforms = formData.getAll("targetPlatform").map(String);
  const accountIds = formData.getAll("targetAccountId").map(String);
  const firstSlotLocal = String(formData.get("firstSlotAt") ?? "");
  const intervalHoursRaw = String(formData.get("intervalHours") ?? "");
  const timezone = String(formData.get("timezone") ?? "Africa/Douala");
  const nameInput = String(formData.get("name") ?? "").trim();

  const targets = platforms
    .map((platform, i) => ({ platform, accountId: (accountIds[i] ?? "").trim() }))
    .filter((t) => t.accountId.length > 0);

  // `redirect()` jette une erreur spéciale (NEXT_REDIRECT) qui doit rester
  // HORS d'un try/catch — sinon un catch générique la requalifie en erreur
  // (piège documenté Next.js ; voir dashboard/groups/page.tsx où
  // `flashRedirect("success", ...)` est appelé DANS le try : un succès y
  // retombe dans le catch et affiche le message d'erreur générique à la
  // place). Ici, `redirect(...)` n'est jamais appelé à l'intérieur du try.
  let campaignId: string | null = null;
  let errorMessage: string | null = null;

  try {
    if (productIds.length === 0) {
      throw new AppError("Sélectionnez au moins un produit.", 400, "validation");
    }
    if (targets.length === 0) {
      throw new AppError("Ajoutez au moins une cible (plateforme + identifiant de compte).", 400, "validation");
    }
    if (!firstSlotLocal) {
      throw new AppError("Choisissez la date et l'heure du premier créneau.", 400, "validation");
    }
    const intervalHours = Number(intervalHoursRaw);
    if (!Number.isFinite(intervalHours) || intervalHours < 1) {
      throw new AppError("L'intervalle entre publications doit être d'au moins 1 heure.", 400, "validation");
    }

    const name = nameInput || `Campagne du ${new Date().toLocaleDateString("fr-FR")}`;

    const result = await createCampaignFromProducts({
      organizationId,
      name,
      productIds,
      targets,
      firstSlotAt: `${firstSlotLocal}:00`,
      intervalHours,
      timezone,
    });

    if (result.scheduled.length === 0 && result.failed.length > 0) {
      throw new AppError(
        `Aucune publication n'a pu être programmée : ${result.failed[0]?.error ?? "erreur inconnue"}.`,
        502,
        "provider",
      );
    }

    campaignId = result.campaignId;
  } catch (error) {
    errorMessage = error instanceof AppError ? error.message : "Erreur lors de la création de la campagne.";
  }

  if (errorMessage || !campaignId) {
    redirect(`/dashboard/marketing/new?error=${encodeURIComponent(errorMessage ?? "Erreur inconnue.")}`);
  }
  redirect(`/dashboard/marketing/${campaignId}`);
}

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();

  const [products, providerError] = await Promise.all([
    getActiveProducts(organizationId, 200),
    checkSocialProviderConnected(organizationId),
  ]);

  const defaultFirstSlot = nowInCameroonAsDatetimeLocal();
  const minFirstSlot = nowInCameroonAsDatetimeLocal(5);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Nouvelle campagne</h1>
          <p className="mt-1 text-sm text-muted">
            Sélectionnez des produits de votre catalogue : une publication est générée automatiquement pour chacun.
          </p>
        </div>
        <Link href="/dashboard/marketing" className="text-sm font-medium text-primary hover:underline">
          Retour
        </Link>
      </div>

      {error && (
        <p className="rounded-xl border border-danger/30 bg-danger-light px-4 py-3 text-sm text-danger">{error}</p>
      )}

      {providerError && (
        <p className="rounded-xl border border-warning/30 bg-warning-light px-4 py-3 text-sm text-warning">
          {providerError}
        </p>
      )}

      {products.length === 0 ? (
        <div className="rounded-2xl border border-ink/5 bg-white p-6 text-sm text-muted shadow-sm">
          Ajoutez au moins un produit actif à votre catalogue avant de créer une campagne.{" "}
          <Link href="/dashboard/products/new" className="font-medium text-primary hover:underline">
            Ajouter un produit
          </Link>
        </div>
      ) : (
        <form action={createCampaignAction} className="flex flex-col gap-6">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="timezone" value="Africa/Douala" />

          <div className="rounded-2xl border border-ink/5 bg-white p-5 shadow-sm">
            <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-ink">
              Nom de la campagne
            </label>
            <input
              id="name"
              type="text"
              name="name"
              placeholder={`Campagne du ${new Date().toLocaleDateString("fr-FR")}`}
              className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
            />
          </div>

          <div className="rounded-2xl border border-ink/5 bg-white p-5 shadow-sm">
            <p className="mb-3 text-sm font-medium text-ink">Produits à publier</p>
            <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {products.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-2.5 rounded-lg border border-ink/10 px-3 py-2 text-sm hover:bg-surface"
                >
                  <input type="checkbox" name="productIds" value={p.id} className="h-4 w-4 accent-primary" />
                  <span className="flex-1">{p.name}</span>
                  <span className="text-muted">{p.unitPrice.toLocaleString("fr-FR")} FCFA</span>
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-ink/5 bg-white p-5 shadow-sm">
            <p className="mb-3 text-sm font-medium text-ink">Cibles (plateforme + compte connecté)</p>
            <TargetRowsField />
          </div>

          <div className="grid grid-cols-1 gap-4 rounded-2xl border border-ink/5 bg-white p-5 shadow-sm sm:grid-cols-2">
            <div>
              <label htmlFor="firstSlotAt" className="mb-1.5 block text-sm font-medium text-ink">
                Premier créneau (heure du Cameroun)
              </label>
              <input
                id="firstSlotAt"
                type="datetime-local"
                name="firstSlotAt"
                required
                min={minFirstSlot}
                defaultValue={defaultFirstSlot}
                className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="intervalHours" className="mb-1.5 block text-sm font-medium text-ink">
                Intervalle entre publications (heures)
              </label>
              <input
                id="intervalHours"
                type="number"
                name="intervalHours"
                min={1}
                step={1}
                defaultValue={24}
                required
                className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <SubmitButton
            pendingLabel="Création..."
            className="w-fit rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
          >
            Créer la campagne
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
