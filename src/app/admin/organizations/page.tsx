import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import {
  listOrganizationsForAdmin,
  listPlansForAdmin,
  setOrganizationStatus,
  changeOrganizationPlan,
  grantAiCreditsToOrganization,
  configureTenantProviderCredential,
  removeTenantProviderCredential,
} from "@/application/services/admin-organizations-service";
import { getPlatformUsageByOrganization } from "@/application/services/admin-observability-service";
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

const CREDENTIAL_TARGET_OPTIONS = [
  { value: "messaging:zernio", label: "Zernio (messagerie)" },
  { value: "social:zernio", label: "Zernio (réseaux sociaux)" },
  { value: "ai:mistral", label: "Mistral (IA)" },
  { value: "ai:claude", label: "Claude (IA)" },
  { value: "ai:openai", label: "OpenAI (IA)" },
];

/**
 * Lot N, Partie 3 — jamais accessible au commerçant, uniquement Super
 * Admin (voir admin-organizations-service.ts::configureTenantProviderCredential).
 * `target` encode "providerType:providerName" en une seule valeur de
 * <select> — évite un second champ dépendant/cascade côté client pour un
 * formulaire qui reste par ailleurs 100% server-action, sans JS.
 */
async function configureCredentialAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const organizationId = String(formData.get("organizationId") ?? "");
  const [providerType, providerName] = String(formData.get("target") ?? "").split(":");
  const secretValue = String(formData.get("secretValue") ?? "");

  try {
    await configureTenantProviderCredential(organizationId, providerType ?? "", providerName ?? "", secretValue, admin.userId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la configuration du compte dédié";
    redirect(`/admin/organizations?error=${encodeURIComponent(message)}`);
  }
  redirect("/admin/organizations?success=" + encodeURIComponent("Compte dédié configuré."));
}

async function removeCredentialAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const organizationId = String(formData.get("organizationId") ?? "");
  const [providerType, providerName] = String(formData.get("target") ?? "").split(":");

  try {
    await removeTenantProviderCredential(organizationId, providerType ?? "", providerName ?? "", admin.userId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors du retrait du compte dédié";
    redirect(`/admin/organizations?error=${encodeURIComponent(message)}`);
  }
  redirect("/admin/organizations?success=" + encodeURIComponent("Compte dédié retiré — repli sur la clé plateforme."));
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
  searchParams: Promise<{ error?: string; q?: string; status?: string }>;
}) {
  const { error, q, status } = await searchParams;
  await requirePlatformAdmin();
  // Lot H, Partie 3 — étend l'affichage existant sans dupliquer sa logique
  // (compteurs d'usage bruts par entreprise, voir admin-observability-service.ts).
  const [organizations, plans, usage] = await Promise.all([
    listOrganizationsForAdmin(),
    listPlansForAdmin(),
    getPlatformUsageByOrganization(),
  ]);
  const usageByOrg = new Map(usage.map((u) => [u.organizationId, u]));

  // Lot 4 (section 53 du master prompt : "recherche ; filtrage"). Filtre
  // en mémoire côté serveur plutôt qu'un client component avec état JS —
  // même style que le reste de cette console (formulaires GET/POST, zéro
  // JS côté client). N'affecte pas listOrganizationsForAdmin() : reste
  // une vue, pas une nouvelle requête DB paramétrée (le volume actuel
  // d'entreprises ne le justifie pas encore).
  const query = (q ?? "").trim().toLowerCase();
  const statusFilter = status && status !== "all" ? status : null;
  const filteredOrganizations = organizations.filter((org) => {
    const matchesQuery = !query || org.name.toLowerCase().includes(query) || org.slug.toLowerCase().includes(query);
    const matchesStatus = !statusFilter || org.status === statusFilter;
    return matchesQuery && matchesStatus;
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">Entreprises</h1>

      <form className="flex flex-wrap items-end gap-2 rounded-brand border border-ink/10 bg-white p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted" htmlFor="q">
            Recherche
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Nom ou identifiant…"
            className="rounded-brand border border-ink/15 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted" htmlFor="status">
            Statut
          </label>
          <select
            id="status"
            name="status"
            defaultValue={statusFilter ?? "all"}
            className="rounded-brand border border-ink/15 px-3 py-2 text-sm"
          >
            <option value="all">Toutes</option>
            <option value="active">Active</option>
            <option value="suspended">Suspendue</option>
          </select>
        </div>
        <button type="submit" className="rounded-brand bg-ink px-4 py-2 text-sm font-medium text-white">
          Filtrer
        </button>
        {(query || statusFilter) && (
          <a href="/admin/organizations" className="px-2 py-2 text-xs text-muted underline">
            Réinitialiser
          </a>
        )}
      </form>

      {error && (
        <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>
      )}

      <div className="flex flex-col gap-4">
        {filteredOrganizations.length === 0 ? (
          <p className="rounded-brand border border-ink/10 bg-white p-6 text-sm text-muted">
            Aucune entreprise ne correspond à ces critères.
          </p>
        ) : (
          filteredOrganizations.map((org) => (
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

            <p className="mt-1 text-xs text-muted">
              Comptes dédiés (Lot N) :{" "}
              {org.dedicatedCredentials.length > 0 ? (
                <span className="text-ink">
                  {org.dedicatedCredentials
                    .map((c) => CREDENTIAL_TARGET_OPTIONS.find((o) => o.value === c)?.label ?? c)
                    .join(", ")}
                </span>
              ) : (
                "aucun — clé plateforme utilisée"
              )}
            </p>

            {(() => {
              const orgUsage = usageByOrg.get(org.id);
              if (!orgUsage) return null;
              return (
                <p className="mt-1 text-xs text-muted">
                  {orgUsage.productsCount} produit{orgUsage.productsCount !== 1 ? "s" : ""}
                  {" · "}
                  {orgUsage.conversationsCount} conversation{orgUsage.conversationsCount !== 1 ? "s" : ""}
                  {" · "}
                  {orgUsage.whatsappGroupsCount} groupe{orgUsage.whatsappGroupsCount !== 1 ? "s" : ""} WhatsApp
                </p>
              );
            })()}

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

            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-ink/10 pt-3">
              <form action={configureCredentialAction} className="flex flex-wrap items-center gap-1">
                <input type="hidden" name="organizationId" value={org.id} />
                <select name="target" className="rounded-brand border border-ink/15 px-2 py-1 text-xs">
                  {CREDENTIAL_TARGET_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  name="secretValue"
                  type="password"
                  placeholder="Clé API du compte dédié"
                  required
                  className="w-40 rounded-brand border border-ink/15 px-2 py-1 text-xs"
                />
                <button type="submit" className="rounded-brand bg-ink px-3 py-1.5 text-xs font-medium text-white">
                  Configurer un compte dédié
                </button>
              </form>

              {org.dedicatedCredentials.length > 0 && (
                <form action={removeCredentialAction} className="flex items-center gap-1">
                  <input type="hidden" name="organizationId" value={org.id} />
                  <select name="target" className="rounded-brand border border-ink/15 px-2 py-1 text-xs">
                    {org.dedicatedCredentials.map((c) => (
                      <option key={c} value={c}>
                        {CREDENTIAL_TARGET_OPTIONS.find((o) => o.value === c)?.label ?? c}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="rounded-brand bg-clay px-3 py-1.5 text-xs font-medium text-white">
                    Retirer
                  </button>
                </form>
              )}
            </div>
          </div>
        ))
        )}
      </div>
    </div>
  );
}
