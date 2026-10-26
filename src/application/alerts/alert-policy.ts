import { z } from "zod";

/**
 * Politique d'alerte — fonctions PURES (aucune I/O) : catalogue des
 * déclencheurs, réglages par défaut, heures calmes, échelle d'escalade.
 * Règle « règles d'abord, IA ensuite » : l'IA ne décide jamais si on réveille
 * le propriétaire ; seuls ces réglages et ces seuils le font.
 */

export type AlertSeverity = "info" | "important" | "critical";

export interface TriggerDef {
  key: string;
  label: string;
  severity: AlertSeverity;
  defaultEnabled: boolean;
  /** Unité du seuil, si le déclencheur en a un (aucune valeur par défaut codée en dur pour l'argent). */
  thresholdUnit?: "XAF" | "percent" | "count";
  /** Producteur du signal : tant qu'il n'est pas livré, le déclencheur est désactivé par défaut. */
  producer: string;
}

export const ALERT_TRIGGERS: readonly TriggerDef[] = [
  { key: "suspicious_order", label: "Commande suspecte", severity: "important", defaultEnabled: true, producer: "C2/C1" },
  { key: "refund_over_threshold", label: "Remboursement au-dessus du seuil", severity: "critical", defaultEnabled: true, thresholdUnit: "XAF", producer: "C2" },
  { key: "top_product_stockout", label: "Rupture d'un produit phare", severity: "important", defaultEnabled: true, producer: "C2/C1" },
  { key: "outage", label: "Panne (site, paiement, canal)", severity: "critical", defaultEnabled: true, producer: "C2" },
  { key: "ad_spend_anomaly", label: "Dépense publicitaire anormale", severity: "important", defaultEnabled: false, thresholdUnit: "percent", producer: "C5" },
  { key: "unhappy_customer", label: "Client mécontent", severity: "important", defaultEnabled: false, producer: "C3" },
] as const;

export const TRIGGER_KEYS = ALERT_TRIGGERS.map((t) => t.key);
export const triggerByKey = (key: string): TriggerDef | undefined => ALERT_TRIGGERS.find((t) => t.key === key);

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure attendue au format HH:MM");

export const alertSettingsSchema = z
  .object({
    triggers: z.record(z.string(), z.object({ enabled: z.boolean(), threshold: z.number().positive().finite().optional() })).default({}),
    quietEnabled: z.boolean().default(false),
    quietStart: hhmm.default("22:00"),
    quietEnd: hhmm.default("07:00"),
    escalationDelayMinutes: z.number().int().min(1).max(1440).default(15),
    fallbackMembershipId: z.string().uuid().nullable().default(null),
  })
  .refine((s) => !s.quietEnabled || s.quietStart !== s.quietEnd, { message: "Début et fin des heures calmes identiques.", path: ["quietEnd"] })
  .refine((s) => Object.keys(s.triggers).every((k) => TRIGGER_KEYS.includes(k)), { message: "Déclencheur inconnu.", path: ["triggers"] });

export type AlertSettings = z.infer<typeof alertSettingsSchema>;

export const DEFAULT_ALERT_SETTINGS: AlertSettings = alertSettingsSchema.parse({});

/** Ligne SQL -> réglages (valeurs invalides/absentes => défauts, jamais d'exception). */
export function settingsFromRow(row: Record<string, unknown> | null | undefined): AlertSettings {
  if (!row) return DEFAULT_ALERT_SETTINGS;
  const parsed = alertSettingsSchema.safeParse({
    triggers: row.triggers ?? {},
    quietEnabled: row.quiet_enabled ?? false,
    quietStart: row.quiet_start ?? "22:00",
    quietEnd: row.quiet_end ?? "07:00",
    escalationDelayMinutes: row.escalation_delay_minutes ?? 15,
    fallbackMembershipId: row.fallback_membership_id ?? null,
  });
  return parsed.success ? parsed.data : DEFAULT_ALERT_SETTINGS;
}

export function isTriggerEnabled(settings: AlertSettings, key: string): boolean {
  const def = triggerByKey(key);
  if (!def) return false;
  return settings.triggers[key]?.enabled ?? def.defaultEnabled;
}

export function thresholdFor(settings: AlertSettings, key: string): number | undefined {
  return settings.triggers[key]?.threshold;
}

/**
 * Seuil : si un seuil est configuré ET une valeur fournie, l'alerte n'est levée
 * que si valeur >= seuil. Sans seuil configuré, on lève (pas de défaut inventé).
 */
export function passesThreshold(settings: AlertSettings, key: string, value: number | undefined): boolean {
  const threshold = thresholdFor(settings, key);
  if (threshold === undefined || value === undefined) return true;
  return value >= threshold;
}

const toMinutes = (hm: string): number => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** Minute du jour (0..1439) dans le fuseau donné ; fuseau invalide => UTC. */
export function localMinuteOfDay(date: Date, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  }
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return (h % 24) * 60 + m;
}

/** Fenêtre [début, fin) ; passe minuit si début > fin. */
export function isQuietNow(settings: AlertSettings, now: Date, timeZone: string): boolean {
  if (!settings.quietEnabled) return false;
  const start = toMinutes(settings.quietStart);
  const end = toMinutes(settings.quietEnd);
  if (start === end) return false;
  const cur = localMinuteOfDay(now, timeZone);
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

/** Prochain instant (UTC) où les heures calmes se terminent ; `now` si on n'est pas en heures calmes. */
export function nextQuietEnd(settings: AlertSettings, now: Date, timeZone: string): Date {
  if (!isQuietNow(settings, now, timeZone)) return now;
  const end = toMinutes(settings.quietEnd);
  const cur = localMinuteOfDay(now, timeZone);
  const delta = (end - cur + 1440) % 1440 || 1440;
  const floored = new Date(Math.floor(now.getTime() / 60000) * 60000);
  return new Date(floored.getTime() + delta * 60000);
}

export type LadderStep = 0 | 1 | 2 | 3;

export interface StepPlan {
  step: LadderStep;
  /** Destinataires : propriétaires/admins, ou la personne de repli. */
  audience: "owners" | "fallback" | "none";
  channels: ReadonlyArray<"push" | "telegram" | "whatsapp" | "email">;
}

/**
 * Échelle : 0 push -> 1 messageries (+ email) aux propriétaires -> 2 personne de
 * repli (tous canaux) -> 3 expirée. `info` ne monte jamais (un seul push).
 */
export function planForStep(step: LadderStep): StepPlan {
  switch (step) {
    case 0: return { step, audience: "owners", channels: ["push"] };
    case 1: return { step, audience: "owners", channels: ["telegram", "whatsapp", "email"] };
    case 2: return { step, audience: "fallback", channels: ["push", "telegram", "whatsapp", "email"] };
    default: return { step: 3, audience: "none", channels: [] };
  }
}

export function escalates(severity: AlertSeverity): boolean {
  return severity !== "info";
}

/** Critique : traverse les heures calmes. */
export function bypassesQuietHours(severity: AlertSeverity): boolean {
  return severity === "critical";
}
