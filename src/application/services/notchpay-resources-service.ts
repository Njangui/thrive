import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotchPayResourcesClient } from "@/infrastructure/providers/payment/notchpay/resources-client";
import { getCurrencyMeta } from "./currency-service";

/**
 * Country Engine — synchronisation des ressources NotchPay (section 8).
 *
 * Source de vérité (section 7) :
 *   NotchPay (capacité technique)  -> cette table (countries.notchpay_supported,
 *                                      payment_channels)
 *   Super Admin (décision commerciale) -> countries.launch_status (JAMAIS
 *                                      touché par ce fichier)
 *
 * Chaque fonction de sync est best-effort et n'efface JAMAIS l'état
 * précédemment connu en cas d'échec (section 9/10) : une ligne
 * `countries`/`payment_channels` existante n'est modifiée que si
 * NotchPay répond avec succès ; en cas d'erreur réseau/API, la sync
 * échoue proprement (voir `notchpay_sync_runs`) sans toucher aux
 * lignes déjà en base — SME-OS continue de fonctionner avec le dernier
 * état synchronisé.
 */

export interface CountryRecord {
  id: string;
  isoCode: string;
  name: string;
  nativeName: string | null;
  currencyCode: string;
  currencyName: string | null;
  currencySymbol: string | null;
  phoneCode: string;
  flagUrl: string | null;
  notchpaySupported: boolean;
  launchStatus: "disabled" | "coming_soon" | "waitlist" | "active";
  displayOrder: number;
  metadata: Record<string, unknown>;
  lastSyncedAt: string | null;
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentChannelRecord {
  id: string;
  countryCode: string;
  provider: string;
  channelCode: string;
  channelName: string;
  type: string | null;
  currencyCode: string;
  isAvailable: boolean;
  metadata: Record<string, unknown>;
  lastSyncedAt: string | null;
}

export interface SyncResult {
  status: "success" | "failed";
  itemsSynced: number;
  errorMessage?: string;
}

export interface SyncStatusSummary {
  lastSuccessfulSyncAt: string | null;
  lastFailedSyncAt: string | null;
  lastError: string | null;
  isHealthy: boolean;
}

interface CountryRow {
  id: string;
  iso_code: string;
  name: string;
  native_name: string | null;
  currency_code: string;
  currency_name: string | null;
  currency_symbol: string | null;
  phone_code: string;
  flag_url: string | null;
  notchpay_supported: boolean;
  launch_status: "disabled" | "coming_soon" | "waitlist" | "active";
  display_order: number;
  metadata: Record<string, unknown> | null;
  last_synced_at: string | null;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapCountryRow(row: CountryRow): CountryRecord {
  return {
    id: row.id,
    isoCode: row.iso_code,
    name: row.name,
    nativeName: row.native_name,
    currencyCode: row.currency_code,
    currencyName: row.currency_name,
    currencySymbol: row.currency_symbol,
    phoneCode: row.phone_code,
    flagUrl: row.flag_url,
    notchpaySupported: row.notchpay_supported,
    launchStatus: row.launch_status,
    displayOrder: row.display_order,
    metadata: row.metadata ?? {},
    lastSyncedAt: row.last_synced_at,
    activatedAt: row.activated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface PaymentChannelRow {
  id: string;
  country_code: string;
  provider: string;
  channel_code: string;
  channel_name: string;
  type: string | null;
  currency_code: string;
  is_available: boolean;
  metadata: Record<string, unknown> | null;
  last_synced_at: string | null;
}

function mapChannelRow(row: PaymentChannelRow): PaymentChannelRecord {
  return {
    id: row.id,
    countryCode: row.country_code,
    provider: row.provider,
    channelCode: row.channel_code,
    channelName: row.channel_name,
    type: row.type,
    currencyCode: row.currency_code,
    isAvailable: row.is_available,
    metadata: row.metadata ?? {},
    lastSyncedAt: row.last_synced_at,
  };
}

/** Toutes les entrées `countries` connues (actives, désactivées, coming soon...) — pour le Super Admin. Le filtrage commercial (actif/coming soon publics) se fait dans country-service.ts, jamais ici. */
export async function getCountries(): Promise<CountryRecord[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("countries")
    .select("*")
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw new Error(`Erreur lecture countries: ${error.message}`);
  return (data as CountryRow[] ?? []).map(mapCountryRow);
}

export async function getCountry(isoCode: string): Promise<CountryRecord | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("countries")
    .select("*")
    .eq("iso_code", isoCode.toUpperCase())
    .maybeSingle();

  if (error) throw new Error(`Erreur lecture countries(${isoCode}): ${error.message}`);
  return data ? mapCountryRow(data as CountryRow) : null;
}

export async function getChannels(countryCode: string): Promise<PaymentChannelRecord[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("payment_channels")
    .select("*")
    .eq("country_code", countryCode.toUpperCase())
    .order("channel_name", { ascending: true });

  if (error) throw new Error(`Erreur lecture payment_channels(${countryCode}): ${error.message}`);
  return (data as PaymentChannelRow[] ?? []).map(mapChannelRow);
}

async function recordSyncRun(params: {
  resourceType: "countries" | "channels";
  resourceScope: string | null;
  status: "success" | "failed";
  itemsSynced: number;
  startedAt: string;
  errorMessage?: string;
}): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("notchpay_sync_runs").insert({
    resource_type: params.resourceType,
    resource_scope: params.resourceScope,
    status: params.status,
    items_synced: params.itemsSynced,
    error_message: params.errorMessage ?? null,
    started_at: params.startedAt,
  });

  if (error) {
    // Best-effort : ne jamais faire échouer une sync parce que l'écriture
    // de son propre journal a échoué (le résultat de la sync elle-même
    // reste correct et retourné à l'appelant).
    console.error("notchpay-resources-service: échec écriture notchpay_sync_runs:", error.message);
  }
}

/**
 * Synchronise la liste des pays supportés par NotchPay (section 8/9).
 * N'écrit JAMAIS `launch_status` — seule colonne à rester
 * exclusivement sous contrôle Super Admin (section 7). Un pays déjà
 * connu conserve son `launch_status`/`display_order`/`native_name`
 * actuels (upsert Postgres : seules les colonnes du payload sont
 * réécrites en cas de conflit) ; un nouveau pays est inséré avec
 * `launch_status = 'disabled'` par défaut (jamais auto-activé — voir
 * commentaire de tête de 0040_country_engine.sql).
 */
export async function syncCountries(): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const supabase = getSupabaseServiceClient();

  try {
    const client = new NotchPayResourcesClient();
    const response = await client.listCountries();
    const countries = response.countries ?? [];

    let synced = 0;
    for (const c of countries) {
      const isoCode = c.code?.toUpperCase();
      const currencyCode = c.currency?.toUpperCase();

      // Défensif : une entrée malformée (code/devise absents ou hors
      // format ISO) ne doit jamais faire échouer TOUTE la synchronisation
      // — elle est ignorée et le reste continue.
      if (!isoCode || !/^[A-Z]{2}$/.test(isoCode)) continue;
      if (!currencyCode || !/^[A-Z]{3}$/.test(currencyCode)) continue;
      if (!c.phone_code) continue;

      const currencyMeta = getCurrencyMeta(currencyCode);
      const syncedAt = new Date().toISOString();

      const { error } = await supabase.from("countries").upsert(
        {
          iso_code: isoCode,
          name: c.name || isoCode,
          currency_code: currencyCode,
          currency_name: currencyMeta.name,
          currency_symbol: currencyMeta.symbol,
          phone_code: c.phone_code,
          flag_url: c.flag ?? null,
          notchpay_supported: true,
          metadata: { notchpay_channels: c.channels ?? [] },
          last_synced_at: syncedAt,
        },
        { onConflict: "iso_code" },
      );

      if (error) {
        console.error(`syncCountries(): échec upsert pour ${isoCode}, ligne ignorée:`, error.message);
        continue;
      }
      synced += 1;
    }

    await recordSyncRun({ resourceType: "countries", resourceScope: null, status: "success", itemsSynced: synced, startedAt });
    return { status: "success", itemsSynced: synced };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("syncCountries() échec — le dernier état connu en base est conservé tel quel:", message);
    await recordSyncRun({ resourceType: "countries", resourceScope: null, status: "failed", itemsSynced: 0, startedAt, errorMessage: message });
    return { status: "failed", itemsSynced: 0, errorMessage: message };
  }
}

/**
 * Synchronise les canaux de paiement d'UN pays (section 8/11). Marque
 * `is_available = false` les canaux précédemment connus mais absents
 * de la réponse NotchPay la plus récente (dépréciés côté NotchPay) —
 * sans jamais les supprimer (des paiements passés référencent
 * `channel_code` en texte libre, jamais une FK stricte).
 */
export async function syncChannels(countryCode: string): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const supabase = getSupabaseServiceClient();
  const iso = countryCode.toUpperCase();

  try {
    const client = new NotchPayResourcesClient();
    const response = await client.listChannels(iso);
    const channels = response.channels ?? [];

    let synced = 0;
    const seenCodes: string[] = [];

    for (const ch of channels) {
      if (!ch.id || !ch.country || !ch.currency) continue;

      const { error } = await supabase.from("payment_channels").upsert(
        {
          country_code: ch.country.toUpperCase(),
          provider: "notchpay",
          channel_code: ch.id,
          channel_name: ch.name || ch.id,
          type: ch.type ?? null,
          currency_code: ch.currency.toUpperCase(),
          is_available: true,
          metadata: { minimum: ch.minimum ?? null, maximum: ch.maximum ?? null, logo: ch.logo ?? null },
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "provider,channel_code" },
      );

      if (error) {
        console.error(`syncChannels(${iso}): échec upsert pour ${ch.id}, ligne ignorée:`, error.message);
        continue;
      }
      seenCodes.push(ch.id);
      synced += 1;
    }

    // Best-effort : désactive les canaux de CE pays qui ne sont plus
    // renvoyés par NotchPay. N'échoue jamais la sync globale si cette
    // étape secondaire échoue (ex: syntaxe de filtre PostgREST) — la
    // synchronisation des canaux ACTIFS ci-dessus reste valide.
    try {
      let staleQuery = supabase
        .from("payment_channels")
        .update({ is_available: false })
        .eq("country_code", iso)
        .eq("provider", "notchpay")
        .eq("is_available", true);
      if (seenCodes.length > 0) {
        staleQuery = staleQuery.not("channel_code", "in", `(${seenCodes.join(",")})`);
      }
      const { error: staleError } = await staleQuery;
      if (staleError) {
        console.warn(`syncChannels(${iso}): échec marquage des canaux obsolètes (non bloquant):`, staleError.message);
      }
    } catch (staleErr) {
      console.warn(`syncChannels(${iso}): échec marquage des canaux obsolètes (non bloquant):`, staleErr);
    }

    await recordSyncRun({ resourceType: "channels", resourceScope: iso, status: "success", itemsSynced: synced, startedAt });
    return { status: "success", itemsSynced: synced };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`syncChannels(${iso}) échec — le dernier état connu en base est conservé tel quel:`, message);
    await recordSyncRun({ resourceType: "channels", resourceScope: iso, status: "failed", itemsSynced: 0, startedAt, errorMessage: message });
    return { status: "failed", itemsSynced: 0, errorMessage: message };
  }
}

/**
 * Synchronisation complète (bouton "Synchroniser NotchPay" du Super
 * Admin, section 9, ou cron quotidien par défaut). Séquentiel et
 * volontairement simple : ce n'est pas un chemin chaud (déclenché
 * manuellement ou 1x/jour, section 9), pas la peine de paralléliser au
 * prix d'une complexité supplémentaire (section 49).
 */
export async function syncAllResources(): Promise<{ countries: SyncResult; channels: SyncResult[] }> {
  const countriesResult = await syncCountries();
  const allCountries = await getCountries();

  const channelResults: SyncResult[] = [];
  for (const country of allCountries) {
    channelResults.push(await syncChannels(country.isoCode));
  }

  return { countries: countriesResult, channels: channelResults };
}

/** Pour l'affichage Super Admin (section 9/43) : "Dernière synchronisation : ... / Statut : ✓ / ⚠". */
export async function getSyncStatus(resourceType: "countries" | "channels" = "countries"): Promise<SyncStatusSummary> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("notchpay_sync_runs")
    .select("status, error_message, finished_at")
    .eq("resource_type", resourceType)
    .order("finished_at", { ascending: false })
    .limit(10);

  if (error || !data || data.length === 0) {
    return { lastSuccessfulSyncAt: null, lastFailedSyncAt: null, lastError: null, isHealthy: false };
  }

  const lastSuccess = data.find((r) => r.status === "success");
  const lastFailed = data.find((r) => r.status === "failed");
  const mostRecent = data[0]!;

  return {
    lastSuccessfulSyncAt: lastSuccess?.finished_at ?? null,
    lastFailedSyncAt: lastFailed?.finished_at ?? null,
    lastError: mostRecent.status === "failed" ? mostRecent.error_message : null,
    isHealthy: mostRecent.status === "success",
  };
}
