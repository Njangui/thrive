import { redirect } from "next/navigation";
import Link from "next/link";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import {
  getCountriesOverviewForAdmin,
  setCountryLaunchStatus,
  triggerManualSync,
} from "@/application/services/admin-countries-service";
import { getCurrencyMeta } from "@/application/services/currency-service";
import { AppError } from "@/lib/errors";
import { ConfirmSubmitButton } from "./_components/confirm-submit-button";
import type { CountryLaunchStatus } from "@/application/services/admin-countries-service";

const STATUS_LABELS: Record<CountryLaunchStatus, string> = {
  disabled: "Désactivé",
  coming_soon: "Bientôt",
  waitlist: "Liste d'attente",
  active: "Actif",
};

const STATUS_STYLES: Record<CountryLaunchStatus, string> = {
  disabled: "bg-navy-900/[0.04] text-slate-500",
  coming_soon: "bg-warning-50 text-warning-700",
  waitlist: "bg-violet-50 text-violet-700",
  active: "bg-success-50 text-success-700",
};

async function setStatusAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const isoCode = String(formData.get("isoCode") ?? "");
  const newStatus = String(formData.get("newStatus") ?? "");

  try {
    await setCountryLaunchStatus(isoCode, newStatus, admin.userId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors du changement de statut.";
    redirect(`/admin/countries?error=${encodeURIComponent(message)}`);
  }
  redirect(`/admin/countries?success=${encodeURIComponent(`${isoCode} : statut mis à jour.`)}`);
}

async function syncNotchPayAction() {
  "use server";
  const admin = await requirePlatformAdmin();

  try {
    const result = await triggerManualSync(admin.userId);
    const summary =
      result.countries.status === "success"
        ? `Synchronisation réussie (${result.countries.itemsSynced} pays, ${result.channels.length} pays synchronisés pour les canaux).`
        : `Échec de synchronisation : ${result.countries.errorMessage ?? "erreur inconnue"} — dernier état connu conservé.`;
    redirect(`/admin/countries?${result.countries.status === "success" ? "success" : "error"}=${encodeURIComponent(summary)}`);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la synchronisation NotchPay.";
    redirect(`/admin/countries?error=${encodeURIComponent(message)}`);
  }
}

export default async function AdminCountriesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  await requirePlatformAdmin();
  const overview = await getCountriesOverviewForAdmin();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-jakarta text-2xl font-bold tracking-tight">Pays</h1>
        <p className="mt-1 text-sm text-slate-500">
          Contrôle de la disponibilité commerciale de SME-OS par pays. NotchPay indique ce qui est techniquement
          possible ; ce tableau décide ce qui est réellement vendu — les deux ne sont jamais automatiquement liés.
        </p>
      </div>

      {error && <p className="rounded-xl border border-danger-600/20 bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</p>}
      {success && (
        <p className="rounded-xl border border-success-600/20 bg-success-50 px-4 py-3 text-sm text-success-700">{success}</p>
      )}

      <section className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-navy-900/10 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Supportés NotchPay</p>
          <p className="mt-1 font-jakarta text-2xl font-bold">{overview.kpis.notchpaySupportedCount}</p>
        </div>
        <div className="rounded-xl border border-navy-900/10 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Actifs SME-OS</p>
          <p className="mt-1 font-jakarta text-2xl font-bold text-success-700">{overview.kpis.activeCount}</p>
        </div>
        <div className="rounded-xl border border-navy-900/10 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Bientôt</p>
          <p className="mt-1 font-jakarta text-2xl font-bold">{overview.kpis.comingSoonCount}</p>
        </div>
        <div className="rounded-xl border border-navy-900/10 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Liste d&apos;attente</p>
          <p className="mt-1 font-jakarta text-2xl font-bold">{overview.kpis.waitlistCount}</p>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-navy-900/10 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <p className="font-medium">
            {overview.syncStatus.isHealthy ? "✓ Synchronisé" : "⚠ Dernière tentative en échec"}
          </p>
          <p className="text-slate-500">
            {overview.syncStatus.lastSuccessfulSyncAt
              ? `Dernière synchronisation réussie : ${new Date(overview.syncStatus.lastSuccessfulSyncAt).toLocaleString("fr-FR")}`
              : "Aucune synchronisation réussie pour le moment."}
          </p>
          {!overview.syncStatus.isHealthy && overview.syncStatus.lastError && (
            <p className="text-danger-700">Erreur : {overview.syncStatus.lastError}</p>
          )}
        </div>
        <form action={syncNotchPayAction}>
          <button type="submit" className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white">
            Synchroniser NotchPay
          </button>
        </form>
      </section>

      <section className="overflow-x-auto rounded-xl border border-navy-900/10 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-navy-900/10 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Pays</th>
              <th className="px-4 py-2">Devise</th>
              <th className="px-4 py-2">NotchPay</th>
              <th className="px-4 py-2">SME-OS</th>
              <th className="px-4 py-2">Canaux</th>
              <th className="px-4 py-2">Pricing</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {overview.countries.map((country) => {
              const currency = getCurrencyMeta(country.currencyCode);
              return (
                <tr key={country.isoCode} className="border-b border-navy-900/[0.05] last:border-0">
                  <td className="px-4 py-2 font-medium">
                    {country.name} <span className="text-slate-500">({country.isoCode})</span>
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {country.currencyCode} ({currency.symbol})
                  </td>
                  <td className="px-4 py-2">{country.notchpaySupported ? "✓" : "—"}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[country.launchStatus]}`}>
                      {STATUS_LABELS[country.launchStatus]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-500">{country.availableChannelCount}</td>
                  <td className="px-4 py-2 text-slate-500">{country.hasCompletePricing ? "✓ complet" : "à configurer"}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/countries/${country.isoCode}`} className="text-xs font-medium text-navy-900 underline">
                        Configurer
                      </Link>
                      {country.launchStatus !== "active" && (
                        <form action={setStatusAction}>
                          <input type="hidden" name="isoCode" value={country.isoCode} />
                          <input type="hidden" name="newStatus" value="active" />
                          <ConfirmSubmitButton
                            confirmMessage={`Activer ${country.name} ? Les nouvelles organisations pourront s'inscrire immédiatement.`}
                            className="rounded-xl border border-success-600/20 px-2 py-1 text-xs text-success-700"
                          >
                            Activer
                          </ConfirmSubmitButton>
                        </form>
                      )}
                      {country.launchStatus === "active" && (
                        <form action={setStatusAction}>
                          <input type="hidden" name="isoCode" value={country.isoCode} />
                          <input type="hidden" name="newStatus" value="disabled" />
                          <ConfirmSubmitButton
                            confirmMessage={`Désactiver ${country.name} ? Cela empêchera les nouvelles organisations de ce pays de s'inscrire. Les organisations existantes ne seront PAS supprimées.`}
                            className="rounded-xl border border-danger-600/20 px-2 py-1 text-xs text-danger-700"
                          >
                            Désactiver
                          </ConfirmSubmitButton>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
