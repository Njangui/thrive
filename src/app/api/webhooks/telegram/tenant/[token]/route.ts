import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import {
  hashPayload,
  parseTelegramTenantUpdate,
  verifyTelegramTenantSecretToken,
} from "@/infrastructure/providers/messaging/telegram/webhook-handler";
import { mapTelegramUpdateToDomainEvent } from "@/infrastructure/providers/messaging/telegram/mapper";
import { resolveOrganizationIdByTelegramWebhookToken } from "@/infrastructure/providers/messaging/telegram/resolve-organization";
import { handleInboundMessage } from "@/application/services/conversation-service";
import { routeMessage } from "@/application/services/conversation-orchestrator";
import { escalateToHuman, getAutoReplyMode, notifyUnansweredInboundMessage } from "@/application/services/handoff-service";
import { getMessagingProvider, getStorageProvider } from "@/infrastructure/providers/registry";
import { buildTenantObjectPath, type MediaType } from "@/application/services/media-service";

/**
 * Pipeline (même schéma que app/api/webhooks/zernio/route.ts, section
 * 37) : Signature -> Résolution tenant -> Idempotence -> Normalisation ->
 * Application -> IA/réponse. Fichier ENTIÈREMENT séparé du webhook
 * Zernio : aucun import, aucune fonction, aucune table de déduplication
 * partagée avec lui — voir docs/TELEGRAM_INTEGRATION.md.
 *
 * Un seul update par requête (contrairement à Zernio, qui peut livrer un
 * tableau) — c'est le comportement standard de l'API webhook Telegram.
 *
 * Toujours répondre 200 (même sur update ignoré/dupliqué/tenant inconnu)
 * pour éviter que Telegram ne retente indéfiniment.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rawBody = await request.text();

  const resolved = await resolveOrganizationIdByTelegramWebhookToken(token);
  if (!resolved) {
    console.warn(`Telegram tenant webhook: jeton d'URL inconnu (${token}), ignoré.`);
    return NextResponse.json({ ok: true });
  }
  const { organizationId, webhookSecret } = resolved;

  const headerValue = request.headers.get("x-telegram-bot-api-secret-token");
  if (!verifyTelegramTenantSecretToken(headerValue, webhookSecret)) {
    console.warn(`Telegram tenant webhook: secret invalide pour l'organisation ${organizationId}.`);
    return NextResponse.json({ error: "invalid secret" }, { status: 401 });
  }

  const update = parseTelegramTenantUpdate(rawBody);
  // update_id n'est unique QUE par bot (voir types.ts) — la clé
  // d'idempotence combine donc l'organisation et l'update_id, jamais
  // l'update_id seul (deux tenants pourraient sinon partager le même
  // update_id et se bloquer mutuellement).
  const externalEventId = `${organizationId}:${update.update_id}`;

  const supabase = getSupabaseServiceClient();
  const { error: insertEventError } = await supabase.from("webhook_events").insert({
    organization_id: organizationId,
    provider: "telegram_tenant",
    external_event_id: externalEventId,
    event_type: "message",
    payload_hash: hashPayload(rawBody),
    status: "received",
  });

  if (insertEventError) {
    if (insertEventError.code === "23505") {
      console.info(`Telegram tenant webhook: update dupliqué ignoré (${externalEventId})`);
      return NextResponse.json({ ok: true });
    }
    console.error("Telegram tenant webhook: échec insertion webhook_events:", insertEventError.message);
    return NextResponse.json({ ok: true });
  }

  try {
    const attachment = await downloadTelegramAttachmentIfPresent(organizationId, update);
    const domainEvent = mapTelegramUpdateToDomainEvent(update, organizationId, attachment ?? undefined);
    if (!domainEvent) {
      await markWebhookEvent(externalEventId, "ignored_duplicate");
      return NextResponse.json({ ok: true });
    }

    if (domainEvent.type === "MESSAGE_RECEIVED") {
      const result = await handleInboundMessage(domainEvent);

      // Même garde-fou que le webhook Zernio (section 22/31) : jamais de
      // réponse automatique pendant une prise en charge humaine.
      const autoReplyMode = getAutoReplyMode(result.handoffStatus, result.handoffReason);
      // Vrai dès qu'une réponse est partie OU qu'une escalade a déjà alerté
      // les admins — sinon on les alerte plus bas (message sans réponse).
      let handledAutomatically = false;

      if (autoReplyMode !== "none") {
        const routing = await routeMessage(organizationId, result.conversationId, domainEvent.payload.content, {
          // `deterministic_only` : voir handoff-service.ts::getAutoReplyMode.
          allowAI: autoReplyMode === "full",
        });

        if (routing.handoffReason) {
          await escalateToHuman(organizationId, result.conversationId, routing.handoffReason);
          handledAutomatically = true;
        }

        if (routing.replyText) {
          const messaging = await getMessagingProvider(organizationId, "telegram");
          await messaging.sendMessage(organizationId, {
            to: domainEvent.payload.externalContactId,
            channel: "telegram",
            content: routing.replyText,
            externalThreadId: domainEvent.payload.externalThreadId,
            // Telegram sendMessage ne prend pas de pièce jointe séparée
            // dans ce lot (texte uniquement) — une image produit
            // résolue par le routage est donc simplement omise ici
            // plutôt que d'inventer un envoi non confirmé pour ce canal.
          });

          await supabase.from("messages").insert({
            organization_id: organizationId,
            conversation_id: result.conversationId,
            direction: "outbound",
            sender: "ai",
            content: routing.replyText,
            metadata: { intent: routing.intent, ai_invoked: routing.aiInvoked },
          });
          handledAutomatically = true;
        }
      }

      if (!handledAutomatically) {
        await notifyUnansweredInboundMessage(
          organizationId,
          result.conversationId,
          domainEvent.payload.contactFullName,
          domainEvent.payload.content,
          Boolean(domainEvent.payload.attachment),
        );
      }
    }

    await markWebhookEvent(externalEventId, "processed");
  } catch (processingError) {
    console.error("Telegram tenant webhook: échec traitement:", processingError);
    await markWebhookEvent(
      externalEventId,
      "failed",
      processingError instanceof Error ? processingError.message : String(processingError),
    );
  }

  return NextResponse.json({ ok: true });
}

async function downloadTelegramAttachmentIfPresent(organizationId: string, update: import("@/infrastructure/providers/messaging/telegram/types").TelegramUpdate) {
  const message = update.message;
  if (!message) return null;

  const candidate = message.document
    ? { fileId: message.document.file_id, fileName: message.document.file_name, mimeType: message.document.mime_type, type: "file" as const }
    : message.video
      ? { fileId: message.video.file_id, fileName: `telegram-${message.message_id}.mp4`, mimeType: message.video.mime_type, type: "video" as const }
      : message.audio
        ? { fileId: message.audio.file_id, fileName: `telegram-${message.message_id}.mp3`, mimeType: message.audio.mime_type, type: "audio" as const }
        : message.voice
          ? { fileId: message.voice.file_id, fileName: `telegram-${message.message_id}.ogg`, mimeType: message.voice.mime_type, type: "audio" as const }
          : message.photo?.length
            ? { fileId: message.photo[message.photo.length - 1]!.file_id, fileName: `telegram-${message.message_id}.jpg`, mimeType: "image/jpeg", type: "image" as const }
            : null;
  if (!candidate) return null;

  const messaging = await getMessagingProvider(organizationId, "telegram");
  if (!messaging.downloadInboundAttachment) throw new Error("Le canal Telegram connecté ne permet pas le téléchargement des pièces jointes.");
  const downloaded = await messaging.downloadInboundAttachment(organizationId, candidate.fileId);
  if (downloaded.data.byteLength > 20 * 1024 * 1024) throw new Error("La pièce jointe Telegram dépasse la limite de 20 Mo prise en charge par CRESYVA.");

  const storage = await getStorageProvider(organizationId);
  const contentType = downloaded.contentType?.split(";")[0] || candidate.mimeType || "application/octet-stream";
  const path = buildTenantObjectPath("telegram-inbox" as MediaType, candidate.fileName || `telegram-${message.message_id}`);
  const uploaded = await storage.upload({ organizationId, path, contentType, data: downloaded.data });
  return { url: uploaded.url, type: candidate.type, fileName: candidate.fileName, mimeType: contentType, fileId: candidate.fileId };
}

async function markWebhookEvent(externalEventId: string, status: string, errorMessage?: string) {
  const supabase = getSupabaseServiceClient();
  await supabase
    .from("webhook_events")
    .update({ status, processed_at: new Date().toISOString(), error_message: errorMessage })
    .eq("provider", "telegram_tenant")
    .eq("external_event_id", externalEventId);
}
