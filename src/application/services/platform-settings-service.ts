import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { ValidationError } from "@/lib/errors";
import { writeAdminAuditLog } from "./admin-organizations-service";

/**
 * Réglages plateforme génériques (clé/valeur jsonb), Lot G — voir
 * 0020_addons.sql pour la table. Premier usage : durée d'essai par
 * défaut (plans-repository.ts::createTrialSubscription). Volontairement
 * générique pour servir de base à de futurs réglages globaux sans
 * migration dédiée à chacun.
 */

/**
 * Ne lève jamais : un réglage manquant ou une table temporairement
 * inaccessible retombe sur `fallback` plutôt que de casser un flow
 * critique (ex: création d'organisation) pour un réglage secondaire.
 */
export async function getPlatformSettingNumber(key: string, fallback: number): Promise<number> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("platform_settings").select("value").eq("key", key).maybeSingle();

  if (error) {
    console.error(`getPlatformSettingNumber(${key}) erreur de lecture:`, error.message);
    return fallback;
  }
  if (!data) return fallback;

  const value = typeof data.value === "number" ? data.value : Number(data.value);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Écriture réservée Super Admin (voir admin-addons-service.ts, seul
 * appelant actuel) — écrit systématiquement un audit_logs, cohérent avec
 * la règle "toute action Super Admin de mutation écrit audit_logs"
 * (03_LOT_C_super_admin.md, section Sécurité).
 */
export async function setPlatformSetting(key: string, value: number, actorUserId: string): Promise<void> {
  if (!Number.isFinite(value) || value < 0) {
    throw new ValidationError("La valeur du réglage doit être un nombre positif.");
  }

  const supabase = getSupabaseServiceClient();

  const { data: before } = await supabase.from("platform_settings").select("value").eq("key", key).maybeSingle();

  const { error } = await supabase.from("platform_settings").upsert({ key, value }, { onConflict: "key" });

  if (error) {
    throw new Error(`Impossible d'écrire le réglage plateforme "${key}": ${error.message}`);
  }

  await writeAdminAuditLog({
    actorUserId,
    organizationId: null,
    action: "PLATFORM_SETTING_CHANGED",
    entityType: "platform_setting",
    beforeState: { key, value: before?.value ?? null },
    afterState: { key, value },
  });
}
