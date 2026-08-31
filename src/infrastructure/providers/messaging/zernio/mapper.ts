import type { DomainEvent, MessageReceivedEvent } from "@/domain/events/domain-events";
import type { ZernioInboxWebhookEvent } from "./types";

/**
 * Traduit un événement webhook Zernio (format confirmé, voir types.ts) en
 * événement interne normalisé. Seul endroit où "Zernio: message.received"
 * devient "MESSAGE_RECEIVED" (section 7 doc 1 / section 33 doc 2).
 */
export function mapZernioEventToDomainEvent(
  raw: ZernioInboxWebhookEvent,
  organizationId: string,
): DomainEvent | null {
  switch (raw.event) {
    case "message.received": {
      if (!raw.message?.text || !raw.conversation?.id) {
        // Message sans texte (pièce jointe pure, par ex.) ou sans
        // conversation identifiable — pas encore géré en V1, on ignore
        // plutôt que de planter.
        return null;
      }

      const event: MessageReceivedEvent = {
        type: "MESSAGE_RECEIVED",
        organizationId,
        occurredAt: raw.timestamp,
        externalEventId: raw.id,
        sourceProvider: "zernio",
        payload: {
          externalContactId: raw.conversation.contactId ?? raw.conversation.id,
          externalThreadId: raw.conversation.id,
          phoneE164: raw.conversation.contactPhone,
          contactFullName: raw.conversation.contactName,
          content: raw.message.text,
          externalMessageId: raw.message.id ?? raw.id,
          channel: raw.conversation.platform ?? raw.account.platform ?? "whatsapp",
        },
      };
      return event;
    }

    // TODO (bloc suivant) : mapper message.failed -> notification admin
    // (section 43 doc 2 : erreur Zernio ne doit jamais casser l'appli),
    // account.disconnected -> provider_connections.status = 'error'.
    default:
      return null;
  }
}
