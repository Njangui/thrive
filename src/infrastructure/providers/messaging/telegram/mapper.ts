import type { DomainEvent, MessageReceivedEvent } from "@/domain/events/domain-events";
import type { TelegramUpdate } from "./types";

/**
 * Traduit une update Telegram (canal client) en MESSAGE_RECEIVED —
 * seul endroit qui connaît la forme brute Telegram pour ce port, même
 * discipline que `messaging/zernio/mapper.ts`.
 *
 * Un chat privé Telegram n'a ni conversationId ni contactId séparés
 * (contrairement à Zernio) : `chat.id` sert IDENTIQUEMENT
 * d'`externalContactId` ET d'`externalThreadId` — c'est la même entité
 * durable côté Telegram (une conversation privée = ce chat, pour
 * toujours). `phoneE164` reste volontairement absent : un bot Telegram
 * n'a accès au numéro de l'utilisateur que s'il le partage
 * explicitement via un bouton "partager le contact" (non implémenté
 * dans ce lot) — jamais deviné.
 */
export function mapTelegramUpdateToDomainEvent(raw: TelegramUpdate, organizationId: string): DomainEvent | null {
  const message = raw.message;
  if (!message?.text || !message.chat) {
    // Update sans texte exploitable (photo/sticker/etc. sans légende,
    // ou update d'un autre type que "message") — pas géré en V1, ignoré
    // plutôt qu'on invente un contenu.
    return null;
  }

  const chatId = String(message.chat.id);
  const contactFullName = message.from
    ? [message.from.first_name, message.from.last_name].filter(Boolean).join(" ") || undefined
    : undefined;

  const event: MessageReceivedEvent = {
    type: "MESSAGE_RECEIVED",
    organizationId,
    occurredAt: new Date(message.date * 1000).toISOString(),
    externalEventId: String(raw.update_id),
    sourceProvider: "telegram",
    payload: {
      externalContactId: chatId,
      externalThreadId: chatId,
      contactFullName,
      content: message.text,
      externalMessageId: String(message.message_id),
      channel: "telegram",
    },
  };
  return event;
}
