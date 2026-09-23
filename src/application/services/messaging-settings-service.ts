import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { ValidationError } from "@/lib/errors";

/**
 * Lot P — réglage « pause de l'IA après une réponse manuelle ».
 *
 * L'IA est ACTIVE PAR DÉFAUT dans toute conversation. Quand le commerçant
 * répond lui-même, elle se met en pause pour ne pas lui couper la parole,
 * puis reprend TOUTE SEULE après cette durée (au prochain message du client) :
 * plus de « Rendre à l'IA » à cliquer conversation par conversation.
 * `0` = l'IA ne se met jamais en pause, même quand le commerçant répond.
 *
 * Stocké dans `ai_config.human_pause_minutes` (migration 0068). La lecture
 * retombe sur la valeur par défaut si la colonne n'existe pas encore : le
 * code peut être déployé avant la migration sans jamais casser la messagerie.
 */
export const DEFAULT_HUMAN_PAUSE_MINUTES = 15;
export const MAX_HUMAN_PAUSE_MINUTES = 10080; // 7 jours

export const HUMAN_PAUSE_OPTIONS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 0, label: "Jamais — l'IA reste active même quand je réponds" },
  { minutes: 5, label: "5 minutes" },
  { minutes: 15, label: "15 minutes (recommandé)" },
  { minutes: 60, label: "1 heure" },
  { minutes: 360, label: "6 heures" },
  { minutes: 1440, label: "24 heures" },
];

export function normalizeHumanPauseMinutes(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_HUMAN_PAUSE_MINUTES) return DEFAULT_HUMAN_PAUSE_MINUTES;
  return n;
}

/** Ne lève jamais : un réglage illisible ne doit pas empêcher de répondre à un client. */
export async function getHumanPauseMinutes(organizationId: string): Promise<number> {
  try {
    const { data, error } = await getSupabaseServiceClient()
      .from("ai_config")
      .select("human_pause_minutes")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error || !data) return DEFAULT_HUMAN_PAUSE_MINUTES;
    return normalizeHumanPauseMinutes((data as { human_pause_minutes?: unknown }).human_pause_minutes);
  } catch {
    return DEFAULT_HUMAN_PAUSE_MINUTES;
  }
}

export async function setHumanPauseMinutes(organizationId: string, minutes: number): Promise<void> {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_HUMAN_PAUSE_MINUTES) {
    throw new ValidationError("La durée de pause de l'IA est invalide.");
  }
  const { error } = await getSupabaseServiceClient()
    .from("ai_config")
    .upsert({ organization_id: organizationId, human_pause_minutes: minutes }, { onConflict: "organization_id" });
  if (error) {
    console.error(`setHumanPauseMinutes(${organizationId}):`, error.message);
    throw new ValidationError("Le réglage de pause de l'IA n'a pas pu être enregistré (la migration 0068 est-elle appliquée ?).");
  }
}
