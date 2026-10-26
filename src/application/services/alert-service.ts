import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getEmailProvider } from "@/infrastructure/providers/registry";
import { TelegramClient } from "@/infrastructure/providers/telegram/client";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  alertSettingsSchema,
  bypassesQuietHours,
  escalates,
  isQuietNow,
  isTriggerEnabled,
  nextQuietEnd,
  passesThreshold,
  planForStep,
  settingsFromRow,
  triggerByKey,
  type AlertSettings,
  type AlertSeverity,
  type LadderStep,
} from "@/application/alerts/alert-policy";
import { sendPushToUsers } from "./push-service";
import { createWhatsAppAlertPort } from "./whatsapp-send-service";

/**
 * Alertes propriétaire (C2, étape 4) : `raiseAlert` (lever), `notify`
 * (envoyer sur des canaux), `processDueAlerts` (relâcher les alertes retenues
 * + escalader), `acknowledgeAlert`, `saveAlertSettings`.
 *
 * Échelle : push -> Telegram/WhatsApp/email aux propriétaires -> personne de
 * repli -> expirée, avec un délai configurable entre paliers. AUCUN appel
 * téléphonique (hors périmètre).
 *
 * DONNÉES ENVOYÉES À DES TIERS (à valider côté conformité, loi camerounaise
 * 2024/017) : titre + texte de l'alerte (peuvent citer un client ou un montant)
 * partent vers : service push du navigateur (FCM/Apple/Mozilla), API Telegram,
 * Resend (email), Zernio/Meta (WhatsApp, étape 5). Rien d'autre.
 */

export type AlertChannel = "push" | "telegram" | "whatsapp" | "email" | "in_app";
export type DeliveryStatus = "sent" | "skipped" | "failed";

/** WhatsApp (branché à l'étape 5) : tant qu'aucun adaptateur n'est enregistré, le canal est « skipped ». */
export interface AlertWhatsAppPort {
  send(input: { organizationId: string; e164: string; title: string; body: string; alertId: string }): Promise<"sent" | "failed" | "skipped">;
}
let whatsappPort: AlertWhatsAppPort | null = null;
export function registerAlertWhatsApp(port: AlertWhatsAppPort | null): void { whatsappPort = port; }

export interface AlertDeps {
  db: SupabaseClient;
  push: typeof sendPushToUsers;
  telegram: Pick<TelegramClient, "sendMessage"> | null;
  email: { send(to: string, subject: string, html: string): Promise<boolean> } | null;
  getEmail: (userId: string) => Promise<string | null>;
  whatsapp: () => AlertWhatsAppPort | null;
  now: () => number;
  appUrl: string;
}

export function defaultAlertDeps(): AlertDeps {
  const db = getSupabaseServiceClient();
  return {
    db,
    push: sendPushToUsers,
    telegram: env.TELEGRAM_BOT_TOKEN ? new TelegramClient(env.TELEGRAM_BOT_TOKEN) : null,
    email: { send: async (to, subject, html) => (await (await getEmailProvider()).sendEmail({ to, subject, html })).delivered },
    getEmail: async (userId) => { const { data } = await db.auth.admin.getUserById(userId); return data?.user?.email ?? null; },
    whatsapp: () => whatsappPort ?? createWhatsAppAlertPort(undefined, env.NEXT_PUBLIC_APP_URL),
    now: () => Date.now(),
    appUrl: env.NEXT_PUBLIC_APP_URL,
  };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const iso = (ms: number) => new Date(ms).toISOString();
const safeUrl = (u: string | null | undefined) => (u && u.startsWith("/") && !u.startsWith("//") ? u : "/dashboard/alerts");
const ICON: Record<AlertSeverity, string> = { info: "ℹ️", important: "⚠️", critical: "🚨" };

interface Member { id: string; userId: string }
interface AlertRow {
  id: string; organization_id: string; trigger_key: string; severity: AlertSeverity; title: string; body: string; url: string | null;
  status: "held" | "open" | "acknowledged" | "expired"; escalation_step: number; next_escalation_at: string | null; release_at: string | null;
}

// --- Destinataires ------------------------------------------------------------

async function listOwners(db: SupabaseClient, organizationId: string): Promise<Member[]> {
  const { data, error } = await db.from("memberships").select("id, user_id").eq("organization_id", organizationId).in("role", ["owner", "admin"]);
  if (error) throw new Error(`Alertes: lecture des propriétaires impossible: ${error.message}`);
  return ((data ?? []) as { id: string; user_id: string }[]).map((m) => ({ id: m.id, userId: m.user_id }));
}

async function getFallback(db: SupabaseClient, organizationId: string, membershipId: string | null): Promise<Member | null> {
  if (!membershipId) return null;
  const { data } = await db.from("memberships").select("id, user_id").eq("organization_id", organizationId).eq("id", membershipId).maybeSingle();
  const row = data as { id: string; user_id: string } | null;
  return row ? { id: row.id, userId: row.user_id } : null;
}

// --- Réglages -------------------------------------------------------------------

export async function loadAlertSettings(db: SupabaseClient, organizationId: string): Promise<AlertSettings> {
  const { data, error } = await db.from("alert_settings").select("triggers, quiet_enabled, quiet_start, quiet_end, escalation_delay_minutes, fallback_membership_id").eq("organization_id", organizationId).maybeSingle();
  if (error) throw new Error(`Alertes: lecture des réglages impossible: ${error.message}`);
  return settingsFromRow(data as Record<string, unknown> | null);
}

/** Enregistre les réglages (propriétaire/admin vérifié par l'appelant). La personne de repli doit appartenir à l'entreprise. */
export async function saveAlertSettings(organizationId: string, input: unknown, db: SupabaseClient = getSupabaseServiceClient()): Promise<AlertSettings> {
  const parsed = alertSettingsSchema.safeParse(input);
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Réglages invalides.", 400, "validation");
  const s = parsed.data;
  if (s.fallbackMembershipId && !(await getFallback(db, organizationId, s.fallbackMembershipId))) {
    throw new AppError("La personne de repli n'appartient pas à cette entreprise.", 400, "validation");
  }
  const { error } = await db.from("alert_settings").upsert(
    { organization_id: organizationId, triggers: s.triggers, quiet_enabled: s.quietEnabled, quiet_start: s.quietStart, quiet_end: s.quietEnd, escalation_delay_minutes: s.escalationDelayMinutes, fallback_membership_id: s.fallbackMembershipId },
    { onConflict: "organization_id" },
  );
  if (error) throw new Error(`Alertes: enregistrement des réglages impossible: ${error.message}`);
  return s;
}

// --- notify() : envoi multi-canal --------------------------------------------------

export interface NotifyInput {
  organizationId: string;
  alertId: string;
  step: LadderStep;
  recipients: Member[];
  channels: ReadonlyArray<Exclude<AlertChannel, "in_app">>;
  severity: AlertSeverity;
  title: string;
  body: string;
  url?: string | null;
}

export interface NotifyResult { delivered: Record<string, number>; pushDelivered: number }

/**
 * Envoie sur les canaux demandés et journalise chaque tentative dans
 * `alert_deliveries`. Ne lève pas sur un échec de canal (chaque canal est
 * isolé) ; une panne de base de données, elle, remonte.
 */
export async function notify(input: NotifyInput, deps: AlertDeps = defaultAlertDeps()): Promise<NotifyResult> {
  const result: NotifyResult = { delivered: {}, pushDelivered: 0 };
  const log: Record<string, unknown>[] = [];
  const record = (channel: AlertChannel, status: DeliveryStatus, membershipId: string | null, reason?: string) => {
    log.push({ alert_id: input.alertId, organization_id: input.organizationId, membership_id: membershipId, channel, step: input.step, status, reason: reason?.slice(0, 200) ?? null });
    if (status === "sent") result.delivered[channel] = (result.delivered[channel] ?? 0) + 1;
  };
  const text = `${ICON[input.severity]} ${input.title}${input.body ? `\n${input.body}` : ""}`;
  const link = `${deps.appUrl}${safeUrl(input.url)}`;
  const ids = input.recipients.map((r) => r.id);

  if (input.channels.includes("push")) {
    const n = await deps.push(input.organizationId, input.recipients.map((r) => r.userId), `${ICON[input.severity]} ${input.title}`, input.body, safeUrl(input.url), { urgency: input.severity === "info" ? "normal" : "high" });
    result.pushDelivered = n;
    record("push", n > 0 ? "sent" : "skipped", null, n > 0 ? undefined : "aucun appareil atteint");
  }

  if (ids.length > 0 && (input.channels.includes("telegram") || input.channels.includes("whatsapp"))) {
    const { data, error } = await deps.db.from("channel_identities").select("membership_id, channel, external_id").eq("organization_id", input.organizationId).eq("status", "active").in("membership_id", ids);
    if (error) throw new Error(`Alertes: lecture des identités de canal impossible: ${error.message}`);
    const identities = (data ?? []) as { membership_id: string; channel: "telegram" | "whatsapp"; external_id: string }[];

    if (input.channels.includes("telegram")) {
      const tg = identities.filter((i) => i.channel === "telegram");
      if (tg.length === 0) record("telegram", "skipped", null, "aucun Telegram lié");
      for (const i of tg) {
        if (!deps.telegram) { record("telegram", "skipped", i.membership_id, "bot non configuré"); continue; }
        try {
          await deps.telegram.sendMessage({ chat_id: Number(i.external_id), text: `${text}\n\nOuvrir : ${link}`, reply_markup: { inline_keyboard: [[{ text: "✅ J'ai vu", callback_data: `al:a:${input.alertId}` }]] } });
          record("telegram", "sent", i.membership_id);
        } catch (e) { record("telegram", "failed", i.membership_id, e instanceof Error ? e.message : "erreur"); }
      }
    }
    if (input.channels.includes("whatsapp")) {
      const wa = identities.filter((i) => i.channel === "whatsapp");
      const port = deps.whatsapp();
      if (wa.length === 0) record("whatsapp", "skipped", null, "aucun WhatsApp lié");
      for (const i of wa) {
        if (!port) { record("whatsapp", "skipped", i.membership_id, "canal non configuré"); continue; }
        try { record("whatsapp", await port.send({ organizationId: input.organizationId, e164: i.external_id, title: input.title, body: input.body, alertId: input.alertId }), i.membership_id); }
        catch (e) { record("whatsapp", "failed", i.membership_id, e instanceof Error ? e.message : "erreur"); }
      }
    }
  }

  if (input.channels.includes("email")) {
    for (const r of input.recipients) {
      if (!deps.email) { record("email", "skipped", r.id, "email non configuré"); continue; }
      try {
        const to = await deps.getEmail(r.userId);
        if (!to) { record("email", "skipped", r.id, "adresse introuvable"); continue; }
        const ok = await deps.email.send(to, `${ICON[input.severity]} ${input.title}`.slice(0, 200), `<p><strong>${escapeHtml(input.title)}</strong></p><p>${escapeHtml(input.body).replace(/\n/g, "<br>")}</p><p><a href="${escapeHtml(link)}">Ouvrir dans Flexco</a></p>`);
        record("email", ok ? "sent" : "skipped", r.id, ok ? undefined : "fournisseur non configuré");
      } catch (e) { record("email", "failed", r.id, e instanceof Error ? e.message : "erreur"); }
    }
  }

  if (log.length > 0) {
    const { error } = await deps.db.from("alert_deliveries").insert(log);
    if (error) console.warn("[alertes] journal d'envois non enregistré:", error.message);
  }
  return result;
}

// --- Exécution d'un palier ---------------------------------------------------------

async function runStep(deps: AlertDeps, alert: AlertRow, step: LadderStep, settings: AlertSettings): Promise<void> {
  const plan = planForStep(step);
  if (plan.audience === "none") return;
  let recipients: Member[];
  if (plan.audience === "owners") recipients = await listOwners(deps.db, alert.organization_id);
  else { const f = await getFallback(deps.db, alert.organization_id, settings.fallbackMembershipId); recipients = f ? [f] : []; }

  if (step === 0 && recipients.length > 0) {
    await deps.db.from("notifications").insert(recipients.map((r) => ({ organization_id: alert.organization_id, recipient_user_id: r.userId, title: alert.title, body: alert.body, channel: "in_app", related_entity_type: null, related_entity_id: null })));
  }
  const res = recipients.length > 0
    ? await notify({ organizationId: alert.organization_id, alertId: alert.id, step, recipients, channels: plan.channels, severity: alert.severity, title: alert.title, body: alert.body, url: alert.url }, deps)
    : { delivered: {}, pushDelivered: 0 };

  // Planification du palier suivant. Push non reçu (0 appareil) => on n'attend pas le délai.
  const delayMs = settings.escalationDelayMinutes * 60_000;
  let next: number | null = null;
  if (escalates(alert.severity)) {
    next = step === 0 && res.pushDelivered === 0 ? deps.now() : deps.now() + delayMs;
    // Pas de personne de repli : on saute le palier 2 (il serait vide).
  }
  await deps.db.from("alerts").update({ next_escalation_at: next === null ? null : iso(next), updated_at: iso(deps.now()) }).eq("id", alert.id).eq("status", "open");
}

// --- Lever une alerte -----------------------------------------------------------------

export interface RaiseAlertInput {
  organizationId: string;
  trigger: string;
  title: string;
  body?: string;
  url?: string;
  /** Clé de déduplication (ex. id de commande) ; défaut : le déclencheur. */
  dedupeKey?: string;
  /** Valeur comparée au seuil configuré (ex. montant du remboursement en XAF). */
  value?: number;
  severity?: AlertSeverity;
}
export type RaiseAlertResult =
  | { status: "created"; alertId: string; held: boolean }
  | { status: "duplicate" | "disabled" | "below_threshold" };

export async function raiseAlert(input: RaiseAlertInput, deps: AlertDeps = defaultAlertDeps()): Promise<RaiseAlertResult> {
  const def = triggerByKey(input.trigger);
  if (!def) throw new AppError(`Déclencheur d'alerte inconnu: ${input.trigger}`, 400, "validation");
  const settings = await loadAlertSettings(deps.db, input.organizationId);
  if (!isTriggerEnabled(settings, input.trigger)) return { status: "disabled" };
  if (!passesThreshold(settings, input.trigger, input.value)) return { status: "below_threshold" };

  const severity = input.severity ?? def.severity;
  const { data: org } = await deps.db.from("organizations").select("timezone").eq("id", input.organizationId).maybeSingle();
  const tz = (org as { timezone?: string } | null)?.timezone ?? "Africa/Douala";
  const now = new Date(deps.now());
  const held = !bypassesQuietHours(severity) && isQuietNow(settings, now, tz);

  const { data, error } = await deps.db.from("alerts").insert({
    organization_id: input.organizationId, trigger_key: input.trigger, severity,
    title: input.title.slice(0, 200), body: (input.body ?? "").slice(0, 2000), url: input.url ?? null,
    dedupe_key: (input.dedupeKey ?? input.trigger).slice(0, 200), value: input.value ?? null,
    status: held ? "held" : "open", escalation_step: 0, release_at: held ? iso(nextQuietEnd(settings, now, tz).getTime()) : null,
  }).select("id, organization_id, trigger_key, severity, title, body, url, status, escalation_step, next_escalation_at, release_at").single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return { status: "duplicate" };
    throw new Error(`Alertes: création impossible: ${error.message}`);
  }
  const alert = data as AlertRow;
  if (!held) await runStep(deps, alert, 0, settings);
  return { status: "created", alertId: alert.id, held };
}

// --- Traitement périodique (cron) ---------------------------------------------------

export interface ProcessResult { released: number; escalated: number; expired: number }

export async function processDueAlerts(deps: AlertDeps = defaultAlertDeps(), batch = 50): Promise<ProcessResult> {
  const result: ProcessResult = { released: 0, escalated: 0, expired: 0 };
  const nowIso = iso(deps.now());
  const settingsCache = new Map<string, AlertSettings>();
  const settingsOf = async (org: string) => { let s = settingsCache.get(org); if (!s) { s = await loadAlertSettings(deps.db, org); settingsCache.set(org, s); } return s; };
  const cols = "id, organization_id, trigger_key, severity, title, body, url, status, escalation_step, next_escalation_at, release_at";

  // 1) Alertes retenues dont les heures calmes sont terminées. Réclamation atomique held -> open.
  const { data: held } = await deps.db.from("alerts").select(cols).eq("status", "held").lte("release_at", nowIso).order("created_at", { ascending: true }).limit(batch);
  for (const a of (held ?? []) as AlertRow[]) {
    const { data: claimed } = await deps.db.from("alerts").update({ status: "open", release_at: null }).eq("id", a.id).eq("status", "held").select("id");
    if (!claimed || (claimed as unknown[]).length === 0) continue;
    try { await runStep(deps, { ...a, status: "open" }, 0, await settingsOf(a.organization_id)); result.released += 1; }
    catch (e) { console.error(`[alertes] palier 0 en échec (${a.id}):`, e); }
  }

  // 2) Escalades dues. Réclamation atomique par (id, palier courant).
  const { data: due } = await deps.db.from("alerts").select(cols).eq("status", "open").lte("next_escalation_at", nowIso).order("next_escalation_at", { ascending: true }).limit(batch);
  for (const a of (due ?? []) as AlertRow[]) {
    const settings = await settingsOf(a.organization_id);
    let target = (a.escalation_step + 1) as LadderStep;
    if (target === 2 && !(await getFallback(deps.db, a.organization_id, settings.fallbackMembershipId))) target = 3; // palier vide : on saute
    const { data: claimed } = await deps.db.from("alerts").update({ escalation_step: target, next_escalation_at: null }).eq("id", a.id).eq("status", "open").eq("escalation_step", a.escalation_step).select("id");
    if (!claimed || (claimed as unknown[]).length === 0) continue;
    if (target >= 3) {
      await deps.db.from("alerts").update({ status: "expired" }).eq("id", a.id).eq("status", "open");
      result.expired += 1; continue;
    }
    try { await runStep(deps, { ...a, escalation_step: target }, target, settings); result.escalated += 1; }
    catch (e) { console.error(`[alertes] palier ${target} en échec (${a.id}):`, e); }
  }
  return result;
}

// --- Accusé de réception ----------------------------------------------------------------

export type AckResult = { ok: true; alreadyDone: boolean } | { ok: false; reason: "not_found" | "forbidden" };

/**
 * Accuse réception : propriétaire/admin de l'entreprise, ou personne de repli.
 * Stoppe l'escalade. Idempotent (un second accusé est un succès sans effet).
 */
export async function acknowledgeAlert(input: { alertId: string; organizationId: string; membershipId: string; via: "dashboard" | "telegram" | "whatsapp" }, deps: Pick<AlertDeps, "db" | "now"> = defaultAlertDeps()): Promise<AckResult> {
  const { data } = await deps.db.from("alerts").select("id, status").eq("id", input.alertId).eq("organization_id", input.organizationId).maybeSingle();
  const alert = data as { id: string; status: string } | null;
  if (!alert) return { ok: false, reason: "not_found" };
  const { data: m } = await deps.db.from("memberships").select("id, role").eq("id", input.membershipId).eq("organization_id", input.organizationId).maybeSingle();
  const member = m as { id: string; role: string } | null;
  if (!member) return { ok: false, reason: "forbidden" };
  if (member.role !== "owner" && member.role !== "admin") {
    const settings = await loadAlertSettings(deps.db, input.organizationId);
    if (settings.fallbackMembershipId !== member.id) return { ok: false, reason: "forbidden" };
  }
  if (alert.status === "acknowledged" || alert.status === "expired") return { ok: true, alreadyDone: true };
  const { data: upd } = await deps.db.from("alerts").update({ status: "acknowledged", acknowledged_at: iso(deps.now()), acknowledged_by: member.id, acknowledged_via: input.via, next_escalation_at: null, release_at: null }).eq("id", alert.id).in("status", ["held", "open"]).select("id");
  return { ok: true, alreadyDone: !upd || (upd as unknown[]).length === 0 };
}

// --- Lecture pour l'écran /dashboard/alerts ------------------------------------------

export interface AlertOverview {
  settings: AlertSettings;
  members: { id: string; name: string; role: string }[];
  recent: { id: string; title: string; severity: AlertSeverity; status: string; step: number; createdAt: string; acknowledgedAt: string | null; deliveries: { channel: string; status: string; step: number }[] }[];
}

export async function getAlertOverview(organizationId: string, db: SupabaseClient = getSupabaseServiceClient()): Promise<AlertOverview> {
  const [settings, mem, al] = await Promise.all([
    loadAlertSettings(db, organizationId),
    db.from("memberships").select("id, user_id, role").eq("organization_id", organizationId),
    db.from("alerts").select("id, title, severity, status, escalation_step, created_at, acknowledged_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(20),
  ]);
  if (mem.error) throw new Error(`Alertes: lecture des membres impossible: ${mem.error.message}`);
  if (al.error) throw new Error(`Alertes: lecture de l'historique impossible: ${al.error.message}`);
  const members = (mem.data ?? []) as { id: string; user_id: string; role: string }[];
  const alerts = (al.data ?? []) as { id: string; title: string; severity: AlertSeverity; status: string; escalation_step: number; created_at: string; acknowledged_at: string | null }[];
  const [profiles, deliveries] = await Promise.all([
    members.length ? db.from("profiles").select("id, full_name").in("id", members.map((m) => m.user_id)) : Promise.resolve({ data: [] as unknown[] }),
    alerts.length ? db.from("alert_deliveries").select("alert_id, channel, status, step").eq("organization_id", organizationId).in("alert_id", alerts.map((a) => a.id)) : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const names = new Map(((profiles.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? ""]));
  const dels = (deliveries.data ?? []) as { alert_id: string; channel: string; status: string; step: number }[];
  return {
    settings,
    members: members.map((m) => ({ id: m.id, name: names.get(m.user_id) || "Membre", role: m.role })),
    recent: alerts.map((a) => ({ id: a.id, title: a.title, severity: a.severity, status: a.status, step: a.escalation_step, createdAt: a.created_at, acknowledgedAt: a.acknowledged_at, deliveries: dels.filter((d) => d.alert_id === a.id).map(({ channel, status, step }) => ({ channel, status, step })) })),
  };
}
