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

/**
 * Lot F — CONFIRMÉ (docs.zernio.com/whatsapp/list-whatsapp-group-chats,
 * consulté 31 août 2026) : la réponse de `GET /whatsapp/wa-groups` ne
 * contient QUE ces trois champs par groupe — pas de nombre de
 * participants (voir whatsapp-group-service.ts, qui documente pourquoi
 * `participant_count` reste nullable côté schéma). Non disponible pour
 * les numéros connectés en mode Coexistence (Cloud API + app WhatsApp
 * Business sur le même téléphone) — l'API renvoie une erreur dans ce cas,
 * propagée telle quelle par client.ts (jamais masquée).
 */
export interface ZernioWhatsAppGroup {
  id: string;
  subject: string;
  createdAt: string;
}

export interface ZernioListWhatsAppGroupsResponse {
  groups: ZernioWhatsAppGroup[];
  paging?: {
    cursors?: {
      after?: string;
      before?: string;
    };
  };
}

/**
 * Lot M, Partie 2 — événements webhook `post.*` (synchronisation des
 * publications sociales). CONFIRMÉ (docs.zernio.com/webhooks, table
 * "Available events" ; recoupé avec le SDK officiel `zernio-php`,
 * `WebhooksApi.md`, et `zernio-dev/n8n-nodes-zernio`, consultés le 31
 * août 2026) : ces huit noms d'événement existent réellement, avec deux
 * granularités distinctes —
 * - agrégée (le POST tout entier, toutes plateformes confondues) :
 *   `post.scheduled`, `post.published`, `post.failed`, `post.partial`
 *   (publié sur certaines plateformes, échoué sur d'autres), `post.cancelled`,
 *   `post.recycled` ;
 * - par plateforme ciblée (une ligne social_post_targets) :
 *   `post.platform.published`, `post.platform.failed`.
 * Seuls published/failed/partial/platform.published/platform.failed sont
 * traités par ce lot (voir marketing-service.ts::handlePostStatusWebhook) —
 * scheduled/cancelled/recycled sont déjà couverts côté SME-OS par nos
 * propres actions (schedulePost/cancelPost), pas par une confirmation
 * webhook a posteriori.
 */
export type ZernioPostEventName =
  | "post.scheduled"
  | "post.published"
  | "post.failed"
  | "post.partial"
  | "post.cancelled"
  | "post.recycled"
  | "post.platform.published"
  | "post.platform.failed";

/**
 * CONFIRMÉ (docs.zernio.com, pages "Facebook API"/"Threads API" — exemple
 * de réponse `POST /posts` et `GET /posts/{postId}` — et blog officiel
 * "How we built an API for AI content tools", qui montre un post en statut
 * `partial` avec un résultat par plateforme). C'est ici que se trouvait le
 * point explicitement laissé "à confirmer" par le Lot H
 * (docs/ZERNIO_INTEGRATION.md) : le champ s'appelle réellement `platforms`,
 * **pas** `platformResults` comme le code précédent l'avait nommé par
 * hypothèse.
 */
export interface ZernioPostPlatformResult {
  platform: string;
  // CONFIRMÉ : objet enrichi `{ _id, username }` en réponse de publication ;
  // simple string en entrée de `POST /posts` (voir social/zernio/types.ts).
  accountId: string | { _id: string; username?: string };
  status: string; // valeurs confirmées observées : "published", "failed"
  platformPostId?: string;
  platformPostUrl?: string;
  /** Présent uniquement si `status === "failed"` pour cette plateforme. */
  error?: string;
}

/** CONFIRMÉ : forme de la ressource `post` renvoyée par l'API REST (`GET /posts/{id}`, `POST /posts`). */
export interface ZernioPostResource {
  _id?: string;
  id?: string;
  status: string;
  platforms?: ZernioPostPlatformResult[];
  /** Erreur globale (ex: post entièrement rejeté) — distincte des erreurs par plateforme dans `platforms[]`. */
  error?: string;
  publishedAt?: string;
}

/**
 * Enveloppe d'un événement webhook `post.*`.
 *
 * ENCORE NON CONFIRMÉ AU NIVEAU EXACT DE L'ENVELOPPE (voir
 * docs/ZERNIO_INTEGRATION.md) : que le webhook embarque littéralement
 * `{ post: {...} }` plutôt qu'un sous-ensemble de champs à plat. Ce qui
 * EST confirmé par le blog officiel Zernio ("How to Schedule Threads
 * Posts — A Guide for Developers") : le payload contient au minimum
 * l'id du post, son statut final, et un message d'erreur en cas
 * d'échec. La forme ci-dessous suit par analogie l'enveloppe inbox déjà
 * confirmée (`{id, event, message, conversation, account, timestamp}` —
 * un objet nommé d'après la ressource) ; `mapZernioPostEventToDomainEvent`
 * (mapper.ts) reste volontairement tolérant à un id de post exposé soit
 * sous `post._id`/`post.id`, soit sous `postId` à la racine, plutôt que
 * de planter si la forme réelle diffère légèrement une fois vérifiée
 * avec un vrai payload de test (fonctionnalité "Test webhook" du
 * dashboard Zernio, avant mise en production — voir RAPPORT_LOT_M.md).
 */
export interface ZernioPostWebhookEvent {
  id: string;
  event: ZernioPostEventName;
  post?: ZernioPostResource;
  postId?: string;
  /** Résultat d'UNE SEULE plateforme — présent pour les events `post.platform.*`, absent pour les events agrégés. */
  platform?: string;
  accountId?: string;
  platformPostUrl?: string;
  error?: string;
  timestamp: string;
}

export type ZernioWebhookEvent = ZernioInboxWebhookEvent | ZernioPostWebhookEvent;

/** Distingue les deux catégories d'événements Zernio partageant le même webhook (voir app/api/webhooks/zernio/route.ts). */
export function isZernioPostEvent(raw: { event: string }): raw is ZernioPostWebhookEvent {
  return raw.event.startsWith("post.");
}
