import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import {
  getCountryDetailForAdmin,
  setCountryLaunchStatus,
  upsertCountryPrice,
  triggerCountryChannelsSync,
  type CountryLaunchStatus,
} from "@/application/services/admin-countries-service";
import { getCurrencyMeta } from "@/application/services/currency-service";
import { PLAN_KEYS, type PlanKey } from "@/application/services/plans-repository";
import { NotFoundError, AppError } from "@/lib/errors";
import { ConfirmSubmitButton } from "../_components/confirm-submit-button";

const STATUS_LABELS: Record<CountryLaunchStatus, string> = {
  disabled: "Désactivé",
  coming_soon: "Bientôt",
  waitlist: "Liste d'attente",
  active: "Actif",
};

const PLAN_LABELS: Record<PlanKey, string> = { starter: "Starter", business: "Business", pro: "Pro" };

const CONFIRM_MESSAGES: Partial<Record<CountryLaunchStatus, (name: string) => string>> = {
  active: (name) => `Activer ${name} ? Les nouvelles organisations pourront s'inscrire immédiatement.`,
  disabled: (name) =>
    `Désactiver ${name} ? Cela empêchera les nouvelles organisations de ce pays de s'inscrire. Les organisations existantes ne seront PAS supprimées.`,
};

function redirectWithMessage(isoCode: string, kind: "error" | "success", message: string): never {
  redirect(`/admin/countries/${isoCode}?${kind}=${encodeURIComponent(message)}`);
}

async function setStatusAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const isoCode = String(formData.get("isoCode") ?? "");
  const newStatus = String(formData.get("newStatus") ?? "");

  try {
    await setCountryLaunchStatus(isoCode, newStatus, admin.userId);
  } catch (error) {
    redirectWithMessage(isoCode, "error", error instanceof AppError ? error.message : "Erreur lors du changement de statut.");
  }
  redirectWithMessage(isoCode, "success", "Statut mis à jour.");
}

async function upsertPriceAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const isoCode = String(formData.get("isoCode") ?? "");
  const planKey = String(formData.get("planKey") ?? "");
  const amount = Number(formData.get("amount") ?? 0);

  try {
    await upsertCountryPrice(isoCode, planKey, amount, admin.userId);
  } catch (error) {
    redirectWithMessage(isoCode, "error", error instanceof AppError ? error.message : "Erreur lors de la mise à jour du prix.");
  }
  redirectWithMessage(isoCode, "success", `Prix ${planKey} mis à jour.`);
}

async function syncChannelsAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const isoCode = String(formData.get("isoCode") ?? "");

  try {
    const result = await triggerCountryChannelsSync(isoCode, admin.userId);
    if (result.status === "failed") {
      redirectWithMessage(isoCode, "error", `Échec de synchronisation : ${result.errorMessage ?? "erreur inconnue"} — dernier état conservé.`);
    }
    redirectWithMessage(isoCode, "success", `${result.itemsSynced} canal/canaux synchronisés.`);
  } catch (error) {
    redirectWithMessage(isoCode, "error", error instanceof AppError ? error.message : "Erreur lors de la synchronisation.");
  }
}

export default async function AdminCountryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { code } = await params;
  const { error, success } = await searchParams;
  await requirePlatformAdmin();

  let detail;
  try {
    detail = await getCountryDetailForAdmin(code);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const { country, channels, prices } = detail;
  const currency = getCurrencyMeta(country.currencyCode);
  const otherStatuses = (Object.keys(STATUS_LABELS) as CountryLaunchStatus[]).filter((s) => s !== country.launchStatus);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-sm text-slate-500">
          <a href="/admin/countries" className="underline">
            ← Pays
          </a>
        </p>
        <h1 className="font-jakarta text-2xl font-bold tracking-tight">
          {country.name} <span className="text-slate-500">({country.isoCode})</span>
        </h1>
      </div>

      {error && <p className="rounded-xl border border-danger-600/20 bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</p>}
      {success && (
        <p className="rounded-xl border border-success-600/20 bg-success-50 px-4 py-3 text-sm text-success-700">{success}</p>
      )}

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-navy-900/10 bg-white p-4">
          <h2 className="font-jakarta text-sm font-semibold uppercase tracking-wide text-slate-500">Informations</h2>
          <dl className="mt-2 flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Indicatif</dt>
              <dd>{country.phoneCode}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Devise</dt>
              <dd>
                {country.currencyCode} ({currency.symbol})
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Nom local</dt>
              <dd>{country.nativeName ?? "—"}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-navy-900/10 bg-white p-4">
          <h2 className="font-jakarta text-sm font-semibold uppercase tracking-wide text-slate-500">NotchPay</h2>
          <dl className="mt-2 flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Supporté</dt>
              <dd>{country.notchpaySupported ? "Oui" : "Non"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Dernière synchronisation</dt>
              <dd>{country.lastSyncedAt ? new Date(country.lastSyncedAt).toLocaleString("fr-FR") : "Jamais"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Canaux disponibles</dt>
              <dd>{channels.filter((c) => c.isAvailable).length}</dd>
            </div>
          </dl>
          {channels.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1">
              {channels.map((c) => (
                <li
                  key={c.id}
                  className={`rounded-full px-2 py-1 text-xs ${c.isAvailable ? "bg-success-50 text-success-700" : "bg-navy-900/[0.04] text-slate-500 line-through"}`}
                >
                  {c.channelName}
                </li>
              ))}
            </ul>
          )}
          <form action={syncChannelsAction} className="mt-3">
            <input type="hidden" name="isoCode" value={country.isoCode} />
            <button type="submit" className="rounded-xl border border-navy-900/[0.09] px-3 py-1.5 text-xs font-medium">
              Synchroniser les canaux de ce pays
            </button>
          </form>
        </div>
      </section>

      <section className="rounded-xl border border-navy-900/10 bg-white p-4">
        <h2 className="font-jakarta text-sm font-semibold uppercase tracking-wide text-slate-500">SME-OS</h2>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <p>
              Statut actuel : <span className="font-medium">{STATUS_LABELS[country.launchStatus]}</span>
            </p>
            <p className="text-slate-500">
              {country.activatedAt
                ? `Actif depuis le ${new Date(country.activatedAt).toLocaleDateString("fr-FR")}`
                : "Jamais activé"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {otherStatuses.map((targetStatus) => {
              const confirmMessage = CONFIRM_MESSAGES[targetStatus]?.(country.name);
              return (
                <form key={targetStatus} action={setStatusAction}>
                  <input type="hidden" name="isoCode" value={country.isoCode} />
                  <input type="hidden" name="newStatus" value={targetStatus} />
                  {confirmMessage ? (
                    <ConfirmSubmitButton
                      confirmMessage={confirmMessage}
                      className="rounded-xl border border-navy-900/[0.09] px-3 py-1.5 text-xs font-medium"
                    >
                      {STATUS_LABELS[targetStatus]}
                    </ConfirmSubmitButton>
                  ) : (
                    <button type="submit" className="rounded-xl border border-navy-900/[0.09] px-3 py-1.5 text-xs font-medium">
                      {STATUS_LABELS[targetStatus]}
                    </button>
                  )}
                </form>
              );
            })}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="font-jakarta text-lg font-semibold">Tarification</h2>
          <p className="text-sm text-slate-500">
            Prix mensuel par plan pour {country.name}, en {country.currencyCode}. Un changement archive l&apos;ancien
            prix plutôt que de l&apos;écraser (historique conservé).
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {PLAN_KEYS.map((planKey) => {
            const price = prices.find((p) => p.key === planKey);
            return (
              <form
                key={planKey}
                action={upsertPriceAction}
                className="flex flex-col gap-2 rounded-xl border border-navy-900/10 bg-white p-4"
              >
                <input type="hidden" name="isoCode" value={country.isoCode} />
                <input type="hidden" name="planKey" value={planKey} />
                <span className="text-xs uppercase tracking-wide text-slate-500">{PLAN_LABELS[planKey]}</span>
                <label className="flex flex-col gap-1 text-xs text-slate-500">
                  Prix mensuel ({country.currencyCode})
                  <input
                    name="amount"
                    type="number"
                    min={0}
                    step={currency.decimalDigits > 0 ? "0.01" : "1"}
                    defaultValue={price ? price.amount / 10 ** currency.decimalDigits : 0}
                    required
                    className="rounded-xl border border-navy-900/[0.09] px-3 py-2 text-sm text-navy-900"
                  />
                </label>
                {price?.source === "fallback_default" && (
                  <p className="text-xs text-warning-700">Prix par défaut (non configuré explicitement pour ce pays).</p>
                )}
                <button type="submit" className="mt-1 rounded-xl bg-violet-600 px-3 py-2 text-sm font-medium text-white">
                  Enregistrer
                </button>
              </form>
            );
          })}
        </div>
      </section>
    </div>
  );
}
