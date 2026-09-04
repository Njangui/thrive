import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import {
  getPlansOverviewForAdmin,
  updatePlanDetails,
  upsertPlanEntitlementLimit,
} from "@/application/services/admin-plans-service";
import { PLAN_KEYS, type PlanKey } from "@/application/services/plans-repository";
import { AppError } from "@/lib/errors";

async function updatePlanDetailsAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const planKey = String(formData.get("planKey") ?? "");

  try {
    await updatePlanDetails(
      planKey,
      {
        name: String(formData.get("name") ?? ""),
        priceFcfa: Number(formData.get("priceFcfa") ?? 0),
        description: String(formData.get("description") ?? ""),
      },
      admin.userId,
    );
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la mise à jour du plan";
    redirect(`/admin/plans?error=${encodeURIComponent(message)}`);
  }
  redirect("/admin/plans?success=" + encodeURIComponent("Plan mis à jour."));
}

/**
 * Une ligne de la grille = une clé d'entitlement × les 3 plans à la
 * fois, pour rester utilisable en un seul clic (voir le commentaire de
 * admin-plans-service.ts sur le choix d'un upsert par cellule pour
 * l'audit log). Les 3 upserts (un par plan) ciblent chacun une ligne
 * `(plan_key, entitlement_key)` distincte — aucune dépendance entre eux
 * — donc lancés en parallèle plutôt qu'en boucle séquentielle.
 */
async function updateEntitlementRowAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const entitlementKey = String(formData.get("entitlementKey") ?? "");

  try {
    await Promise.all(
      PLAN_KEYS.filter((planKey) => formData.get(`limit_${planKey}`) !== null).map((planKey) =>
        upsertPlanEntitlementLimit(planKey, entitlementKey, Number(formData.get(`limit_${planKey}`)), admin.userId),
      ),
    );
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la mise à jour de la grille";
    redirect(`/admin/plans?error=${encodeURIComponent(message)}`);
  }
  redirect("/admin/plans?success=" + encodeURIComponent("Grille mise à jour."));
}

const PLAN_LABELS: Record<PlanKey, string> = { starter: "Starter", business: "Business", pro: "Pro" };

export default async function AdminPlansPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  await requirePlatformAdmin();
  const overview = await getPlansOverviewForAdmin();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Plans</h1>
        <p className="mt-1 text-sm text-muted">
          Prix, description et grille de limites des 3 plans commerciaux. Ces valeurs alimentent directement le
          dashboard entreprise et le moteur d&apos;entitlements — aucune limite n&apos;est codée en dur ailleurs.
        </p>
      </div>

      {error && <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>}
      {success && (
        <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">{success}</p>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-semibold">Tarification</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {overview.plans.map((plan) => (
            <form
              key={plan.key}
              action={updatePlanDetailsAction}
              className="flex flex-col gap-2 rounded-brand border border-ink/10 bg-white p-4"
            >
              <input type="hidden" name="planKey" value={plan.key} />
              <span className="text-xs uppercase tracking-wide text-muted">{PLAN_LABELS[plan.key]}</span>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Nom affiché
                <input
                  name="name"
                  defaultValue={plan.name}
                  required
                  className="rounded-brand border border-ink/15 px-3 py-2 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Prix mensuel (FCFA)
                <input
                  name="priceFcfa"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={plan.priceFcfa}
                  required
                  className="rounded-brand border border-ink/15 px-3 py-2 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Description
                <textarea
                  name="description"
                  defaultValue={plan.description ?? ""}
                  rows={2}
                  className="rounded-brand border border-ink/15 px-3 py-2 text-sm text-ink"
                />
              </label>
              <button type="submit" className="mt-1 rounded-brand bg-ink px-3 py-2 text-sm font-medium text-white">
                Enregistrer
              </button>
            </form>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold">Grille des limites</h2>
          <p className="text-sm text-muted">
            Jauges d&apos;usage (nombre, -1 = illimité) et fonctionnalités (0 = désactivée, 1 = activée).
          </p>
        </div>
        <div className="overflow-x-auto rounded-brand border border-ink/10 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-2">Clé</th>
                {PLAN_KEYS.map((planKey) => (
                  <th key={planKey} className="px-4 py-2">
                    {PLAN_LABELS[planKey]}
                  </th>
                ))}
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {overview.entitlements.map((entry) => (
                <tr key={entry.key} className="border-b border-ink/5 last:border-0">
                  <td colSpan={PLAN_KEYS.length + 2} className="p-0">
                    <form
                      action={updateEntitlementRowAction}
                      className="grid items-center gap-2 px-4 py-2"
                      style={{ gridTemplateColumns: `2fr repeat(${PLAN_KEYS.length}, 1fr) auto` }}
                    >
                      <input type="hidden" name="entitlementKey" value={entry.key} />
                      <span>{entry.label}</span>
                      {PLAN_KEYS.map((planKey) => (
                        <input
                          key={planKey}
                          name={`limit_${planKey}`}
                          type="number"
                          min={-1}
                          step={1}
                          defaultValue={entry.limitsByPlan[planKey]}
                          className="w-full rounded-brand border border-ink/15 px-2 py-1 text-sm"
                        />
                      ))}
                      <button type="submit" className="rounded-brand border border-ink/15 px-2 py-1 text-xs">
                        Enregistrer
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold">Bonus numéro dédié</h2>
          <p className="text-sm text-muted">
            Groupes WhatsApp additionnels débloqués quand un numéro est assigné à l&apos;entreprise depuis{" "}
            <span className="font-medium">/admin/numbers</span>. 0 = pas de bonus pour ce plan.
          </p>
        </div>
        <div className="overflow-x-auto rounded-brand border border-ink/10 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-2">Clé</th>
                {PLAN_KEYS.map((planKey) => (
                  <th key={planKey} className="px-4 py-2">
                    {PLAN_LABELS[planKey]}
                  </th>
                ))}
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {overview.dedicatedBonuses.map((entry) => (
                <tr key={entry.key} className="border-b border-ink/5 last:border-0">
                  <td colSpan={PLAN_KEYS.length + 2} className="p-0">
                    <form
                      action={updateEntitlementRowAction}
                      className="grid items-center gap-2 px-4 py-2"
                      style={{ gridTemplateColumns: `2fr repeat(${PLAN_KEYS.length}, 1fr) auto` }}
                    >
                      <input type="hidden" name="entitlementKey" value={entry.key} />
                      <span>{entry.label}</span>
                      {PLAN_KEYS.map((planKey) => (
                        <input
                          key={planKey}
                          name={`limit_${planKey}`}
                          type="number"
                          min={0}
                          step={1}
                          defaultValue={entry.limitsByPlan[planKey]}
                          className="w-full rounded-brand border border-ink/15 px-2 py-1 text-sm"
                        />
                      ))}
                      <button type="submit" className="rounded-brand border border-ink/15 px-2 py-1 text-xs">
                        Enregistrer
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
