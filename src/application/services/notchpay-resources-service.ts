import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

/**
 * Country Engine — lecture des pays/canaux de paiement (section 8 du
 * master prompt d'expansion multi-pays).
 *
 * CORRECTIF 16/09/2026 — ce fichier contenait à l'origine aussi la
 * synchronisation automatique depuis NotchPay (`syncCountries` /
 * `syncChannels` / `syncAllResources` / `getSyncStatus`, appelées par
 * les boutons "Synchroniser NotchPay" du Super Admin). Elle a été
 * retirée : l'endpoint qu'elle appelait (`/resources/countries`)
 * n'existe pas réellement côté NotchPay (404 constaté en production),
 * et l'endpoint réel (`GET /countries`) ne retourne que la liste
 * générique des pays du monde, pas "les pays supportés par NotchPay
 * comme moyen de paiement" — NotchPay n'expose aucun endpoint public
 * confirmé répondant à cette question (voir docs/notchpay-resources.md
 * pour l'historique complet des vérifications faites ce jour-là).
 *
 * Les tables `countries`/`payment_channels` restent la SEULE source
 * de vérité (jamais de `if (country === "CM")` dispersé dans le code,
 * voir country-service.ts), mais sont désormais alimentées
 * MANUELLEMENT — SQL direct pour l'ajout initial d'un pays (voir les
 * migrations 0040/0052), puis `/admin/countries` pour la décision
 * commerciale (`launch_status`) et la tarification. `notchpay_supported`
 * reste une colonne réelle (signal "NotchPay dit supporter ce pays",
 * documenté par NotchPay eux-mêmes) mais n'est plus jamais écrite
 * automatiquement — elle se modifie à la main, en même temps que le
 * reste de la ligne, via une requête SQL ou une future action Super
 * Admin dédiée si le besoin apparaît.
 *
 * Source de vérité (section 7, inchangée) :
 *   notchpay_supported (capacité technique, gérée à la main désormais)
 *   Super Admin (décision commerciale) -> countries.launch_status
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
