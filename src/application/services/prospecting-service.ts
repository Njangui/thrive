import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { ZernioClient } from "@/infrastructure/providers/messaging/zernio/client";
import { toParticipantId } from "@/application/channels/whatsapp-templates";
import { ValidationError } from "@/lib/errors";
import { notifyOrgAdmins } from "./notification-service";
import {
  MAX_CSV_BYTES, PROSPECTING_TEMPLATES, campaignFingerprint, classifyProspectReply, greetingValue, isInSendingWindow, localDayKey, prepareImport,
  prospectingTemplate, remainingDailyQuota, renderTemplatePreview, type ImportReport, type ImportedProspect, type ProspectingTemplateKey,
} from "./prospecting-core";

/**
 * Agent de prospection WhatsApp. Ce service orchestre ; la logique pure est dans prospecting-core.ts.
 *
 * Règles non négociables, toutes testées :
 *  1. Rien ne part sans VALIDATION du propriétaire, liée à l'empreinte du message + de la liste + des règles. Liste ou règle
 *     modifiée après validation => la campagne est suspendue.
 *  2. Premier contact = modèle Meta APPROVED (catégorie MARKETING). Jamais de message libre hors fenêtre de 24 h.
 *  3. STOP (ou refus) = le numéro est désinscrit pour TOUTES les campagnes, définitivement ; vérifié juste avant chaque envoi.
 *  4. Plafond quotidien, plage horaire locale, pas de dimanche, 1 relance maximum.
 *  5. Trois échecs d'envoi consécutifs => campagne suspendue + propriétaires prévenus (jamais de boucle d'insistance).
 */

export type CampaignStatus = "draft" | "approved" | "running" | "paused" | "completed" | "cancelled";
export interface Campaign {
  id: string; organizationId: string; name: string; status: CampaignStatus; dailyCap: number; windowStartHour: number; windowEndHour: number;
  timezone: string; maxFollowups: number; followupDelayHours: number; defaultCountryCode: string; consentBasis: string | null; approvedFingerprint: string | null;
}
export interface ProspectRow {
  id: string; campaignId: string; fullName: string | null; company: string | null; phoneE164: string; status: string; contactedAt: string | null; followupSentAt: string | null;
}
export type TemplateStatusMap = Partial<Record<ProspectingTemplateKey, string>>;

export interface ProspectingStore {
  createCampaign(organizationId: string, userId: string, input: { name: string; dailyCap: number; windowStartHour: number; windowEndHour: number; defaultCountryCode: string }): Promise<Campaign>;
  getCampaign(organizationId: string, campaignId: string): Promise<Campaign | null>;
  listActiveCampaigns(): Promise<Campaign[]>;
  listCampaigns(organizationId: string, limit: number): Promise<Campaign[]>;
  updateCampaign(organizationId: string, campaignId: string, patch: Partial<{ status: CampaignStatus; consentBasis: string; approvedBy: string; approvedAt: string; approvedFingerprint: string | null }>): Promise<void>;
  insertProspects(organizationId: string, campaignId: string, prospects: ImportedProspect[]): Promise<void>;
  listPhones(campaignId: string): Promise<string[]>;
  countByStatus(campaignId: string): Promise<Record<string, number>>;
  listOptOuts(organizationId: string): Promise<Set<string>>;
  addOptOut(organizationId: string, phone: string, reason: "stop" | "refusal" | "manual"): Promise<void>;
  queued(campaignId: string, limit: number): Promise<ProspectRow[]>;
  followupsDue(campaignId: string, contactedBeforeIso: string, limit: number): Promise<ProspectRow[]>;
  sample(campaignId: string, limit: number): Promise<ProspectRow[]>;
  markProspect(id: string, patch: Partial<{ status: string; contactedAt: string; followupSentAt: string; lastReplyAt: string; failureReason: string | null }>): Promise<void>;
  markPhoneOptedOut(organizationId: string, phone: string): Promise<void>;
  activeProspectsByPhone(organizationId: string, phone: string): Promise<ProspectRow[]>;
  sentTimestampsSince(campaignId: string, sinceIso: string): Promise<string[]>;
  templateStatuses(organizationId: string): Promise<TemplateStatusMap>;
  upsertTemplate(organizationId: string, key: ProspectingTemplateKey, patch: { name: string; status: string; reason?: string | null; providerTemplateId?: string | null }): Promise<void>;
}

export interface ProspectingDeps {
  store: ProspectingStore;
  getAccountId: (organizationId: string) => Promise<string | null>;
  sendTemplate: (input: { accountId: string; participantId: string; templateName: string; templateLanguage: string; templateParams: string[] }) => Promise<void>;
  createTemplate: (input: { accountId: string; key: ProspectingTemplateKey }) => Promise<{ id?: string; status?: string }>;
  notify: (organizationId: string, title: string, body: string) => Promise<void>;
  now: () => Date;
}

/* ---------------------------- Campagne : création, aperçu, validation ---------------------------- */

export interface CreateCampaignInput { name: string; csv: string; dailyCap?: number; windowStartHour?: number; windowEndHour?: number; defaultCountryCode?: string }
export interface ImportSummary { campaignId: string; imported: number; invalid: number; duplicates: number; optedOut: number; truncated: boolean; extraColumns: string[]; invalidSamples: { row: number; reason: string }[] }

export async function createCampaignFromCsv(organizationId: string, userId: string, input: CreateCampaignInput, deps: ProspectingDeps): Promise<ImportSummary> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 120) throw new ValidationError("Nom de campagne : 1 à 120 caractères.");
  if (Buffer.byteLength(input.csv, "utf8") > MAX_CSV_BYTES) throw new ValidationError("Fichier trop volumineux (1 Mo maximum).");
  const country = input.defaultCountryCode ?? "237";
  if (!/^\d{1,3}$/.test(country)) throw new ValidationError("Indicatif pays invalide.");
  const start = input.windowStartHour ?? 9; const end = input.windowEndHour ?? 18;
  if (!(start >= 0 && end <= 24 && end > start)) throw new ValidationError("Plage horaire invalide.");
  const cap = input.dailyCap ?? 20;
  if (!Number.isInteger(cap) || cap < 1 || cap > 200) throw new ValidationError("Plafond quotidien : entre 1 et 200 messages.");
  const optedOut = await deps.store.listOptOuts(organizationId);
  const report = prepareImport(input.csv, { defaultCountryCode: country, optedOut });
  if (report.missingPhoneColumn) throw new ValidationError("Aucune colonne de téléphone reconnue (téléphone, phone, whatsapp, mobile, numéro…).");
  if (report.prospects.length === 0) throw new ValidationError("Aucun numéro valide dans ce fichier.");
  const campaign = await deps.store.createCampaign(organizationId, userId, { name, dailyCap: cap, windowStartHour: start, windowEndHour: end, defaultCountryCode: country });
  await deps.store.insertProspects(organizationId, campaign.id, report.prospects);
  return summarize(campaign.id, report);
}
const summarize = (campaignId: string, r: ImportReport): ImportSummary => ({ campaignId, imported: r.prospects.length, invalid: r.invalid.length, duplicates: r.duplicates, optedOut: r.optedOut, truncated: r.truncated, extraColumns: r.extraColumns, invalidSamples: r.invalid.slice(0, 5) });

async function currentFingerprint(c: Campaign, deps: ProspectingDeps): Promise<string> {
  return campaignFingerprint({ phones: await deps.store.listPhones(c.id), dailyCap: c.dailyCap, window: { timezone: c.timezone, startHour: c.windowStartHour, endHour: c.windowEndHour }, maxFollowups: c.maxFollowups, followupDelayHours: c.followupDelayHours });
}

export interface CampaignPreview {
  campaignId: string; name: string; status: CampaignStatus; fingerprint: string; counts: Record<string, number>; total: number;
  samples: { to: string; intro: string }[]; followupText: string | null; rules: string[]; templates: TemplateStatusMap; templatesReady: boolean;
}

async function mustGet(organizationId: string, campaignId: string, deps: ProspectingDeps): Promise<Campaign> {
  const c = await deps.store.getCampaign(organizationId, campaignId);
  if (!c) throw new ValidationError("Campagne introuvable.");
  return c;
}

export async function previewCampaign(organizationId: string, campaignId: string, deps: ProspectingDeps): Promise<CampaignPreview> {
  const c = await mustGet(organizationId, campaignId, deps);
  const [counts, rows, templates, fingerprint] = await Promise.all([deps.store.countByStatus(c.id), deps.store.sample(c.id, 3), deps.store.templateStatuses(organizationId), currentFingerprint(c, deps)]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    campaignId: c.id, name: c.name, status: c.status, fingerprint, counts, total,
    samples: rows.map((p) => ({ to: p.phoneE164, intro: renderTemplatePreview("intro", greetingValue(p)) })),
    followupText: c.maxFollowups > 0 ? renderTemplatePreview("followup", "…") : null,
    rules: [
      `Au plus ${c.dailyCap} messages par jour, entre ${c.windowStartHour} h et ${c.windowEndHour} h (${c.timezone}), jamais le dimanche.`,
      c.maxFollowups > 0 ? `Une seule relance, ${Math.round(c.followupDelayHours / 24)} jour(s) après le premier message, uniquement sans réponse.` : "Aucune relance.",
      "STOP ou un refus : le numéro n'est plus jamais contacté, dans aucune campagne.",
      "Trois échecs d'envoi d'affilée : la campagne se suspend et vous êtes prévenu.",
    ],
    templates, templatesReady: templates.intro === "APPROVED" && (c.maxFollowups === 0 || templates.followup === "APPROVED"),
  };
}

export async function approveCampaign(organizationId: string, userId: string, campaignId: string, input: { fingerprint: string; consentBasis: string }, deps: ProspectingDeps): Promise<void> {
  const c = await mustGet(organizationId, campaignId, deps);
  if (c.status !== "draft" && c.status !== "paused") throw new ValidationError(`Une campagne « ${c.status} » ne peut pas être validée.`);
  const consent = input.consentBasis.trim();
  if (consent.length < 10) throw new ValidationError("Indiquez la base de contact de ces numéros (ex. : clients existants, personnes ayant demandé des informations, contacts d'un salon).");
  const fp = await currentFingerprint(c, deps);
  if (fp !== input.fingerprint) throw new ValidationError("La liste ou les règles ont changé depuis l'aperçu : relisez l'aperçu actuel avant de valider.");
  await deps.store.updateCampaign(organizationId, campaignId, { status: "approved", consentBasis: consent.slice(0, 500), approvedBy: userId, approvedAt: deps.now().toISOString(), approvedFingerprint: fp });
}

export async function setCampaignStatus(organizationId: string, campaignId: string, action: "pause" | "resume" | "cancel", deps: ProspectingDeps): Promise<CampaignStatus> {
  const c = await mustGet(organizationId, campaignId, deps);
  if (c.status === "cancelled" || c.status === "completed") throw new ValidationError("Campagne terminée.");
  if (action === "cancel") { await deps.store.updateCampaign(organizationId, campaignId, { status: "cancelled" }); return "cancelled"; }
  if (action === "pause") { await deps.store.updateCampaign(organizationId, campaignId, { status: "paused" }); return "paused"; }
  // Reprise : uniquement si la validation reste valable pour l'état actuel.
  if (c.status !== "paused") throw new ValidationError("Seule une campagne suspendue peut être reprise.");
  if (!c.approvedFingerprint || c.approvedFingerprint !== (await currentFingerprint(c, deps))) throw new ValidationError("La validation n'est plus valable : relisez l'aperçu et validez à nouveau.");
  await deps.store.updateCampaign(organizationId, campaignId, { status: "approved" });
  return "approved";
}

export async function listCampaignsWithCounts(organizationId: string, deps: ProspectingDeps, limit = 20): Promise<Array<{ id: string; name: string; status: CampaignStatus; dailyCap: number; counts: Record<string, number> }>> {
  const list = await deps.store.listCampaigns(organizationId, limit);
  return Promise.all(list.map(async (c) => ({ id: c.id, name: c.name, status: c.status, dailyCap: c.dailyCap, counts: await deps.store.countByStatus(c.id) })));
}

/* ---------------------------- Modèles Meta ---------------------------- */

/** Soumet à Meta les modèles de prospection manquants (idempotent). Les textes sont fixes et sans donnée de prospect. */
export async function ensureProspectingTemplates(organizationId: string, deps: ProspectingDeps): Promise<{ ok: boolean; reason?: "no_account"; submitted: ProspectingTemplateKey[]; failed: { key: ProspectingTemplateKey; message: string }[] }> {
  const accountId = await deps.getAccountId(organizationId);
  if (!accountId) return { ok: false, reason: "no_account", submitted: [], failed: [] };
  const current = await deps.store.templateStatuses(organizationId);
  const submitted: ProspectingTemplateKey[] = []; const failed: { key: ProspectingTemplateKey; message: string }[] = [];
  for (const def of PROSPECTING_TEMPLATES) {
    if (current[def.key] && current[def.key] !== "NOT_SUBMITTED") continue;
    try {
      const r = await deps.createTemplate({ accountId, key: def.key });
      await deps.store.upsertTemplate(organizationId, def.key, { name: def.name, status: r.status ? String(r.status).toUpperCase() : "PENDING", providerTemplateId: r.id ?? null });
      submitted.push(def.key);
    } catch (e) {
      const message = (e instanceof Error ? e.message : "erreur").slice(0, 300);
      await deps.store.upsertTemplate(organizationId, def.key, { name: def.name, status: "NOT_SUBMITTED", reason: message });
      failed.push({ key: def.key, message });
    }
  }
  return { ok: true, submitted, failed };
}

/** Webhook de statut de modèle : renvoie true si le modèle est un modèle de prospection (traité ici). */
export async function applyProspectingTemplateStatus(organizationId: string, event: { name?: string; status?: string; reason?: string }, deps: ProspectingDeps): Promise<boolean> {
  const def = PROSPECTING_TEMPLATES.find((t) => t.name === event.name);
  if (!def) return false;
  const status = String(event.status ?? "PENDING").toUpperCase();
  await deps.store.upsertTemplate(organizationId, def.key, { name: def.name, status, reason: event.reason && event.reason !== "NONE" ? event.reason.slice(0, 500) : null });
  if (["REJECTED", "PAUSED", "DISABLED"].includes(status)) await deps.notify(organizationId, "Modèle de prospection refusé ou suspendu", `Le modèle « ${def.label} » est ${status === "REJECTED" ? "refusé" : "suspendu"} par Meta : la prospection ne peut pas partir tant qu'il n'est pas corrigé.`);
  return true;
}

/* ---------------------------- Envoi (cron) ---------------------------- */

export const RUN_LIMIT_PER_CAMPAIGN = 25;
export const MAX_CONSECUTIVE_FAILURES = 3;
export interface TickResult { campaigns: number; sent: number; followups: number; skipped: number; paused: number; completed: number }

export async function runProspectingTick(deps: ProspectingDeps): Promise<TickResult> {
  const result: TickResult = { campaigns: 0, sent: 0, followups: 0, skipped: 0, paused: 0, completed: 0 };
  for (const c of await deps.store.listActiveCampaigns()) {
    result.campaigns++;
    try { await tickCampaign(c, deps, result); }
    catch (e) { console.error(`prospecting: campagne ${c.id} en échec:`, e instanceof Error ? e.message : e); result.skipped++; }
  }
  return result;
}

async function pause(c: Campaign, deps: ProspectingDeps, result: TickResult, why: string): Promise<void> {
  await deps.store.updateCampaign(c.organizationId, c.id, { status: "paused" });
  await deps.notify(c.organizationId, "Campagne de prospection suspendue", `« ${c.name} » est suspendue : ${why}`);
  result.paused++;
}

async function tickCampaign(c: Campaign, deps: ProspectingDeps, result: TickResult): Promise<void> {
  const now = deps.now();
  // 1. La validation doit rester valable pour la liste et les règles ACTUELLES.
  if (!c.approvedFingerprint || c.approvedFingerprint !== (await currentFingerprint(c, deps))) return pause(c, deps, result, "la liste ou les règles ont changé depuis votre validation. Relisez l'aperçu et validez à nouveau.");
  // 2. Plage horaire locale.
  if (!isInSendingWindow(now, { timezone: c.timezone, startHour: c.windowStartHour, endHour: c.windowEndHour })) { result.skipped++; return; }
  // 3. Modèles approuvés par Meta.
  const templates = await deps.store.templateStatuses(c.organizationId);
  if (templates.intro !== "APPROVED") { result.skipped++; return; }
  const followupsAllowed = c.maxFollowups > 0 && templates.followup === "APPROVED";
  const accountId = await deps.getAccountId(c.organizationId);
  if (!accountId) { result.skipped++; return; }
  // 4. Plafond du jour (jour LOCAL), relances comprises.
  const today = localDayKey(now, c.timezone);
  const since = new Date(now.getTime() - 36 * 3600_000).toISOString();
  const sentToday = (await deps.store.sentTimestampsSince(c.id, since)).filter((t) => localDayKey(new Date(t), c.timezone) === today).length;
  let quota = Math.min(remainingDailyQuota(c.dailyCap, sentToday), RUN_LIMIT_PER_CAMPAIGN);
  if (quota <= 0) { result.skipped++; return; }

  const optOuts = await deps.store.listOptOuts(c.organizationId);
  let failures = 0;
  const send = async (p: ProspectRow, key: ProspectingTemplateKey): Promise<boolean> => {
    // Dernier contrôle juste avant l'envoi : STOP reçu entre-temps.
    const fresh = await deps.store.listOptOuts(c.organizationId);
    if (fresh.has(p.phoneE164) || optOuts.has(p.phoneE164)) { await deps.store.markProspect(p.id, { status: "opted_out" }); return false; }
    const participantId = toParticipantId(p.phoneE164);
    const def = prospectingTemplate(key);
    if (!participantId) { await deps.store.markProspect(p.id, { status: "failed", failureReason: "numéro invalide" }); return false; }
    try {
      await deps.sendTemplate({ accountId, participantId, templateName: def.name, templateLanguage: def.language, templateParams: [greetingValue(p)] });
      failures = 0;
      const stamp = deps.now().toISOString();
      await deps.store.markProspect(p.id, key === "intro" ? { status: "contacted", contactedAt: stamp, failureReason: null } : { status: "followed_up", followupSentAt: stamp });
      return true;
    } catch (e) {
      failures++;
      await deps.store.markProspect(p.id, key === "intro" ? { status: "failed", failureReason: (e instanceof Error ? e.message : "erreur").slice(0, 300) } : { failureReason: (e instanceof Error ? e.message : "erreur").slice(0, 300) });
      return false;
    }
  };

  // Relances d'abord (une seule par prospect, sans réponse, délai respecté), puis premiers messages.
  if (followupsAllowed) {
    const due = await deps.store.followupsDue(c.id, new Date(now.getTime() - c.followupDelayHours * 3600_000).toISOString(), quota);
    for (const p of due) {
      if (quota <= 0 || failures >= MAX_CONSECUTIVE_FAILURES) break;
      if (await send(p, "followup")) { result.followups++; quota--; }
    }
  }
  for (const p of await deps.store.queued(c.id, quota)) {
    if (quota <= 0 || failures >= MAX_CONSECUTIVE_FAILURES) break;
    if (await send(p, "intro")) { result.sent++; quota--; }
  }
  if (failures >= MAX_CONSECUTIVE_FAILURES) return pause(c, deps, result, "trois envois de suite ont échoué (numéro WhatsApp, modèle ou qualité du compte). Vérifiez la connexion WhatsApp avant de reprendre.");
  if (c.status === "approved") await deps.store.updateCampaign(c.organizationId, c.id, { status: "running" });

  // Terminée : plus rien en file, et plus de relance possible.
  const counts = await deps.store.countByStatus(c.id);
  const waiting = (counts.queued ?? 0) + (followupsAllowed ? counts.contacted ?? 0 : 0);
  if (waiting === 0) { await deps.store.updateCampaign(c.organizationId, c.id, { status: "completed" }); result.completed++; }
}

/* ---------------------------- Réponses entrantes ---------------------------- */

export type InboundProspectOutcome = { isProspect: false } | { isProspect: true; kind: "opt_out" | "refusal" | "interested" | "other" };

/** Appelé pour chaque message WhatsApp entrant du tenant Flexco. Ne répond pas lui-même : l'assistant (persona commerciale) répond ensuite. */
export async function recordProspectInbound(organizationId: string, phoneE164: string, text: string, deps: ProspectingDeps): Promise<InboundProspectOutcome> {
  const rows = await deps.store.activeProspectsByPhone(organizationId, phoneE164);
  if (rows.length === 0) return { isProspect: false };
  const kind = classifyProspectReply(text);
  const stamp = deps.now().toISOString();
  if (kind === "opt_out" || kind === "refusal") {
    await deps.store.addOptOut(organizationId, phoneE164, kind === "opt_out" ? "stop" : "refusal");
    await deps.store.markPhoneOptedOut(organizationId, phoneE164);
    return { isProspect: true, kind };
  }
  for (const p of rows) await deps.store.markProspect(p.id, { status: kind === "interested" ? "interested" : "replied", lastReplyAt: stamp });
  return { isProspect: true, kind };
}

/* ---------------------------- Implémentation réelle ---------------------------- */

type Row = Record<string, unknown>;
const toCampaign = (r: Row): Campaign => ({
  id: r.id as string, organizationId: r.organization_id as string, name: r.name as string, status: r.status as CampaignStatus, dailyCap: r.daily_cap as number,
  windowStartHour: r.window_start_hour as number, windowEndHour: r.window_end_hour as number, timezone: r.timezone as string, maxFollowups: r.max_followups as number,
  followupDelayHours: r.followup_delay_hours as number, defaultCountryCode: r.default_country_code as string, consentBasis: (r.consent_basis as string) ?? null, approvedFingerprint: (r.approved_fingerprint as string) ?? null,
});
const toProspect = (r: Row): ProspectRow => ({ id: r.id as string, campaignId: r.campaign_id as string, fullName: (r.full_name as string) ?? null, company: (r.company as string) ?? null, phoneE164: r.phone_e164 as string, status: r.status as string, contactedAt: (r.contacted_at as string) ?? null, followupSentAt: (r.followup_sent_at as string) ?? null });
const PCOLS = "id, campaign_id, full_name, company, phone_e164, status, contacted_at, followup_sent_at";
const must = <T>(res: { data: T | null; error: { message: string } | null }, what: string): T => { if (res.error) throw new Error(`Prospection: ${what}: ${res.error.message}`); return res.data as T; };

export function createSupabaseProspectingStore(db: SupabaseClient = getSupabaseServiceClient()): ProspectingStore {
  return {
    async createCampaign(organizationId, userId, i) {
      return toCampaign(must(await db.from("prospect_campaigns").insert({ organization_id: organizationId, created_by: userId, name: i.name, daily_cap: i.dailyCap, window_start_hour: i.windowStartHour, window_end_hour: i.windowEndHour, default_country_code: i.defaultCountryCode }).select("*").single(), "création") as Row);
    },
    async getCampaign(organizationId, campaignId) {
      const d = must(await db.from("prospect_campaigns").select("*").eq("organization_id", organizationId).eq("id", campaignId).maybeSingle(), "lecture") as Row | null;
      return d ? toCampaign(d) : null;
    },
    async listCampaigns(organizationId, limit) { return (must(await db.from("prospect_campaigns").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(limit), "liste") as Row[]).map(toCampaign); },
    async listActiveCampaigns() { return (must(await db.from("prospect_campaigns").select("*").in("status", ["approved", "running"]), "liste") as Row[]).map(toCampaign); },
    async updateCampaign(organizationId, campaignId, p) {
      const patch: Row = {};
      if (p.status) patch.status = p.status;
      if (p.consentBasis !== undefined) patch.consent_basis = p.consentBasis;
      if (p.approvedBy) patch.approved_by = p.approvedBy;
      if (p.approvedAt) patch.approved_at = p.approvedAt;
      if (p.approvedFingerprint !== undefined) patch.approved_fingerprint = p.approvedFingerprint;
      must(await db.from("prospect_campaigns").update(patch).eq("organization_id", organizationId).eq("id", campaignId).select("id"), "mise à jour");
    },
    async insertProspects(organizationId, campaignId, prospects) {
      for (let i = 0; i < prospects.length; i += 200) {
        const chunk = prospects.slice(i, i + 200).map((p) => ({ organization_id: organizationId, campaign_id: campaignId, full_name: p.fullName, company: p.company, sector: p.sector, city: p.city, phone_e164: p.phoneE164, email: p.email, extra: p.extra }));
        must(await db.from("prospects").upsert(chunk, { onConflict: "campaign_id,phone_e164", ignoreDuplicates: true }).select("id"), "import");
      }
    },
    async listPhones(campaignId) { return (must(await db.from("prospects").select("phone_e164").eq("campaign_id", campaignId).limit(5000), "numéros") as Row[]).map((r) => r.phone_e164 as string); },
    async countByStatus(campaignId) {
      const out: Record<string, number> = {};
      for (const r of must(await db.from("prospects").select("status").eq("campaign_id", campaignId).limit(5000), "comptage") as Row[]) out[r.status as string] = (out[r.status as string] ?? 0) + 1;
      return out;
    },
    async listOptOuts(organizationId) { return new Set((must(await db.from("prospect_opt_outs").select("phone_e164").eq("organization_id", organizationId).limit(50000), "désinscriptions") as Row[]).map((r) => r.phone_e164 as string)); },
    async addOptOut(organizationId, phone, reason) { must(await db.from("prospect_opt_outs").upsert({ organization_id: organizationId, phone_e164: phone, reason }, { onConflict: "organization_id,phone_e164", ignoreDuplicates: true }).select("phone_e164"), "désinscription"); },
    async queued(campaignId, limit) { return (must(await db.from("prospects").select(PCOLS).eq("campaign_id", campaignId).eq("status", "queued").order("created_at").limit(limit), "file") as Row[]).map(toProspect); },
    async followupsDue(campaignId, before, limit) { return (must(await db.from("prospects").select(PCOLS).eq("campaign_id", campaignId).eq("status", "contacted").is("followup_sent_at", null).lte("contacted_at", before).order("contacted_at").limit(limit), "relances") as Row[]).map(toProspect); },
    async sample(campaignId, limit) { return (must(await db.from("prospects").select(PCOLS).eq("campaign_id", campaignId).order("created_at").limit(limit), "échantillon") as Row[]).map(toProspect); },
    async markProspect(id, p) {
      const patch: Row = {};
      if (p.status) patch.status = p.status;
      if (p.contactedAt) patch.contacted_at = p.contactedAt;
      if (p.followupSentAt) patch.followup_sent_at = p.followupSentAt;
      if (p.lastReplyAt) patch.last_reply_at = p.lastReplyAt;
      if (p.failureReason !== undefined) patch.failure_reason = p.failureReason;
      must(await db.from("prospects").update(patch).eq("id", id).select("id"), "mise à jour du prospect");
    },
    async markPhoneOptedOut(organizationId, phone) { must(await db.from("prospects").update({ status: "opted_out" }).eq("organization_id", organizationId).eq("phone_e164", phone).not("status", "in", "(opted_out,converted)").select("id"), "désinscription"); },
    async activeProspectsByPhone(organizationId, phone) { return (must(await db.from("prospects").select(PCOLS).eq("organization_id", organizationId).eq("phone_e164", phone).in("status", ["queued", "contacted", "followed_up", "replied", "interested"]), "recherche") as Row[]).map(toProspect); },
    async sentTimestampsSince(campaignId, since) {
      const rows = must(await db.from("prospects").select("contacted_at, followup_sent_at").eq("campaign_id", campaignId).or(`contacted_at.gte.${since},followup_sent_at.gte.${since}`).limit(5000), "envois") as Row[];
      const out: string[] = [];
      for (const r of rows) for (const k of ["contacted_at", "followup_sent_at"]) { const v = r[k] as string | null; if (v && v >= since) out.push(v); }
      return out;
    },
    async templateStatuses(organizationId) {
      const out: TemplateStatusMap = {};
      for (const r of must(await db.from("prospecting_templates").select("template_key, status").eq("organization_id", organizationId), "modèles") as Row[]) out[r.template_key as ProspectingTemplateKey] = r.status as string;
      return out;
    },
    async upsertTemplate(organizationId, key, p) { must(await db.from("prospecting_templates").upsert({ organization_id: organizationId, template_key: key, name: p.name, status: p.status, reason: p.reason ?? null, provider_template_id: p.providerTemplateId ?? null, updated_at: new Date().toISOString() }, { onConflict: "organization_id,template_key" }).select("template_key"), "modèle"); },
  };
}

export function defaultProspectingDeps(): ProspectingDeps {
  const db = getSupabaseServiceClient();
  const client = new ZernioClient();
  return {
    store: createSupabaseProspectingStore(db),
    getAccountId: async (org) => {
      const { data, error } = await db.from("whatsapp_accounts").select("account_id, is_primary").eq("organization_id", org).eq("status", "connected").order("is_primary", { ascending: false }).limit(1);
      if (error) throw new Error(`Prospection: lecture du compte WhatsApp impossible: ${error.message}`);
      return ((data ?? [])[0] as { account_id: string } | undefined)?.account_id ?? null;
    },
    sendTemplate: async (i) => { await client.startConversationWithTemplate({ accountId: i.accountId, participantId: i.participantId, templateName: i.templateName, templateLanguage: i.templateLanguage, templateParams: i.templateParams }); },
    createTemplate: async ({ accountId, key }) => {
      const def = prospectingTemplate(key);
      return client.createWhatsAppTemplate({ accountId, name: def.name, category: def.category, language: def.language, components: [{ type: "body", text: def.body, example: { body_text: [def.example] } }] });
    },
    notify: async (organizationId, title, body) => { await notifyOrgAdmins({ organizationId, title, body, relatedEntityType: "provider_connection", priority: "important" }); },
    now: () => new Date(),
  };
}
