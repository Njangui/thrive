/**
 * Types du format BRUT Zernio (https://docs.zernio.com).
 *
 * ⚠️ CORRECTION (voir docs/GAP_ANALYSIS.md) : une première version de ce
 * fichier avait été écrite par extrapolation, AVANT vérification de la
 * documentation officielle — ce qui va explicitement contre la section 14
 * du doc 2 ("Ne devine jamais une API"). Cette version reflète ce qui est
 * réellement confirmé sur docs.zernio.com (Quickstart, Webhooks, Inbox
 * webhooks, Multi-tenant guide), consulté le 27 août 2026.
 *
 * CONFIRMÉ :
 * - Base URL : https://zernio.com/api/v1
 * - Auth : header `Authorization: Bearer <ZERNIO_API_KEY>`
 * - Modèle multi-tenant : un "profile" Zernio par tenant (business),
 *   chaque profile contient des "accounts" (un compte WhatsApp/FB/IG/...),
 *   IDs Mongo-style 24 caractères dans un champ `_id` / `id` selon le
 *   contexte.
 * - Enveloppe webhook : { id, event, message, conversation, account,
 *   metadata?, timestamp } — PAS de wrapper `data` (contrairement à la
 *   première version de ce fichier).
 * - Déduplication : `payload.id` (== header `X-Zernio-Event-Id`).
 * - Routage multi-tenant des webhooks inbox : `account.id` identifie le
 *   compte Zernio -> à mapper vers notre organization_id via
 *   provider_connections.metadata.accountId (guide "Build a Platform").
 * - Réponse à un message entrant : `POST /inbox/conversations/{conversationId}/messages`
 *   avec `{ accountId, message }` — PAS `POST /messages` (corrigé).
 *
 * ENCORE NON CONFIRMÉ (la doc utilise des types nommés
 * InboxWebhookMessage/InboxWebhookConversation/InboxWebhookAccount sans
 * lister tous leurs champs dans le rendu récupéré) : le détail exact des
 * champs internes de `message`/`conversation`/`account` au-delà de ceux
 * listés ci-dessous. À confirmer via un vrai payload de test avant prod
 * (voir "Test webhook" dans la doc) ou via docs.zernio.com/api/openapi
 * (spec OpenAPI, non exploitable en lecture simple ici).
 */

export interface ZernioInboxWebhookMessage {
  id?: string;
  text?: string;
  attachments?: unknown[];
  // Autres champs non confirmés (senderId, direction, createdAt...).
}

export interface ZernioInboxWebhookConversation {
  id?: string; // conversationId — nécessaire pour répondre via l'inbox
  contactId?: string;
  contactName?: string;
  contactPhone?: string;
  platform?: string;
}

export interface ZernioInboxWebhookAccount {
  id: string; // confirmé : clé de routage multi-tenant pour les events inbox
  platform?: string;
}

export interface ZernioInboxWebhookEvent {
  id: string; // confirmé : id d'événement canonique, clé de déduplication
  event:
    | "message.received"
    | "message.sent"
    | "conversation.started"
    | "message.edited"
    | "message.deleted"
    | "message.delivered"
    | "message.read"
    | "message.failed"
    | "reaction.received"
    | "comment.received"
    | "review.new"
    | "review.updated";
  message?: ZernioInboxWebhookMessage;
  conversation?: ZernioInboxWebhookConversation;
  account: ZernioInboxWebhookAccount;
  metadata?: Record<string, unknown> | null;
  timestamp: string;
}

/** Body confirmé pour répondre dans une conversation inbox existante. */
export interface ZernioSendInboxMessagePayload {
  accountId: string;
  message: string;
}

export interface ZernioSendInboxMessageResponse {
  id: string;
  status?: string;
}

export interface ZernioAccount {
  _id: string;
  platform: string;
  username?: string;
}
