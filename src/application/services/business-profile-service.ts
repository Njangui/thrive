import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotFoundError, ValidationError } from "@/lib/errors";

/**
 * Lot O — « Fiche entreprise » : coordonnées, description et horaires de
 * l'organisation, éditables à tout moment par TOUS les plans (Discover
 * inclus). Avant ce lot, ces champs n'étaient saisissables qu'à
 * l'onboarding : `/dashboard/site` (personnalisation) est verrouillé sur
 * Discover et aucun autre écran ne les exposait.
 *
 * Ces colonnes alimentent la vitrine publique, le pied de page, la page
 * contact ET les réponses automatiques (business-info-resolver.ts) : une
 * fiche à jour améliore directement la messagerie semi-automatique.
 */
export const BUSINESS_DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;
export type BusinessDay = (typeof BUSINESS_DAYS)[number];

export const BUSINESS_LIMITS = { name: 80, description: 1000, address: 300, hoursPerDay: 40 } as const;

export interface BusinessProfile {
  name: string;
  description: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  email: string | null;
  address: string | null;
  openingHours: Partial<Record<BusinessDay, string>>;
}

export interface BusinessProfileInput {
  name: string;
  description?: string;
  phone?: string;
  whatsappNumber?: string;
  email?: string;
  address?: string;
  openingHours?: Partial<Record<BusinessDay, string>>;
}

const PHONE_PATTERN = /^\+?[0-9]{8,15}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Retire espaces, points, tirets et parenthèses ; valide 8 à 15 chiffres avec « + » initial optionnel. */
export function normalizePhoneNumber(raw: string | undefined, fieldLabel: string): string | null {
  const cleaned = (raw ?? "").replace(/[\s.\-()]/g, "");
  if (!cleaned) return null;
  if (!PHONE_PATTERN.test(cleaned)) {
    throw new ValidationError(`${fieldLabel} invalide : 8 à 15 chiffres, avec « + » et l'indicatif pays si possible (ex: +237 6XX XX XX XX).`);
  }
  return cleaned;
}

export interface ValidatedBusinessProfile {
  name: string;
  description: string | null;
  phone: string | null;
  whatsapp_number: string | null;
  email: string | null;
  address: string | null;
  opening_hours: Record<string, string>;
}

/** Validation pure (testable sans base) — lève `ValidationError` avec un message affichable. */
export function validateBusinessProfileInput(input: BusinessProfileInput): ValidatedBusinessProfile {
  const name = input.name.trim();
  if (name.length < 2 || name.length > BUSINESS_LIMITS.name) {
    throw new ValidationError(`Le nom de l'entreprise doit contenir entre 2 et ${BUSINESS_LIMITS.name} caractères.`);
  }
  const description = (input.description ?? "").trim();
  if (description.length > BUSINESS_LIMITS.description) {
    throw new ValidationError(`La description ne peut pas dépasser ${BUSINESS_LIMITS.description} caractères.`);
  }
  const address = (input.address ?? "").trim();
  if (address.length > BUSINESS_LIMITS.address) {
    throw new ValidationError(`L'adresse ne peut pas dépasser ${BUSINESS_LIMITS.address} caractères.`);
  }
  const email = (input.email ?? "").trim().toLowerCase();
  if (email && !EMAIL_PATTERN.test(email)) {
    throw new ValidationError("Adresse email invalide.");
  }

  const openingHours: Record<string, string> = {};
  for (const day of BUSINESS_DAYS) {
    const value = (input.openingHours?.[day] ?? "").trim();
    if (!value) continue;
    if (value.length > BUSINESS_LIMITS.hoursPerDay) {
      throw new ValidationError(`Horaires du ${day} : ${BUSINESS_LIMITS.hoursPerDay} caractères maximum.`);
    }
    openingHours[day] = value;
  }

  return {
    name,
    description: description || null,
    phone: normalizePhoneNumber(input.phone, "Téléphone"),
    whatsapp_number: normalizePhoneNumber(input.whatsappNumber, "Numéro WhatsApp"),
    email: email || null,
    address: address || null,
    opening_hours: openingHours,
  };
}

interface OrganizationBusinessRow {
  name: string;
  description: string | null;
  phone: string | null;
  whatsapp_number: string | null;
  email: string | null;
  address: string | null;
  opening_hours: Record<string, string> | null;
}

export async function getBusinessProfile(organizationId: string): Promise<BusinessProfile> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("name, description, phone, whatsapp_number, email, address, opening_hours")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw new Error(`Lecture de la fiche entreprise impossible: ${error.message}`);
  if (!data) throw new NotFoundError("Entreprise introuvable.");
  const row = data as OrganizationBusinessRow;
  return {
    name: row.name,
    description: row.description,
    phone: row.phone,
    whatsappNumber: row.whatsapp_number,
    email: row.email,
    address: row.address,
    openingHours: (row.opening_hours ?? {}) as Partial<Record<BusinessDay, string>>,
  };
}

export async function updateBusinessProfile(organizationId: string, input: BusinessProfileInput): Promise<void> {
  const validated = validateBusinessProfileInput(input);
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("organizations").update(validated).eq("id", organizationId);
  if (error) throw new Error(`Enregistrement de la fiche entreprise impossible: ${error.message}`);
}
