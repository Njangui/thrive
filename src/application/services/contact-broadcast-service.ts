import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getMessagingProviderForChannel } from "@/infrastructure/providers/registry";
import { NotFoundError, QuotaExceededError, ValidationError } from "@/lib/errors";
import { assertGatedFeature } from "./feature-gate-service";
import { isFeatureEnabled } from "./entitlements-service";
import { notifyOrgAdmins } from "./notification-service";

/**
 * Lot O — diffusion d'une annonce vers des CONTACTS (Starter 50, Pro 100
 * contacts par campagne — `broadcast_contacts`). Distincte de la
 * diffusion vers des groupes WhatsApp (whatsapp-group-service.ts).
 *
 * Règles de sécurité et de conformité codées ici :
 *  - Un contact = une seule ligne par campagne (le plus récemment actif).
 *  - Désinscription : `contacts.broadcast_opt_out` exclut le contact ;
 *    répondre STOP le positionne (voir inbound-auto-reply-service.ts).
 *  - WhatsApp / Messenger / Instagram : la règle Meta des 24 h s'applique
 *    — un message libre n'est envoyé qu'à un contact qui a écrit dans les
 *    dernières 24 h ; sinon le destinataire est `skipped` avec le motif.
 *    (Les modèles de message WhatsApp approuvés ne sont pas pris en charge.)
 *  - Telegram : pas de fenêtre (le contact a démarré le bot).
 *  - Plafond de campagnes par jour et par organisation (anti-abus).
 */
export const BROADCAST_CHANNELS = ["telegram", "whatsapp", "facebook", "instagram"] as const;
export type BroadcastChannel = (typeof BROADCAST_CHANNELS)[number];

export const BROADCAST_CHANNEL_LABELS: Record<BroadcastChannel, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  facebook: "Messenger",
  instagram: "Instagram",
};

export const MAX_BROADCASTS_PER_DAY = 5;
export const MAX_BROADCAST_CONTENT_LENGTH = 1000;
/** Destinataires traités par exécution du cron (une fonction serverless reste courte). */
export const RECIPIENTS_PER_RUN = 40;
export const UNLIMITED_BROADCAST_HARD_CAP = 500;
/** Fenêtre de messagerie libre imposée par Meta. */
export const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

const CHANNELS_WITH_WINDOW = new Set<string>(["whatsapp", "facebook", "instagram"]);
const OPT_OUT_PATTERN = /^\s*(stop|arr[eê]t|arr[eê]ter|d[eé]sabonner|d[eé]sabonnement|unsubscribe)\s*[.!]?\s*$/i;

/** « STOP » (et variantes) = désinscription des diffusions. */
export function detectBroadcastOptOut(content: string): boolean {
  return OPT_OUT_PATTERN.test(content);
}

/** Le contact a-t-il écrit dans la fenêtre de 24 h ? (Canaux sans fenêtre : toujours vrai.) */
export function isWithinMessagingWindow(channel: string, lastInboundAt: string | null, now = new Date()): boolean {
  if (!CHANNELS_WITH_WINDOW.has(channel)) return true;
  if (!lastInboundAt) return false;
  return now.getTime() - new Date(lastInboundAt).getTime() <= MESSAGING_WINDOW_MS;
}

/** `datetime-local` (sans fuseau) interprété en heure de Douala (UTC+1) ; vide = maintenant. */
export function parseDoualaLocalDateTime(value: string | null | undefined, now = new Date()): Date {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return now;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(trimmed);
  const normalized = hasZone ? trimmed : `${trimmed.length === 16 ? `${trimmed}:00` : trimmed}+01:00`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new ValidationError("La date d'envoi est invalide.");
  return date;
}

/** Plafond effectif de contacts par campagne (−1 illimité → plafond dur de sécurité). */
export function effectiveRecipientCap(limit: number): number {
  return limit === -1 ? UNLIMITED_BROADCAST_HARD_CAP : Math.max(0, limit);
}

export interface BroadcastAudience {
  channels: BroadcastChannel[];
  /** Contacts actifs (au moins un message) dans les N derniers jours. */
  recentDays: number;
}

export interface AudienceCandidate {
  contactId: string;
  conversationId: string;
  channel: BroadcastChannel;
  lastMessageAt: string;
}

/** Un candidat par contact (le plus récent), triés du plus récent au plus ancien, plafonnés. */
export function pickRecipients(candidates: AudienceCandidate[], cap: number): AudienceCandidate[] {
  const byContact = new Map<string, AudienceCandidate>();
  for (const candidate of [...candidates].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))) {
    if (!byContact.has(candidate.contactId)) byContact.set(candidate.contactId, candidate);
  }
  return [...byContact.values()].slice(0, cap);
}

function validateAudience(audience: BroadcastAudience): BroadcastAudience {
  const channels = [...new Set(audience.channels)].filter((c): c is BroadcastChannel => (BROADCAST_CHANNELS as readonly string[]).includes(c));
  if (channels.length === 0) throw new ValidationError("Choisissez au moins un canal d'envoi.");
  const recentDays = Math.min(365, Math.max(1, Math.floor(audience.recentDays || 30)));
  return { channels, recentDays };
}

async function loadCandidates(organizationId: string, audience: BroadcastAudience): Promise<AudienceCandidate[]> {
  const supabase = getSupabaseServiceClient();
  const since = new Date(Date.now() - audience.recentDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("conversations")
    .select("id, channel, contact_id, last_message_at, contacts!inner(id, broadcast_opt_out)")
    .eq("organization_id", organizationId)
    .in("channel", audience.channels)
    .gte("last_message_at", since)
    .eq("contacts.broadcast_opt_out", false)
    .order("last_message_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(`Lecture des contacts impossible: ${error.message}`);
  return (data ?? []).map((row) => ({
    contactId: row.contact_id as string,
    conversationId: row.id as string,
    channel: row.channel as BroadcastChannel,
    lastMessageAt: row.last_message_at as string,
  }));
}

export interface AudiencePreview {
  total: number;
  cap: number;
  selected: number;
  byChannel: Record<string, number>;
}

export async function previewBroadcastAudience(organizationId: string, audience: BroadcastAudience): Promise<AudiencePreview> {
  const valid = validateAudience(audience);
  const { limit } = await isFeatureEnabled(organizationId, "broadcast_contacts");
  const cap = effectiveRecipientCap(limit);
  const candidates = await loadCandidates(organizationId, valid);
  const uniqueTotal = new Set(candidates.map((c) => c.contactId)).size;
  const picked = pickRecipients(candidates, cap);
  const byChannel: Record<string, number> = {};
  for (const item of picked) byChannel[item.channel] = (byChannel[item.channel] ?? 0) + 1;
  return { total: uniqueTotal, cap, selected: picked.length, byChannel };
}

export interface CreateContactBroadcastInput {
  organizationId: string;
  actorUserId: string;
  name: string;
  content: string;
  audience: BroadcastAudience;
  scheduledFor?: string | null;
}

export async function createContactBroadcast(input: CreateContactBroadcastInput): Promise<{ broadcastId: string; recipients: number }> {
  await assertGatedFeature(input.organizationId, "contact_broadcasts");
  const name = input.name.trim();
  const content = input.content.trim();
  if (name.length < 2 || name.length > 80) throw new ValidationError("Le nom de la campagne doit contenir entre 2 et 80 caractères.");
  if (!content) throw new ValidationError("Le message est requis.");
  if (content.length > MAX_BROADCAST_CONTENT_LENGTH) throw new ValidationError(`Le message ne peut pas dépasser ${MAX_BROADCAST_CONTENT_LENGTH} caractères.`);
  const audience = validateAudience(input.audience);
  const scheduledAt = parseDoualaLocalDateTime(input.scheduledFor);

  const supabase = getSupabaseServiceClient();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count: todayCount } = await supabase
    .from("contact_broadcasts")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", input.organizationId)
    .neq("status", "cancelled")
    .gte("created_at", startOfDay.toISOString());
  if ((todayCount ?? 0) >= MAX_BROADCASTS_PER_DAY) {
    throw new QuotaExceededError(`Limite de ${MAX_BROADCASTS_PER_DAY} campagnes par jour atteinte. Réessayez demain.`);
  }

  const { limit } = await isFeatureEnabled(input.organizationId, "broadcast_contacts");
  const picked = pickRecipients(await loadCandidates(input.organizationId, audience), effectiveRecipientCap(limit));
  if (picked.length === 0) throw new ValidationError("Aucun contact éligible (actif récemment, non désinscrit) sur ces canaux.");

  const { data: broadcast, error } = await supabase
    .from("contact_broadcasts")
    .insert({
      organization_id: input.organizationId,
      name,
      content,
      channels: audience.channels,
      audience,
      scheduled_at: scheduledAt.toISOString(),
      status: "scheduled",
      total_recipients: picked.length,
      created_by: input.actorUserId,
    })
    .select("id")
    .single();
  if (error || !broadcast) throw new Error(`Création de la campagne impossible: ${error?.message}`);

  const { error: recipientsError } = await supabase.from("contact_broadcast_recipients").insert(
    picked.map((item) => ({
      organization_id: input.organizationId,
      broadcast_id: broadcast.id,
      contact_id: item.contactId,
      conversation_id: item.conversationId,
      channel: item.channel,
      status: "pending",
    })),
  );
  if (recipientsError) {
    await supabase.from("contact_broadcasts").delete().eq("id", broadcast.id);
    throw new Error(`Enregistrement des destinataires impossible: ${recipientsError.message}`);
  }
  return { broadcastId: broadcast.id as string, recipients: picked.length };
}

export async function cancelContactBroadcast(organizationId: string, broadcastId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("contact_broadcasts")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", broadcastId)
    .eq("organization_id", organizationId)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Annulation impossible: ${error.message}`);
  if (!data) throw new NotFoundError("Campagne introuvable ou déjà en cours d'envoi.");
  await supabase.from("contact_broadcast_recipients").update({ status: "skipped", error_message: "Campagne annulée" }).eq("broadcast_id", broadcastId).eq("status", "pending");
}

export interface ContactBroadcastSummary {
  id: string;
  name: string;
  content: string;
  channels: string[];
  scheduledAt: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
}

export async function listContactBroadcasts(organizationId: string, limit = 30): Promise<ContactBroadcastSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("contact_broadcasts")
    .select("id, name, content, channels, scheduled_at, status, total_recipients, sent_count, failed_count, skipped_count")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Lecture des campagnes impossible: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    content: row.content as string,
    channels: (row.channels as string[]) ?? [],
    scheduledAt: row.scheduled_at as string,
    status: row.status as string,
    total: row.total_recipients as number,
    sent: row.sent_count as number,
    failed: row.failed_count as number,
    skipped: row.skipped_count as number,
  }));
}

interface RecipientRow {
  id: string;
  contact_id: string;
  conversation_id: string | null;
  channel: string;
  conversations: { external_thread_id: string; provider_account_id: string | null } | { external_thread_id: string; provider_account_id: string | null }[] | null;
  contacts: { phone_e164: string | null; broadcast_opt_out: boolean } | { phone_e164: string | null; broadcast_opt_out: boolean }[] | null;
}

const first = <T,>(value: T | T[] | null): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

async function sendToRecipient(organizationId: string, content: string, broadcastId: string, recipient: RecipientRow, now: Date): Promise<{ status: "sent" | "skipped" | "failed"; error?: string }> {
  const supabase = getSupabaseServiceClient();
  const conversation = first(recipient.conversations);
  const contact = first(recipient.contacts);
  if (!conversation || !recipient.conversation_id) return { status: "skipped", error: "Conversation introuvable." };
  if (contact?.broadcast_opt_out) return { status: "skipped", error: "Contact désinscrit des diffusions." };

  if (CHANNELS_WITH_WINDOW.has(recipient.channel)) {
    const { data: lastInbound } = await supabase
      .from("messages")
      .select("created_at")
      .eq("conversation_id", recipient.conversation_id)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!isWithinMessagingWindow(recipient.channel, (lastInbound?.created_at as string | undefined) ?? null, now)) {
      return { status: "skipped", error: "Hors fenêtre de 24 h (règle Meta) : le contact n'a pas écrit récemment." };
    }
  }

  try {
    const provider = await getMessagingProviderForChannel(organizationId, recipient.channel, conversation.provider_account_id);
    await provider.sendMessage(organizationId, {
      to: contact?.phone_e164 && recipient.channel === "whatsapp" ? contact.phone_e164 : conversation.external_thread_id,
      channel: recipient.channel as "whatsapp" | "telegram" | "facebook" | "instagram",
      content,
      externalThreadId: conversation.external_thread_id,
    });
    await supabase.from("messages").insert({
      organization_id: organizationId,
      conversation_id: recipient.conversation_id,
      direction: "outbound",
      sender: "human",
      content,
      metadata: { broadcast_id: broadcastId },
    });
    return { status: "sent" };
  } catch (error) {
    return { status: "failed", error: (error instanceof Error ? error.message : String(error)).slice(0, 300) };
  }
}

/**
 * Cron : envoie les diffusions arrivées à échéance, par lots (reprise au
 * passage suivant tant qu'il reste des destinataires `pending`).
 */
export async function processDueContactBroadcasts(now = new Date()): Promise<{ broadcasts: number; sent: number; failed: number; skipped: number }> {
  const supabase = getSupabaseServiceClient();
  const totals = { broadcasts: 0, sent: 0, failed: 0, skipped: 0 };

  const { data: due, error } = await supabase
    .from("contact_broadcasts")
    .select("id, organization_id, content, name, status")
    .in("status", ["scheduled", "processing"])
    .lte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(5);
  if (error) throw new Error(`Lecture des campagnes échues impossible: ${error.message}`);

  for (const broadcast of due ?? []) {
    // Prise en charge atomique d'une campagne « scheduled » ; une campagne déjà « processing » se poursuit.
    if (broadcast.status === "scheduled") {
      const { data: claimed } = await supabase.from("contact_broadcasts").update({ status: "processing" }).eq("id", broadcast.id).eq("status", "scheduled").select("id").maybeSingle();
      if (!claimed) continue;
    }
    totals.broadcasts++;

    const { data: recipients } = await supabase
      .from("contact_broadcast_recipients")
      .select("id, contact_id, conversation_id, channel, conversations(external_thread_id, provider_account_id), contacts(phone_e164, broadcast_opt_out)")
      .eq("broadcast_id", broadcast.id)
      .eq("status", "pending")
      .limit(RECIPIENTS_PER_RUN);

    for (const recipient of (recipients ?? []) as unknown as RecipientRow[]) {
      const outcome = await sendToRecipient(broadcast.organization_id as string, broadcast.content as string, broadcast.id as string, recipient, now);
      await supabase
        .from("contact_broadcast_recipients")
        .update({ status: outcome.status, error_message: outcome.error ?? null, sent_at: outcome.status === "sent" ? new Date().toISOString() : null })
        .eq("id", recipient.id);
      totals[outcome.status === "sent" ? "sent" : outcome.status]++;
    }

    // Recalcul depuis la base (source de vérité) puis clôture s'il ne reste plus de `pending`.
    const counts = await countRecipients(broadcast.id as string);
    const done = counts.pending === 0;
    const status = !done ? "processing" : counts.sent === 0 ? "failed" : counts.failed > 0 || counts.skipped > 0 ? "partial" : "completed";
    await supabase
      .from("contact_broadcasts")
      .update({ status, sent_count: counts.sent, failed_count: counts.failed, skipped_count: counts.skipped, ...(done ? { completed_at: new Date().toISOString() } : {}) })
      .eq("id", broadcast.id);
    if (done) {
      await notifyOrgAdmins({
        organizationId: broadcast.organization_id as string,
        title: "Diffusion terminée.",
        body: `« ${broadcast.name} » : ${counts.sent} envoyé(s), ${counts.skipped} ignoré(s), ${counts.failed} échec(s).`,
        relatedEntityType: "contact_broadcast",
        relatedEntityId: broadcast.id as string,
        priority: "normal",
      }).catch(() => undefined);
    }
  }
  return totals;
}

async function countRecipients(broadcastId: string): Promise<Record<"pending" | "sent" | "failed" | "skipped", number>> {
  const supabase = getSupabaseServiceClient();
  const result = { pending: 0, sent: 0, failed: 0, skipped: 0 };
  const { data } = await supabase.from("contact_broadcast_recipients").select("status").eq("broadcast_id", broadcastId);
  for (const row of data ?? []) {
    const status = row.status as keyof typeof result;
    if (status in result) result[status]++;
  }
  return result;
}
