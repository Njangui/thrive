import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { writeAdminAuditLog } from "./admin-organizations-service";
import {
  getCountries,
  getCountry,
  getChannels,
  syncAllResources,
  syncChannels,
  getSyncStatus,
  type CountryRecord,
  type PaymentChannelRecord,
  type SyncResult,
  type SyncStatusSummary,
} from "./notchpay-resources-service";
import { listPlanPricesForCountry, PLAN_KEYS, type PlanKey, type ResolvedPlanPrice, type PlanSummary } from "./plans-repository";
import { normalizeMoney, validateMoney } from "./currency-service";

/**
 * Country Engine — Super Admin (section 18/19/29/51/52 du master
 * prompt). AUCUNE fonction ici ne vérifie elle-même les droits
 * d'accès : `requirePlatformAdmin()` est TOUJOURS appelé par la
 * page/Server Action appelante AVANT d'invoquer ce service (même
 * convention que admin-plans-service.ts/admin-organizations-service.ts)
 * — ce fichier fait confiance à son appelant, il ne fait pas de RBAC
 * lui-même. `actorUserId` provient de `requirePlatformAdmin().userId`.
 */

export type CountryLaunchStatus = CountryRecord["launchStatus"];

const LAUNCH_STATUSES: readonly CountryLaunchStatus[] = ["disabled", "coming_soon", "waitlist", "active"];

function isLaunchStatus(value: string): value is CountryLaunchStatus {
  return (LAUNCH_STATUSES as readonly string[]).includes(value);
}

function isPlanKey(value: string): value is PlanKey {
  return (PLAN_KEYS as readonly string[]).includes(value);
}

export interface AdminCountriesOverview {
  countries: Array<CountryRecord & { availableChannelCount: number; hasCompletePricing: boolean }>;
  kpis: {
    notchpaySupportedCount: number;
    activeCount: number;
    comingSoonCount: number;
    waitlistCount: number;
    disabledCount: number;
  };
  syncStatus: SyncStatusSummary;
}

/** Vue `/admin/countries` (section 18/67) : tableau + KPIs + état de la dernière synchronisation. */
export async function getCountriesOverviewForAdmin(): Promise<AdminCountriesOverview> {
  const [countries, syncStatus] = await Promise.all([getCountries(), getSyncStatus("countries")]);

  const countriesWithDetails = await Promise.all(
    countries.map(async (country) => {
      const [channels, prices] = await Promise.all([
        getChannels(country.isoCode),
        listPlanPricesForCountry(country.isoCode),
      ]);
      return {
        ...country,
        availableChannelCount: channels.filter((c) => c.isAvailable).length,
        // "Complète" = les 3 plans ont un prix EXPLICITEMENT configuré pour
        // ce pays (pas le repli plan.priceFcfa) — voir assertActivationReadiness.
        hasCompletePricing: prices.every((p) => p.source === "country_specific"),
      };
    }),
  );

  return {
    countries: countriesWithDetails,
    kpis: {
      notchpaySupportedCount: countries.filter((c) => c.notchpaySupported).length,
      activeCount: countries.filter((c) => c.launchStatus === "active").length,
      comingSoonCount: countries.filter((c) => c.launchStatus === "coming_soon").length,
      waitlistCount: countries.filter((c) => c.launchStatus === "waitlist").length,
      disabledCount: countries.filter((c) => c.launchStatus === "disabled").length,
    },
    syncStatus,
  };
}

export interface AdminCountryDetail {
  country: CountryRecord;
  channels: PaymentChannelRecord[];
  prices: Array<PlanSummary & ResolvedPlanPrice>;
}

/** Vue `/admin/countries/[code]` (section 19). */
export async function getCountryDetailForAdmin(isoCode: string): Promise<AdminCountryDetail> {
  const country = await getCountry(isoCode);
  if (!country) throw new NotFoundError(`Pays introuvable : "${isoCode}".`);

  const [channels, prices] = await Promise.all([
    getChannels(country.isoCode),
    listPlanPricesForCountry(country.isoCode),
  ]);

  return { country, channels, prices };
}

/**
 * Checklist d'activation (section 51/52) — appliquée UNIQUEMENT lors
 * d'une transition VERS 'active' (jamais lors d'un changement vers un
 * autre statut, ni lorsqu'un pays est DÉJÀ actif : un Super Admin doit
 * pouvoir corriger un prix sur un pays déjà actif sans redéclencher la
 * checklist). Le repli `plan.priceFcfa` de resolvePlanPriceForCountry
 * (plans-repository.ts) reste un filet de sécurité pour la continuité
 * d'un pays DÉJÀ actif — mais activer un NOUVEAU pays exige une
 * configuration explicite, jamais silencieuse (section 51 : "pas
 * possible d'activer un pays sans prix de plan valide").
 */
async function assertActivationReadiness(country: CountryRecord): Promise<void> {
  const problems: string[] = [];

  if (!country.notchpaySupported) {
    problems.push("NotchPay ne supporte pas (encore) ce pays — synchronisez d'abord.");
  }

  const channels = await getChannels(country.isoCode);
  if (!channels.some((c) => c.isAvailable)) {
    problems.push("Aucun canal de paiement disponible pour ce pays.");
  }

  const prices = await listPlanPricesForCountry(country.isoCode);
  const missingPlans = prices.filter((p) => p.source === "fallback_default").map((p) => p.key);
  if (missingPlans.length > 0) {
    problems.push(`Prix non configurés pour : ${missingPlans.join(", ")}.`);
  }

  if (problems.length > 0) {
    throw new ValidationError(`Impossible d'activer ${country.name} — ${problems.join(" ")}`);
  }
}

/**
 * Change le statut commercial d'un pays (section 6/20/21). Toute
 * transition est auditée. La désactivation ne touche JAMAIS aux
 * organisations existantes (section 21) — cette fonction ne modifie
 * QUE la table `countries`.
 */
export async function setCountryLaunchStatus(
  isoCode: string,
  newStatus: string,
  actorUserId: string,
): Promise<void> {
  if (!isLaunchStatus(newStatus)) {
    throw new ValidationError(`Statut invalide : "${newStatus}" (attendu : ${LAUNCH_STATUSES.join(", ")}).`);
  }

  const country = await getCountry(isoCode);
  if (!country) throw new NotFoundError(`Pays introuvable : "${isoCode}".`);

  if (newStatus === "active" && country.launchStatus !== "active") {
    await assertActivationReadiness(country);
  }

  const supabase = getSupabaseServiceClient();
  const activatedAt = newStatus === "active" ? new Date().toISOString() : country.activatedAt;

  const { error } = await supabase
    .from("countries")
    .update({ launch_status: newStatus, activated_at: activatedAt })
    .eq("iso_code", country.isoCode);

  if (error) throw new Error(`Erreur mise à jour du statut du pays : ${error.message}`);

  const action = newStatus === "active" ? "COUNTRY_ENABLED" : newStatus === "disabled" ? "COUNTRY_DISABLED" : "COUNTRY_STATUS_CHANGED";

  await writeAdminAuditLog({
    actorUserId,
    organizationId: null,
    entityId: country.id,
    action,
    entityType: "country",
    beforeState: { isoCode: country.isoCode, launchStatus: country.launchStatus },
    afterState: { isoCode: country.isoCode, launchStatus: newStatus },
  });
}

/**
 * Configure le prix d'un plan pour un pays (section 17/29). Historise
 * l'ancien prix (`is_active=false`) plutôt que de l'écraser —
 * conserve une trace exploitable des changements tarifaires, permis
 * par l'index unique PARTIEL `uq_plan_prices_active` (0040_country_engine.sql,
 * "où is_active"). `amountMajorUnits` est saisi en unité humaine (ex:
 * 50 pour 50 GHS, jamais en centimes) — normalisé ici selon la devise
 * DU PAYS (jamais une devise arbitraire, section 12).
 */
export async function upsertCountryPrice(
  isoCode: string,
  planKey: string,
  amountMajorUnits: number,
  actorUserId: string,
): Promise<void> {
  if (!isPlanKey(planKey)) {
    throw new ValidationError(`Plan invalide — attendu l'un de : ${PLAN_KEYS.join(", ")}.`);
  }

  const country = await getCountry(isoCode);
  if (!country) throw new NotFoundError(`Pays introuvable : "${isoCode}".`);

  const amount = normalizeMoney(amountMajorUnits, country.currencyCode);
  validateMoney(amount, country.currencyCode);

  const supabase = getSupabaseServiceClient();

  const { data: before, error: beforeError } = await supabase
    .from("plan_prices")
    .select("id, amount, currency_code")
    .eq("plan_key", planKey)
    .eq("country_code", country.isoCode)
    .eq("billing_interval", "monthly")
    .eq("is_active", true)
    .maybeSingle();

  if (beforeError) throw new Error(`Erreur lecture plan_prices : ${beforeError.message}`);

  if (before) {
    const { error: archiveError } = await supabase.from("plan_prices").update({ is_active: false }).eq("id", before.id);
    if (archiveError) throw new Error(`Erreur archivage de l'ancien prix : ${archiveError.message}`);
  }

  const { error: insertError } = await supabase.from("plan_prices").insert({
    plan_key: planKey,
    country_code: country.isoCode,
    currency_code: country.currencyCode,
    amount,
    billing_interval: "monthly",
    is_active: true,
  });

  if (insertError) throw new Error(`Erreur création du nouveau prix : ${insertError.message}`);

  await writeAdminAuditLog({
    actorUserId,
    organizationId: null,
    entityId: country.id,
    action: "COUNTRY_PRICE_CHANGED",
    entityType: "plan_price",
    beforeState: before ? { planKey, countryCode: country.isoCode, amount: before.amount, currencyCode: before.currency_code } : null,
    afterState: { planKey, countryCode: country.isoCode, amount, currencyCode: country.currencyCode },
  });
}

/** Bouton "Synchroniser NotchPay" du Super Admin (section 9/18/67). */
export async function triggerManualSync(actorUserId: string): Promise<{ countries: SyncResult; channels: SyncResult[] }> {
  const result = await syncAllResources();

  await writeAdminAuditLog({
    actorUserId,
    organizationId: null,
    action: "COUNTRY_SYNCED",
    entityType: "country_sync",
    afterState: {
      countriesStatus: result.countries.status,
      countriesItemsSynced: result.countries.itemsSynced,
      channelSyncsRun: result.channels.length,
      channelSyncFailures: result.channels.filter((c) => c.status === "failed").length,
    },
  });

  return result;
}

/** Bouton "Synchroniser" de la page détail d'UN pays (section 19) — ne resynchronise que ses canaux, pas les 195 pays du monde. */
export async function triggerCountryChannelsSync(isoCode: string, actorUserId: string): Promise<SyncResult> {
  const country = await getCountry(isoCode);
  if (!country) throw new NotFoundError(`Pays introuvable : "${isoCode}".`);

  const result = await syncChannels(country.isoCode);

  await writeAdminAuditLog({
    actorUserId,
    organizationId: null,
    entityId: country.id,
    action: "COUNTRY_CHANNEL_UPDATED",
    entityType: "country",
    afterState: { isoCode: country.isoCode, status: result.status, itemsSynced: result.itemsSynced, errorMessage: result.errorMessage },
  });

  return result;
}
