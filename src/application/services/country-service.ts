import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { ValidationError } from "@/lib/errors";
import { getCountries, getCountry as getCountryRecord, type CountryRecord } from "./notchpay-resources-service";

/**
 * Country Engine — service central de règles pays (section 30/31 du
 * master prompt d'expansion). Interdiction explicite du cahier :
 * `if (country === "CM") { ... }` dispersé dans le code. Tout code qui
 * a besoin de savoir si un pays est actif/en attente/désactivé DOIT
 * passer par ce fichier, jamais interroger `countries` directement
 * (sauf `notchpay-resources-service.ts`, qui EST la couche de lecture/
 * écriture DB sous-jacente à ce service).
 */

/** Seul repli codé en dur toléré (section 57) : compatibilité ascendante pour un flux critique (paiement) qui ne doit jamais planter si un pays venait à manquer en base (cas anormal, mais défensif). PAS utilisé pour décider quoi que ce soit de commercial. */
export const DEFAULT_COUNTRY_CODE = "CM";
export const DEFAULT_CURRENCY_CODE = "XAF";

export interface PublicCountry {
  isoCode: string;
  name: string;
  nativeName: string | null;
  currencyCode: string;
  currencySymbol: string | null;
  phoneCode: string;
  flagUrl: string | null;
  launchStatus: CountryRecord["launchStatus"];
}

/**
 * Lecture "safe" — ne lève JAMAIS. Un souci de lecture DB sur un pays
 * ne doit jamais faire planter un flow métier (onboarding, paiement) :
 * traité comme "pays inconnu", jamais comme une exception qui remonte
 * jusqu'à l'utilisateur (section 9 : continuer à fonctionner avec le
 * dernier état connu, même en cas de défaillance).
 */
export async function getCountrySafe(isoCode: string): Promise<CountryRecord | null> {
  try {
    return await getCountryRecord(isoCode);
  } catch (err) {
    console.error(`getCountrySafe(${isoCode}) erreur de lecture, traité comme pays inconnu:`, err);
    return null;
  }
}

export async function isCountryActive(isoCode: string): Promise<boolean> {
  const country = await getCountrySafe(isoCode);
  return country?.launchStatus === "active";
}

export async function isCountryComingSoon(isoCode: string): Promise<boolean> {
  const country = await getCountrySafe(isoCode);
  return country?.launchStatus === "coming_soon";
}

export async function isCountryOnWaitlist(isoCode: string): Promise<boolean> {
  const country = await getCountrySafe(isoCode);
  return country?.launchStatus === "waitlist";
}

/** Capacité TECHNIQUE NotchPay — distincte de la décision commerciale (section 7). Un pays peut être `notchpaySupported=true` sans jamais être `active` côté SME-OS. */
export async function isCountrySupportedByPaymentProvider(isoCode: string): Promise<boolean> {
  const country = await getCountrySafe(isoCode);
  return country?.notchpaySupported === true;
}

function toPublicCountry(c: CountryRecord): PublicCountry {
  return {
    isoCode: c.isoCode,
    name: c.name,
    nativeName: c.nativeName,
    currencyCode: c.currencyCode,
    currencySymbol: c.currencySymbol,
    phoneCode: c.phoneCode,
    flagUrl: c.flagUrl,
    launchStatus: c.launchStatus,
  };
}

/**
 * Pour la landing publique (section 22) et l'API publique (section
 * 23) : uniquement les pays qu'il est pertinent de montrer au public
 * (actif, coming soon, ou waitlist — jamais "disabled", qui reste
 * invisible). Ne renvoie QUE des champs publics, jamais de metadata
 * interne (section 23 : aucune info Super Admin exposée).
 */
export async function listPublicCountries(): Promise<PublicCountry[]> {
  const countries = await getCountries();
  return countries
    .filter((c) => c.launchStatus === "active" || c.launchStatus === "coming_soon" || c.launchStatus === "waitlist")
    .map(toPublicCountry);
}

/** Pour le sélecteur pays de l'onboarding (section 13) : UNIQUEMENT les pays où l'inscription normale est réellement ouverte. */
export async function listSignupEligibleCountries(): Promise<PublicCountry[]> {
  const countries = await getCountries();
  return countries.filter((c) => c.launchStatus === "active").map(toPublicCountry);
}

/**
 * Valide le pays choisi à l'onboarding (section 13) et retourne la
 * devise à utiliser pour la nouvelle organisation — lève
 * ValidationError si l'inscription n'est pas ouverte pour ce pays
 * (disabled/coming_soon/waitlist/inconnu), avec un message adapté au
 * statut pour guider l'utilisateur (ex: rediriger vers la liste
 * d'attente si `waitlist`).
 */
export async function validateCountryForSignup(
  isoCode: string,
): Promise<{ countryCode: string; currencyCode: string }> {
  const country = await getCountrySafe(isoCode);
  if (!country) {
    throw new ValidationError(`Pays inconnu : "${isoCode}".`);
  }
  if (country.launchStatus !== "active") {
    const statusLabel: Record<CountryRecord["launchStatus"], string> = {
      disabled: "n'est pas encore disponible sur SME-OS",
      coming_soon: "arrive bientôt sur SME-OS",
      waitlist: "est en liste d'attente sur SME-OS",
      active: "est actif", // jamais atteint (garde par l'if ci-dessus), gardé pour l'exhaustivité du type
    };
    throw new ValidationError(`${country.name} ${statusLabel[country.launchStatus]} — inscription pas encore ouverte.`);
  }
  return { countryCode: country.isoCode, currencyCode: country.currencyCode };
}

/**
 * Devise d'un pays — NE JAMAIS lever (utilisé sur le chemin critique du
 * paiement, section 57 : repli XAF/CM légitime uniquement ici, jamais
 * pour une décision commerciale). Ignore volontairement `launchStatus`
 * : une organisation existante dont le pays a été désactivé APRÈS coup
 * doit continuer à payer dans sa devise habituelle (section 21).
 */
export async function resolveCurrencyForCountry(isoCode: string): Promise<string> {
  const country = await getCountrySafe(isoCode);
  return country?.currencyCode ?? DEFAULT_CURRENCY_CODE;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Liste d'attente (section 54). Volontairement minimal — pas de
 * mini-CRM (section 49). Toujours appelé depuis une Server Action
 * rate-limitée (voir country-waitlist-actions.ts) : `country_waitlist`
 * n'a aucune policy RLS pour les rôles clients (0040_country_engine.sql),
 * donc CE chemin service-role est le SEUL moyen d'y écrire.
 */
export async function joinCountryWaitlist(params: {
  email: string;
  countryCode: string;
  companyName?: string;
}): Promise<void> {
  const email = params.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new ValidationError("Adresse email invalide.");
  }

  const country = await getCountrySafe(params.countryCode);
  if (!country) {
    throw new ValidationError(`Pays inconnu : "${params.countryCode}".`);
  }
  if (country.launchStatus !== "waitlist" && country.launchStatus !== "coming_soon") {
    throw new ValidationError(`${country.name} n'est pas en liste d'attente actuellement.`);
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("country_waitlist").upsert(
    { email, country_code: country.isoCode, company_name: params.companyName?.trim() || null },
    { onConflict: "email,country_code", ignoreDuplicates: true },
  );

  if (error) {
    throw new Error(`Erreur inscription liste d'attente: ${error.message}`);
  }
}

/**
 * Emoji drapeau calculé depuis le code ISO (algorithme standard des
 * "regional indicator symbols" Unicode) — repli d'affichage quand
 * `flagUrl` est absent (pays saisi manuellement, pas encore synchronisé
 * avec une image NotchPay). Jamais stocké en base : calculé à la
 * volée, purement côté présentation.
 */
export function isoCodeToFlagEmoji(isoCode: string): string {
  const upper = isoCode.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return "🏳️";
  const codePoints = [...upper].map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}
