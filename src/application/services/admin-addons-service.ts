import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { writeAdminAuditLog } from "./admin-organizations-service";
import { getPlatformSettingNumber, setPlatformSetting } from "./platform-settings-service";

/**
 * Lot G, Partie 2 — gestion Super Admin du catalogue d'add-ons (section
 * 45/Lot C étendue). Le catalogue en LECTURE côté tenant vit dans
 * addons-service.ts::listAddons() — ce fichier ne couvre que les
 * mutations réservées à /admin/addons.
 */

export interface CreateAddonInput {
  key: string;
  name: string;
  description?: string;
  priceFcfa: number;
  entitlementKey: string;
  incrementValue: number;
}

export async function createAddon(input: CreateAddonInput, actorUserId: string): Promise<void> {
  const key = input.key.trim();
  if (!key) throw new ValidationError("La clé de l'add-on est requise.");
  if (!input.name.trim()) throw new ValidationError("Le nom de l'add-on est requis.");
  if (!input.entitlementKey.trim()) throw new ValidationError("La clé d'entitlement ciblée est requise.");
  if (input.priceFcfa < 0) throw new ValidationError("Le prix doit être positif.");
  if (!Number.isInteger(input.incrementValue) || input.incrementValue <= 0) {
    throw new ValidationError("L'incrément doit être un entier positif.");
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("addons").insert({
    key,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    price_fcfa: input.priceFcfa,
    entitlement_key: input.entitlementKey.trim(),
    increment_value: input.incrementValue,
    active: true,
  });

  if (error) {
    if (error.code === "23505") throw new ValidationError(`Un add-on avec la clé "${key}" existe déjà.`);
    throw new Error(`Impossible de créer l'add-on: ${error.message}`);
  }

  await writeAdminAuditLog({
    actorUserId,
    organizationId: null,
    action: "ADDON_CREATED",
    entityType: "addon",
    afterState: { ...input, key },
  });
}

export interface UpdateAddonInput {
  name?: string;
  description?: string;
  priceFcfa?: number;
  incrementValue?: number;
  active?: boolean;
}

export async function updateAddon(key: string, input: UpdateAddonInput, actorUserId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data: before, error: beforeError } = await supabase.from("addons").select("*").eq("key", key).maybeSingle();
  if (beforeError) throw new Error(`Erreur lecture addons: ${beforeError.message}`);
  if (!before) throw new NotFoundError("Add-on introuvable.");

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new ValidationError("Le nom de l'add-on est requis.");
    patch.name = input.name.trim();
  }
  if (input.description !== undefined) patch.description = input.description.trim() || null;
  if (input.priceFcfa !== undefined) {
    if (input.priceFcfa < 0) throw new ValidationError("Le prix doit être positif.");
    patch.price_fcfa = input.priceFcfa;
  }
  if (input.incrementValue !== undefined) {
    if (!Number.isInteger(input.incrementValue) || input.incrementValue <= 0) {
      throw new ValidationError("L'incrément doit être un entier positif.");
    }
    patch.increment_value = input.incrementValue;
  }
  if (input.active !== undefined) patch.active = input.active;

  const { error } = await supabase.from("addons").update(patch).eq("key", key);
  if (error) throw new Error(`Impossible de mettre à jour l'add-on: ${error.message}`);

  await writeAdminAuditLog({
    actorUserId,
    organizationId: null,
    action: "ADDON_UPDATED",
    entityType: "addon",
    beforeState: before,
    afterState: { ...before, ...patch },
  });
}

/** Durée d'essai par défaut (jours) — consommée par plans-repository.ts::createTrialSubscription(). */
export async function getTrialDays(): Promise<number> {
  return getPlatformSettingNumber("trial_days", 14);
}

export async function setTrialDays(days: number, actorUserId: string): Promise<void> {
  if (!Number.isInteger(days) || days <= 0) {
    throw new ValidationError("La durée d'essai doit être un nombre entier de jours positif.");
  }
  await setPlatformSetting("trial_days", days, actorUserId);
}
