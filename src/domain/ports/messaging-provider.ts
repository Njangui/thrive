/**
 * MessagingProvider — port métier (section 6).
 *
 * Le domaine (services CRM, conversation, etc.) ne dépend QUE de cette
 * interface. Un adapter concret (ZernioAdapter, MetaCloudAdapter, ...)
 * l'implémente dans src/infrastructure/providers/messaging/*.
 *
 * Interdit : `import { ZernioClient } from ...` en dehors de
 * src/infrastructure/providers/messaging/zernio/*.
 */

export interface OutboundMessage {
  to: string; // numéro E.164 ou identifiant de contact côté canal
  channel: "whatsapp" | "sms";
  content: string;
  /**
   * Id de conversation côté provider (ex: Zernio conversationId), quand on
   * répond à une conversation déjà existante. CONFIRMÉ pour Zernio
   * (docs.zernio.com) : répondre utilise l'endpoint inbox scoppé à cette
   * conversation, pas un envoi "à froid" vers un numéro. Optionnel car
   * tous les MessagingProvider n'ont pas ce concept.
   */
  externalThreadId?: string;
  /** Pour les templates WhatsApp approuvés (hors fenêtre des 24h) */
  templateName?: string;
  templateParams?: Record<string, string>;
}

export interface SendMessageResult {
  providerMessageId: string;
  status: "sent" | "queued" | "failed";
}

export interface NormalizedContact {
  externalContactId: string;
  phoneE164?: string;
  fullName?: string;
}

export interface NormalizedConversation {
  externalThreadId: string;
  channel: string;
}

export interface MessagingProvider {
  /** Nom du provider concret, pour logs et provider_connections */
  readonly providerName: string;

  sendMessage(organizationId: string, message: OutboundMessage): Promise<SendMessageResult>;

  getConversation(
    organizationId: string,
    externalThreadId: string,
  ): Promise<NormalizedConversation | null>;

  getContact(
    organizationId: string,
    externalContactId: string,
  ): Promise<NormalizedContact | null>;

  markAsRead(organizationId: string, externalMessageId: string): Promise<void>;
}
