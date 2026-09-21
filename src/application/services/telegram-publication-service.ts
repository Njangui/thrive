import { assertPublicationMediaAvailable } from "./catalog-video-service";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getMessagingProvider } from "@/infrastructure/providers/registry";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { notifyOrgAdmins } from "./notification-service";

export type TelegramPublicationStatus = "scheduled" | "processing" | "published" | "failed" | "cancelled";

export interface CreateTelegramPublicationInput {
  organizationId: string;
  actorUserId: string;
  content: string;
  targetChatId: string;
  targetLabel?: string | null;
  scheduledFor?: string | null;
  attachmentUrl?: string | null;
  attachmentType?: "image" | "video" | "audio" | "file" | null;
  /** Boutons inline (voir migration 0065) — optionnel, uniquement rempli par le chemin catalogue (omnichannel-publication-service.ts). */
  buttons?: { text: string; url: string }[] | null;
}

export interface TelegramPublicationItem {
  id: string;
  content: string;
  targetChatId: string;
  targetLabel: string | null;
  scheduledFor: string | null;
  status: TelegramPublicationStatus;
  attachmentUrl: string | null;
  attachmentType: string | null;
  buttons: { text: string; url: string }[] | null;
  telegramMessageId: number | null;
  errorMessage: string | null;
  createdAt: string;
}

function normalizeChatId(value: string): string {
  const chatId = value.trim();
  if (!chatId) throw new ValidationError("Le destinataire Telegram est requis.");
  if (chatId.length > 255) throw new ValidationError("Le destinataire Telegram est trop long.");
  return chatId;
}

function validateContent(content: string): string {
  const value = content.trim();
  if (!value) throw new ValidationError("Le contenu de la publication est requis.");
  if (value.length > 4096) throw new ValidationError("Une publication Telegram ne peut pas dépasser 4096 caractères.");
  return value;
}

function mapRow(row: Record<string, unknown>): TelegramPublicationItem {
  return {
    id: String(row.id),
    content: String(row.content),
    targetChatId: String(row.target_chat_id),
    targetLabel: (row.target_label as string | null) ?? null,
    scheduledFor: (row.scheduled_for as string | null) ?? null,
    status: row.status as TelegramPublicationStatus,
    attachmentUrl: (row.attachment_url as string | null) ?? null,
    attachmentType: (row.attachment_type as string | null) ?? null,
    buttons: (row.buttons as { text: string; url: string }[] | null) ?? null,
    telegramMessageId: typeof row.telegram_message_id === "number" ? row.telegram_message_id : null,
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

async function sendTelegramPublication(
  organizationId: string,
  publication: Pick<TelegramPublicationItem, "targetChatId" | "content" | "attachmentUrl" | "attachmentType" | "buttons"> & { botId?: string | null },
): Promise<number> {
  // Au JOUR de la publication : la vidéo est relue chez Zernio par notre
  // serveur puis envoyée à Telegram. Si le fichier a expiré (Zernio ne le
  // garde que 7 jours), on échoue AVANT tout envoi avec un message clair —
  // la publication passe « échouée » et le commerçant est notifié.
  if (publication.attachmentUrl) {
    await assertPublicationMediaAvailable(organizationId, [publication.attachmentUrl], null);
  }
  const provider = await getMessagingProvider(organizationId, "telegram", publication.botId ?? undefined);
  const result = await provider.sendMessage(organizationId, {
    to: publication.targetChatId,
    channel: "telegram",
    content: publication.content,
    attachmentUrl: publication.attachmentUrl ?? undefined,
    attachmentType: (publication.attachmentType as "image" | "video" | "audio" | "file" | undefined) ?? undefined,
    // Vidéos / audios / fichiers : téléversés depuis notre serveur (50 Mo,
    // tous formats) plutôt que donnés par URL (20 Mo). Les images restent par URL.
    uploadBinary: Boolean(publication.attachmentUrl && publication.attachmentType && publication.attachmentType !== "image"),
    buttons: publication.buttons ?? undefined,
  });
  return Number(result.providerMessageId);
}

export async function createTelegramPublication(input: CreateTelegramPublicationInput): Promise<TelegramPublicationItem> {
  const content = validateContent(input.content);
  const targetChatId = normalizeChatId(input.targetChatId);
  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;

  if (scheduledFor && Number.isNaN(scheduledFor.getTime())) {
    throw new ValidationError("La date de publication est invalide.");
  }
  if (scheduledFor && scheduledFor.getTime() <= Date.now() + 30_000) {
    throw new ValidationError("Choisissez une date future pour programmer la publication.");
  }

  const status: TelegramPublicationStatus = scheduledFor ? "scheduled" : "published";
  const supabase = getSupabaseServiceClient();

  if (!scheduledFor) {
    let telegramMessageId: number;
    try {
      telegramMessageId = await sendTelegramPublication(input.organizationId, {
        targetChatId,
        content,
        attachmentUrl: input.attachmentUrl ?? null,
        attachmentType: input.attachmentType ?? null,
        buttons: input.buttons ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const { data: failed, error: insertError } = await supabase
        .from("telegram_publications")
        .insert({
          organization_id: input.organizationId,
          created_by: input.actorUserId,
          content,
          target_chat_id: targetChatId,
          target_label: input.targetLabel?.trim() || null,
          status: "failed",
          attachment_url: input.attachmentUrl ?? null,
          attachment_type: input.attachmentType ?? null,
          buttons: input.buttons ?? null,
          error_message: message,
        })
        .select("*")
        .single();
      if (insertError || !failed) throw new Error(`Publication Telegram échouée: ${message}`);
      await notifyOrgAdmins({
        organizationId: input.organizationId,
        title: "Publication Telegram échouée.",
        body: `La publication vers ${targetChatId} n'a pas pu être envoyée. ${message}`,
        relatedEntityType: "telegram_publication",
        relatedEntityId: String(failed.id),
        priority: "important",
      });
      return mapRow(failed);
    }

    const { data, error } = await supabase
      .from("telegram_publications")
      .insert({
        organization_id: input.organizationId,
        created_by: input.actorUserId,
        content,
        target_chat_id: targetChatId,
        target_label: input.targetLabel?.trim() || null,
        status,
        telegram_message_id: telegramMessageId,
        attachment_url: input.attachmentUrl ?? null,
        attachment_type: input.attachmentType ?? null,
        buttons: input.buttons ?? null,
      })
      .select("*")
      .single();
    if (error || !data) throw new Error(`Publication Telegram envoyée mais impossible à enregistrer: ${error?.message}`);
    await notifyOrgAdmins({
      organizationId: input.organizationId,
      title: "Publication Telegram envoyée.",
      body: `La publication a été envoyée vers ${input.targetLabel?.trim() || targetChatId}.`,
      relatedEntityType: "telegram_publication",
      relatedEntityId: String(data.id),
      priority: "normal",
    });
    return mapRow(data);
  }

  const { data, error } = await supabase
    .from("telegram_publications")
    .insert({
      organization_id: input.organizationId,
      created_by: input.actorUserId,
      content,
      target_chat_id: targetChatId,
      target_label: input.targetLabel?.trim() || null,
      status: "scheduled",
      scheduled_for: scheduledFor.toISOString(),
      attachment_url: input.attachmentUrl ?? null,
      attachment_type: input.attachmentType ?? null,
      buttons: input.buttons ?? null,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`Impossible de programmer la publication Telegram: ${error?.message}`);
  await notifyOrgAdmins({
    organizationId: input.organizationId,
    title: "Publication Telegram programmée.",
    body: `La publication est programmée pour le ${scheduledFor.toLocaleString("fr-FR")} vers ${input.targetLabel?.trim() || targetChatId}.`,
    relatedEntityType: "telegram_publication",
    relatedEntityId: String(data.id),
    priority: "normal",
  });
  return mapRow(data);
}

export async function listTelegramPublications(organizationId: string, limit = 50): Promise<TelegramPublicationItem[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("telegram_publications")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Erreur lecture publications Telegram: ${error.message}`);
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
}

export async function cancelTelegramPublication(organizationId: string, publicationId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("telegram_publications")
    .update({ status: "cancelled" })
    .eq("id", publicationId)
    .eq("organization_id", organizationId)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Impossible d'annuler la publication: ${error.message}`);
  if (!data) throw new NotFoundError("Publication introuvable ou déjà traitée.");
}

export async function processScheduledTelegramPublications(now = new Date()): Promise<{ sent: number; failed: number; skipped: number }> {
  const supabase = getSupabaseServiceClient();
  const staleProcessingBefore = new Date(now.getTime() - 10 * 60_000).toISOString();
  await supabase
    .from("telegram_publications")
    .update({ status: "scheduled" })
    .eq("status", "processing")
    .lt("updated_at", staleProcessingBefore);

  const { data: due, error } = await supabase
    .from("telegram_publications")
    .select("*")
    .eq("status", "scheduled")
    .lte("scheduled_for", now.toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(100);
  if (error) throw new Error(`Erreur lecture publications Telegram à envoyer: ${error.message}`);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of due ?? []) {
    const claimed = await supabase
      .from("telegram_publications")
      .update({ status: "processing", error_message: null })
      .eq("id", row.id)
      .eq("status", "scheduled")
      .select("*")
      .maybeSingle();

    if (claimed.error || !claimed.data) {
      skipped++;
      continue;
    }

    try {
      const telegramMessageId = await sendTelegramPublication(row.organization_id, {
        targetChatId: row.target_chat_id,
        content: row.content,
        attachmentUrl: row.attachment_url,
        attachmentType: row.attachment_type,
        buttons: row.buttons ?? null,
        botId: row.bot_id ?? null,
      });
      await supabase.from("telegram_publications").update({ status: "published", telegram_message_id: telegramMessageId }).eq("id", row.id);
      await notifyOrgAdmins({
        organizationId: row.organization_id,
        title: "Publication Telegram envoyée.",
        body: `La publication programmée a été envoyée vers ${row.target_label ?? row.target_chat_id}.`,
        relatedEntityType: "telegram_publication",
        relatedEntityId: row.id,
        priority: "normal",
      });
      sent++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await supabase.from("telegram_publications").update({ status: "failed", error_message: message }).eq("id", row.id);
      await notifyOrgAdmins({
        organizationId: row.organization_id,
        title: "Publication Telegram échouée.",
        body: `La publication programmée vers ${row.target_label ?? row.target_chat_id} a échoué. ${message}`,
        relatedEntityType: "telegram_publication",
        relatedEntityId: row.id,
        priority: "important",
      });
      failed++;
    }
  }

  return { sent, failed, skipped };
}
