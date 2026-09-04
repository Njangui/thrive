import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCurrentOrganization, requireMembership } from "@/application/services/auth-service";
import { listActiveProductsForStorefront } from "@/application/services/catalog-service";
import {
  listConnectedGroups,
  listAvailableGroupsFromZernio,
  listBroadcasts,
  connectGroups,
  disconnectGroup,
  syncGroupsFromZernio,
  createBroadcast,
  cancelBroadcast,
  retryFailedTargets,
} from "@/application/services/whatsapp-group-service";
import { AppError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";

/**
 * Lot F — Groupes WhatsApp & diffusion groupée. Lot M — ferme la boucle :
 * un groupe fraîchement connecté est "en attente d'activation" tant
 * qu'aucun message n'a été reçu depuis lui (voir docs/ZERNIO_INTEGRATION.md,
 * "Groupes WhatsApp" — conversationId Zernio == id du groupe, mais la
 * conversation elle-même n'existe pas tant que personne n'a écrit dedans).
 * `createBroadcast` (whatsapp-group-service.ts) refuse maintenant À LA
 * CRÉATION toute diffusion vers un groupe encore en attente — jamais un
 * échec silencieux découvert après coup.
 */

const GROUP_STATUS_LABELS: Record<string, string> = {
  connected: "Connecté",
  disconnected: "Déconnecté",
  error: "Erreur",
};

const BROADCAST_STATUS_LABELS: Record<string, string> = {
  scheduled: "Programmée",
  processing: "En cours",
  completed: "Terminée",
  failed: "Échouée",
  cancelled: "Annulée",
};

const BROADCAST_STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-ink/10 text-ink",
  processing: "bg-amber-500/10 text-amber-600",
  completed: "bg-leaf/10 text-leaf",
  failed: "bg-clay/10 text-clay",
  cancelled: "bg-ink/10 text-muted",
};

/** Diffusions ciblées sur une PME unique — l'Afrique/Douala (UTC+1, jamais d'heure d'été) est la seule zone pertinente pour ce marché (voir docs/ZERNIO_INTEGRATION.md). Simplification V1 assumée et documentée plutôt que devinée en silence. */
const CAMEROON_UTC_OFFSET = "+01:00";

function cameroonLocalToUtcIso(datetimeLocalValue: string): string {
  return new Date(`${datetimeLocalValue}:00${CAMEROON_UTC_OFFSET}`).toISOString();
}

function nowInCameroonAsDatetimeLocal(minutesFromNow = 60): string {
  const shifted = new Date(Date.now() + 60 * 60 * 1000 + minutesFromNow * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

function flashRedirect(kind: "success" | "error", message: string): never {
  redirect(`/dashboard/groups?${kind}=${encodeURIComponent(message)}`);
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

async function syncGroupsAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  const result = await syncGroupsFromZernio(organizationId);
  if (result.error) {
    flashRedirect("error", `Synchronisation impossible : ${result.error}`);
  }
  const extra = result.markedError > 0 ? `, ${result.markedError} introuvable(s) côté WhatsApp` : "";
  flashRedirect("success", `Synchronisation terminée : ${result.refreshed} groupe(s) à jour${extra}.`);
}

async function connectGroupsAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin", "manager"]);

  const selectedIds = formData.getAll("selectedExternalId").map(String);
  if (selectedIds.length === 0) {
    flashRedirect("error", "Sélectionnez au moins un groupe à connecter.");
  }
  const candidates = selectedIds.map((externalId) => ({
    externalId,
    name: String(formData.get(`groupName:${externalId}`) ?? externalId),
  }));

  try {
    const result = await connectGroups(organizationId, candidates, membership.userId);
    const parts: string[] = [];
    if (result.connected.length > 0) parts.push(`${result.connected.length} groupe(s) connecté(s)`);
    if (result.skipped.length > 0) parts.push(`${result.skipped.length} déjà connecté(s)`);
    flashRedirect("success", parts.join(", ") || "Aucun changement.");
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la connexion des groupes.";
    flashRedirect("error", message);
  }
}

async function disconnectGroupAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const groupId = String(formData.get("groupId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    await disconnectGroup(organizationId, groupId, membership.userId);
    flashRedirect("success", "Groupe déconnecté.");
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la déconnexion du groupe.";
    flashRedirect("error", message);
  }
}

async function createBroadcastAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin", "manager"]);

  const productIds = formData.getAll("productIds").map(String);
  const groupIds = formData.getAll("groupIds").map(String);
  const scheduledAtLocal = String(formData.get("scheduledAt") ?? "");

  try {
    if (!scheduledAtLocal) throw new AppError("Choisissez une date et une heure de diffusion.", 400, "validation");
    const scheduledAtIso = cameroonLocalToUtcIso(scheduledAtLocal);
    const result = await createBroadcast(organizationId, productIds, groupIds, scheduledAtIso, membership.userId);
    flashRedirect(
      "success",
      `Diffusion programmée : ${result.productCount} produit(s) vers ${result.targetCount} groupe(s).`,
    );
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la programmation de la diffusion.";
    flashRedirect("error", message);
  }
}

async function cancelBroadcastAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const broadcastId = String(formData.get("broadcastId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    await cancelBroadcast(organizationId, broadcastId, membership.userId);
    flashRedirect("success", "Diffusion annulée.");
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'annulation.";
    flashRedirect("error", message);
  }
}

async function retryBroadcastAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const broadcastId = String(formData.get("broadcastId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    const result = await retryFailedTargets(organizationId, broadcastId, membership.userId);
    flashRedirect(
      "success",
      result.retried > 0 ? `${result.retried} groupe(s) en échec relancé(s).` : "Aucune cible en échec à relancer.",
    );
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la relance.";
    flashRedirect("error", message);
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();

  const [connectedGroups, available, broadcasts, products] = await Promise.all([
    listConnectedGroups(organizationId),
    listAvailableGroupsFromZernio(organizationId),
    listBroadcasts(organizationId),
    listActiveProductsForStorefront(organizationId),
  ]);

  const sendableConnectedGroups = connectedGroups.filter((g) => g.status === "connected");
  const connectableAvailable = available.groups.filter((g) => !g.alreadyConnected);
  const defaultScheduledAt = nowInCameroonAsDatetimeLocal();
  const minScheduledAt = nowInCameroonAsDatetimeLocal(5);
  // Lot M — file d'attente d'activation : groupes connectés côté SME-OS
  // mais dont aucun message n'a encore été reçu (voir en-tête de fichier).
  const pendingActivationGroups = connectedGroups.filter((g) => g.status === "connected" && !g.isSendable);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Groupes WhatsApp</h1>
        <p className="mt-1 text-sm text-muted">
          Connectez vos groupes WhatsApp et programmez la diffusion de vos produits.
        </p>
      </div>

      {error && <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>}
      {success && (
        <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">{success}</p>
      )}

      {/* Groupes connectés */}
      <section className="flex flex-col gap-3 rounded-brand border border-ink/10 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Groupes connectés</h2>
          <form action={syncGroupsAction}>
            <input type="hidden" name="organizationId" value={organizationId} />
            <SubmitButton
              pendingLabel="Synchronisation..."
              className="rounded-brand border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink hover:bg-ink/5 disabled:opacity-60"
            >
              Synchroniser
            </SubmitButton>
          </form>
        </div>

        {connectedGroups.length === 0 ? (
          <p className="text-sm text-muted">Aucun groupe connecté pour l&apos;instant.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-2 py-2">Groupe</th>
                <th className="px-2 py-2">Participants</th>
                <th className="px-2 py-2">Statut</th>
                <th className="px-2 py-2">Activation</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {connectedGroups.map((g) => (
                <tr key={g.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-2 py-2">{g.name}</td>
                  <td className="px-2 py-2 text-muted">{g.participantCount ?? "—"}</td>
                  <td className="px-2 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        g.status === "connected" ? "bg-leaf/10 text-leaf" : "bg-clay/10 text-clay"
                      }`}
                    >
                      {GROUP_STATUS_LABELS[g.status] ?? g.status}
                    </span>
                  </td>
                  <td
                    className="px-2 py-2"
                    title="Une diffusion ne peut atteindre ce groupe que si Zernio a déjà une conversation active avec lui (voir docs/ZERNIO_INTEGRATION.md)."
                  >
                    {g.isSendable ? (
                      <span className="rounded-full bg-leaf/10 px-2 py-0.5 text-xs text-leaf">Prêt</span>
                    ) : (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600">
                        En attente d&apos;activation
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <form action={disconnectGroupAction}>
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="groupId" value={g.id} />
                      <SubmitButton
                        pendingLabel="..."
                        className="text-xs font-medium text-clay hover:underline disabled:opacity-60"
                      >
                        Déconnecter
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {pendingActivationGroups.length > 0 && (
          <div className="flex flex-col gap-3 rounded-brand border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
            <div>
              <p className="font-medium text-amber-700">
                {pendingActivationGroups.length > 1
                  ? `${pendingActivationGroups.length} groupes en attente d'activation`
                  : "1 groupe en attente d'activation"}{" "}
                : {pendingActivationGroups.map((g) => g.name).join(", ")}
              </p>
              <p className="mt-1 text-amber-700/90">
                Envoyez n&apos;importe quel message dans ce groupe WhatsApp depuis votre téléphone (une seule
                fois) pour l&apos;activer — vos futures diffusions fonctionneront automatiquement après.
              </p>
            </div>
            <form action={syncGroupsAction}>
              <input type="hidden" name="organizationId" value={organizationId} />
              <SubmitButton
                pendingLabel="Vérification..."
                className="w-fit rounded-brand border border-amber-600/40 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-500/10 disabled:opacity-60"
              >
                Vérifier maintenant
              </SubmitButton>
            </form>
          </div>
        )}
      </section>
      <section className="flex flex-col gap-3 rounded-brand border border-ink/10 bg-white p-4">
        <h2 className="font-display text-lg font-semibold">Connecter un groupe</h2>

        {available.error ? (
          <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">
            {available.error}
          </p>
        ) : connectableAvailable.length === 0 ? (
          <p className="text-sm text-muted">
            Aucun nouveau groupe WhatsApp détecté. Les groupes doivent déjà exister sur votre WhatsApp Business.
          </p>
        ) : (
          <form action={connectGroupsAction} className="flex flex-col gap-3">
            <input type="hidden" name="organizationId" value={organizationId} />
            <div className="flex flex-col gap-1">
              {connectableAvailable.map((g) => (
                <label key={g.externalId} className="flex items-center gap-2 rounded-brand border border-ink/10 px-3 py-2 text-sm">
                  <input type="checkbox" name="selectedExternalId" value={g.externalId} className="h-4 w-4" />
                  <input type="hidden" name={`groupName:${g.externalId}`} value={g.name} />
                  {g.name}
                </label>
              ))}
            </div>
            <SubmitButton
              pendingLabel="Connexion..."
              className="w-fit rounded-brand bg-leaf px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Connecter la sélection
            </SubmitButton>
          </form>
        )}
      </section>

      {/* Programmer une diffusion */}
      <section className="flex flex-col gap-3 rounded-brand border border-ink/10 bg-white p-4">
        <h2 className="font-display text-lg font-semibold">Programmer une diffusion</h2>

        {sendableConnectedGroups.length === 0 ? (
          <p className="text-sm text-muted">Connectez au moins un groupe pour pouvoir programmer une diffusion.</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-muted">
            Ajoutez au moins un produit actif à votre catalogue pour pouvoir le diffuser.
          </p>
        ) : (
          <form action={createBroadcastAction} className="flex flex-col gap-4">
            <input type="hidden" name="organizationId" value={organizationId} />

            <div>
              <p className="mb-2 text-xs font-medium uppercase text-muted">Produits à diffuser</p>
              <div className="flex flex-col gap-1">
                {products.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 rounded-brand border border-ink/10 px-3 py-2 text-sm">
                    <input type="checkbox" name="productIds" value={p.id} className="h-4 w-4" />
                    {p.name} — {p.unitPrice.toLocaleString("fr-FR")} FCFA
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium uppercase text-muted">Groupes ciblés</p>
              <div className="flex flex-col gap-1">
                {sendableConnectedGroups.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 rounded-brand border border-ink/10 px-3 py-2 text-sm">
                    <input type="checkbox" name="groupIds" value={g.id} className="h-4 w-4" />
                    {g.name}
                    {!g.isSendable && (
                      <span className="text-xs text-muted">(pas encore diffusable — voir colonne ci-dessus)</span>
                    )}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted" htmlFor="scheduledAt">
                Date et heure (heure du Cameroun)
              </label>
              <input
                id="scheduledAt"
                type="datetime-local"
                name="scheduledAt"
                required
                min={minScheduledAt}
                defaultValue={defaultScheduledAt}
                className="rounded-brand border border-ink/15 px-3 py-2 text-sm"
              />
            </div>

            <SubmitButton
              pendingLabel="Programmation..."
              className="w-fit rounded-brand bg-leaf px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Programmer la diffusion
            </SubmitButton>
          </form>
        )}
      </section>

      {/* Historique */}
      <section className="flex flex-col gap-3 rounded-brand border border-ink/10 bg-white p-4">
        <h2 className="font-display text-lg font-semibold">Historique des diffusions</h2>

        {broadcasts.length === 0 ? (
          <p className="text-sm text-muted">Aucune diffusion pour l&apos;instant.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-2 py-2">Programmée pour</th>
                <th className="px-2 py-2">Statut</th>
                <th className="px-2 py-2">Produits</th>
                <th className="px-2 py-2">Groupes</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {broadcasts.map((b) => (
                <tr key={b.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-2 py-2 text-muted">{new Date(b.scheduledAt).toLocaleString("fr-FR")}</td>
                  <td className="px-2 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${BROADCAST_STATUS_STYLES[b.status] ?? "bg-ink/10 text-ink"}`}>
                      {BROADCAST_STATUS_LABELS[b.status] ?? b.status}
                    </span>
                  </td>
                  <td className="px-2 py-2">{b.productCount}</td>
                  <td className="px-2 py-2">
                    {b.sentCount}/{b.targetCount} envoyé(s)
                    {b.failedCount > 0 && <span className="text-clay"> · {b.failedCount} échec(s)</span>}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link href={`/dashboard/groups/broadcasts/${b.id}`} className="text-xs font-medium text-leaf hover:underline">
                        Détail
                      </Link>
                      {b.status === "scheduled" && (
                        <form action={cancelBroadcastAction}>
                          <input type="hidden" name="organizationId" value={organizationId} />
                          <input type="hidden" name="broadcastId" value={b.id} />
                          <SubmitButton pendingLabel="..." className="text-xs font-medium text-clay hover:underline disabled:opacity-60">
                            Annuler
                          </SubmitButton>
                        </form>
                      )}
                      {(b.status === "completed" || b.status === "failed") && b.failedCount > 0 && (
                        <form action={retryBroadcastAction}>
                          <input type="hidden" name="organizationId" value={organizationId} />
                          <input type="hidden" name="broadcastId" value={b.id} />
                          <SubmitButton pendingLabel="..." className="text-xs font-medium text-ink hover:underline disabled:opacity-60">
                            Relancer les échecs
                          </SubmitButton>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
