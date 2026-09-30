import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

/**
 * Lecture seule de l'essai Pro offert (sans dépendance vers les autres
 * services : `plans-repository.ts` l'importe sur le chemin de chaque
 * contrôle de droit, un import plus lourd créerait un cycle).
 * Voir `promo-trial-service.ts` pour le principe complet.
 */

export const PROMO_SETTING_KEY = "free_pro_promo";
export const PROMO_DURATION_DAYS = 14;
export const PROMO_REMINDER_DAYS = 3;

export const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 30_000;

export interface PromoTrial {
  startsAt: string;
  endsAt: string;
  /** Rappel J-3 déjà envoyé (ISO) — jamais renvoyé. */
  reminderSentAt: string | null;
  /** Message de fin déjà envoyé (ISO) — jamais renvoyé. */
  endNoticeSentAt: string | null;
  /** Bonus de crédits IA retiré (balayage de fin) (ISO). */
  creditsRevertedAt: string | null;
  /** Arrêt manuel anticipé par le Super Admin (ISO). */
  stoppedAt: string | null;
}

export type PromoPhase = "none" | "scheduled" | "active" | "ended";

let cache: { at: number; value: PromoTrial | null } | null = null;

export function resetPromoCache(): void {
  cache = null;
}

function parsePromo(raw: unknown): PromoTrial | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.startsAt !== "string" || typeof v.endsAt !== "string") return null;
  if (Number.isNaN(Date.parse(v.startsAt)) || Number.isNaN(Date.parse(v.endsAt))) return null;
  const str = (x: unknown) => (typeof x === "string" ? x : null);
  return {
    startsAt: v.startsAt,
    endsAt: v.endsAt,
    reminderSentAt: str(v.reminderSentAt),
    endNoticeSentAt: str(v.endNoticeSentAt),
    creditsRevertedAt: str(v.creditsRevertedAt),
    stoppedAt: str(v.stoppedAt),
  };
}

/** Fin réelle : un arrêt manuel raccourcit la fenêtre. */
export function effectiveEnd(promo: PromoTrial): Date {
  const end = new Date(promo.endsAt);
  if (promo.stoppedAt) {
    const stopped = new Date(promo.stoppedAt);
    if (stopped < end) return stopped;
  }
  return end;
}

export function getPromoPhase(promo: PromoTrial | null, now: Date = new Date()): PromoPhase {
  if (!promo) return "none";
  if (now < new Date(promo.startsAt)) return "scheduled";
  if (now < effectiveEnd(promo)) return "active";
  return "ended";
}

/**
 * Ne lève JAMAIS : cette lecture est sur le chemin de chaque vérification
 * de droit. Toute erreur (table illisible, valeur mal formée) = pas
 * d'essai, donc plan réel — jamais un accès Pro accordé par accident.
 * Cache mémoire 30 s par instance pour ne pas ajouter une requête à
 * chaque contrôle.
 */
export async function getPromoTrial(): Promise<PromoTrial | null> {
  const nowMs = Date.now();
  if (cache && nowMs - cache.at < CACHE_TTL_MS) return cache.value;
  try {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase.from("platform_settings").select("value").eq("key", PROMO_SETTING_KEY).maybeSingle();
    if (error) {
      console.error("getPromoTrial: erreur de lecture, essai ignoré:", error.message);
      cache = { at: nowMs, value: null };
      return null;
    }
    const value = parsePromo(data?.value);
    cache = { at: nowMs, value };
    return value;
  } catch (error) {
    console.error("getPromoTrial: exception, essai ignoré:", error);
    return null;
  }
}

/** Essai en cours à cet instant (sinon null). */
export async function getActivePromo(now: Date = new Date()): Promise<PromoTrial | null> {
  const promo = await getPromoTrial();
  return getPromoPhase(promo, now) === "active" ? promo : null;
}

export async function writePromo(promo: PromoTrial | null): Promise<void> {
  const supabase = getSupabaseServiceClient();
  if (promo === null) {
    const { error } = await supabase.from("platform_settings").delete().eq("key", PROMO_SETTING_KEY);
    if (error) throw new Error(`Impossible d'effacer l'essai Pro: ${error.message}`);
  } else {
    const { error } = await supabase.from("platform_settings").upsert({ key: PROMO_SETTING_KEY, value: promo }, { onConflict: "key" });
    if (error) throw new Error(`Impossible d'enregistrer l'essai Pro: ${error.message}`);
  }
  resetPromoCache();
}

