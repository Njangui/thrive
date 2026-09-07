/**
 * Événements internes normalisés.
 *
 * Un webhook provider (Zernio, CinetPay, ...) est TOUJOURS traduit vers un
 * de ces événements par l'adapter correspondant avant d'atteindre la couche
 * application. Le domaine ne doit jamais lire un champ brut type
 * `payload.entry[0].changes[0].value...` — ce mapping vit uniquement dans
 * les fichiers mapper.ts de chaque provider (src/infrastructure/providers/).
 */

export type DomainEventType =
  | "MESSAGE_RECEIVED"
  | "MESSAGE_SENT"
  | "CONVERSATION_STARTED"
  | "CONTACT_CREATED"
  | "PAYMENT_RECEIVED"
  | "PAYMENT_FAILED"
  | "ORDER_CREATED"
  | "LEAD_CREATED"
  | "APPOINTMENT_CREATED"
  | "INVENTORY_LOW"
  | "RECEIVABLE_OVERDUE"
  | "SOCIAL_POST_STATUS_UPDATED";

export interface DomainEventBase {
  type: DomainEventType;
  organizationId: string;
  occurredAt: string; // ISO timestamp
  /** Id d'événement externe si connu — utilisé pour l'idempotence (section 38) */
  externalEventId?: string;
  sourceProvider: string;
}

export interface MessageReceivedEvent extends DomainEventBase {
  type: "MESSAGE_RECEIVED";
  payload: {
    externalContactId: string;
    externalThreadId: string;
    phoneE164?: string;
    contactFullName?: string;
    content: string;
    externalMessageId: string;
    channel: string;
  };
}

export interface PaymentReceivedEvent extends DomainEventBase {
  type: "PAYMENT_RECEIVED";
  payload: {
    providerReference: string;
    orderId?: string;
    amount: number;
    currency: string;
  };
}

export interface InventoryLowEvent extends DomainEventBase {
  type: "INVENTORY_LOW";
  payload: {
    productId: string;
    currentStock: number;
    minStock: number;
  };
}

/**
 * Lot M, Partie 2 — confirmation (webhook `post.*` Zernio) qu'une
 * publication programmée a réellement été diffusée, échouée, ou
 * partiellement diffusée. Distinct de `MESSAGE_RECEIVED` : ce n'est pas
 * un événement conversationnel, `handlePostStatusWebhook`
 * (marketing-service.ts) est le seul consommateur.
 */
export interface SocialPostPlatformStatusUpdate {
  platform: string;
  accountId: string;
  status: "published" | "failed";
  platformPostId?: string;
  platformPostUrl?: string;
  errorMessage?: string;
}

export interface SocialPostStatusUpdatedEvent extends DomainEventBase {
  type: "SOCIAL_POST_STATUS_UPDATED";
  payload: {
    providerPostId: string;
    /**
     * Statut agrégé du post entier — présent pour les events post-level
     * (post.published/failed/partial/cancelled), absent pour un event
     * post.platform.* isolé qui ne concerne qu'UNE plateforme (voir
     * `targets` dans ce cas).
     */
    overallStatus?: "published" | "failed" | "partial" | "cancelled";
    overallErrorMessage?: string;
    targets: SocialPostPlatformStatusUpdate[];
  };
}

/**
 * Union à étendre au fur et à mesure (Phase 7+). Volontairement pas
 * exhaustive dès Phase 0 — seuls les événements réellement câblés au
 * workflow central (section 64) ont un payload typé pour l'instant.
 */
export type DomainEvent =
  | MessageReceivedEvent
  | PaymentReceivedEvent
  | InventoryLowEvent
  | SocialPostStatusUpdatedEvent;
