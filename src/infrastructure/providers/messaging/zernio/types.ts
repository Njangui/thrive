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
  id: string; // confirmé : clé de routage multi-tenant pour les events `messaging`
  platform?: string;
  /**
   * Lot 5 — CONFIRMÉ (docs.zernio.com/webhooks/inbox : "Message payloads
   * carry an `account` block with `accountId` and `profileId`, so one
   * endpoint can serve many profiles"). Clé de routage pour les events
   * `comment.received`/`post.external.*` — voir resolve-organization.ts
   * ::resolveOrganizationIdBySocialProfile pour pourquoi `id` seul n'est
   * PAS fiable pour ces deux events précis.
   */
  profileId?: string;
}

/**
 * Lot 5 (20/09/2026) — payload de `comment.received`
 * (docs.zernio.com/webhooks/inbox, "Fired when a new comment arrived on
 * a tracked post"). CONFIRMÉ : événement câblé sur un objet `comment`
 * distinct (pas fusionné dans `message`). Champs internes de `comment`
 * NON confirmés verbatim au niveau DU WEBHOOK (page consultée ne les
 * énumère pas) — repris PAR ANALOGIE avec la ressource `comment`
 * CONFIRMÉE de l'API REST `GET /v1/inbox/comments/{postId}` (voir
 * `social/zernio/types.ts::ZernioInboxComment`, qui expose exactement
 * `id`/`message`/`from`/`createdTime`/`canReply`/`canHide`) — même
 * discipline que `ZernioPostWebhookEvent` plus bas, qui réutilise par
 * analogie la ressource `post` confirmée côté REST. À vérifier avec un
 * vrai payload ("Test webhook", dashboard Zernio) avant mise en prod.
 */
export interface ZernioInboxWebhookCommentAuthor {
  id?: string;
  name?: string;
}

export interface ZernioInboxWebhookComment {
  id: string;
  message?: string;
  from?: ZernioInboxWebhookCommentAuthor;
  createdTime?: string;
}

/**
 * Référence minimale au post commenté, portée par `comment.received`.
 * CONFIRMÉ uniquement au niveau du principe (l'événement dit "sur un
 * post tracké" et le SDK chat-sdk-adapter documente le format d'id de
 * thread `zernio:{accountId}:comment:{postId}`, confirmant qu'un
 * `postId` identifie bien le post côté payload) — le nom exact du champ
 * (`post.id` supposé, par symétrie avec `post.external.*` ci-dessous, où
 * `post.id` EST confirmé) reste à vérifier avec un vrai payload de test.
 */
export interface ZernioInboxWebhookPostRef {
  id: string;
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
    | "review.updated"
    // CONFIRMÉ Lot 3 (zernio-php WebhooksApi.md, docs.rs/crate/zernio,
    // github.com/zernio-dev/convex-zernio — trois SDK indépendants
    // recoupés le 4 sept. 2026, la liste complète des events déclarables
    // à la création d'un webhook y est explicite) : "account.connected"
    // et "account.disconnected" existent réellement, avec un payload
    // `{id, event, account: {...}, timestamp}` — même enveloppe que les
    // events inbox. Champs internes de `account` au-delà de `id` non
    // confirmés au-delà de ce que ZernioInboxWebhookAccount déclare déjà.
    | "account.connected"
    | "account.disconnected";
  message?: ZernioInboxWebhookMessage;
  conversation?: ZernioInboxWebhookConversation;
  account: ZernioInboxWebhookAccount;
  metadata?: Record<string, unknown> | null;
  timestamp: string;
  /** Lot 5 — présent uniquement sur `comment.received` (voir ci-dessus). */
  comment?: ZernioInboxWebhookComment;
  /** Lot 5 — présent uniquement sur `comment.received` (voir ci-dessus). */
  post?: ZernioInboxWebhookPostRef;
}

/**
 * Bouton CTA URL interactif WhatsApp — forme `interactive` CONFIRMÉE par
 * recoupement de 2 sources indépendantes le 19/09/2026 : l'exemple
 * officiel `client.sendInteractive(...)` du SDK `@zernio/chat-sdk-adapter`
 * (github.com/zernio-dev/chat-sdk-adapter) et la documentation Meta Cloud
 * API elle-même (developers.facebook.com, "Interactive Call-to-Action URL
 * Button Messages") — docs.zernio.com confirme que la forme `interactive`
 * "mirrors Meta's Cloud API `interactive` object verbatim". Message de
 * session UNIQUEMENT (fenêtre de 24h ouverte par le dernier message
 * entrant du contact) — déjà toujours le cas ici, ZernioAdapter.sendMessage
 * exige déjà externalThreadId, aucun envoi "à froid" n'existe dans ce
 * projet (voir adapter.ts). UN SEUL bouton par message (limite du type
 * `cta_url` — contrairement à Telegram, WhatsApp ne permet pas plusieurs
 * boutons URL distincts dans un même message via ce type).
 *
 * ⚠️ Fusion #17 : confirmé pour les conversations 1:1 UNIQUEMENT. NON confirmé
 * — et probablement refusé — pour les GROUPES WhatsApp : la documentation de
 * l'API Groupes (360dialog, Unipile, sept. 2026) liste les messages
 * interactifs comme non pris en charge, et docs.zernio.com ne dit rien de
 * contraire. Aucun appelant de groupe ne passe donc de bouton (voir
 * omnichannel-publication-service.ts / whatsapp-group-service.ts).
 */
export interface ZernioInteractiveCtaUrl {
  type: "cta_url";
  body: { text: string };
  action: {
    name: "cta_url";
    parameters: { display_text: string; url: string };
  };
}

/** Body confirmé pour répondre dans une conversation inbox existante. */
export interface ZernioSendInboxMessagePayload {
  accountId: string;
  message?: string;
  /**
   * CONFIRMÉ (docs.rs/crate/zernio, docs.zernio.com/resources/migrations/
   * migrating-from-kapso, docs.zernio.com/resources/integrations/chat-sdk
   * — trois sources indépendantes recoupées le 5 sept. 2026) : URL
   * publiquement accessible, 25 Mo max. Zernio ne gère pas l'upload
   * binaire direct pour ce projet (on utilise déjà des URLs Supabase
   * Storage publiques pour les images produits — voir media-service.ts).
   */
  attachmentUrl?: string;
  attachmentType?: "image" | "video" | "audio" | "file";
  /** Voir ZernioInteractiveCtaUrl. Prioritaire sur `message` quand présent (WhatsApp — un message est soit texte, soit interactif, jamais les deux). */
  interactive?: ZernioInteractiveCtaUrl;
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
 * scheduled/cancelled/recycled sont déjà couverts côté Flexco par nos
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

/**
 * Lot 5 (20/09/2026) — payload pour `post.external.created` /
 * `post.external.updated` / `post.external.deleted`
 * (docs.zernio.com/webhooks/posts) : "Zernio's background sync detected
 * a post authored natively on the platform, outside Zernio... `post.source`
 * is always "external" and `post.id` is the platform-native post id."
 * CONFIRMÉ : `post.source === "external"`, `post.id`. Détection ~horaire
 * (poll), pas temps réel — voir social-post-tracking-service.ts.
 * Champs additionnels décrits en prose par la doc (texte, media) mais
 * NON énumérés verbatim au niveau champ sur la page consultée — jamais
 * devinés : seuls `id`/`source`/`platform` sont lus ici, le reste
 * attend un vrai payload de test avant d'être exploité (même réserve
 * que le reste de ce fichier).
 */
export interface ZernioExternalPostWebhookAccount {
  id: string;
  platform?: string;
  /** Voir ZernioInboxWebhookAccount.profileId — même raisonnement, même clé de routage. */
  profileId?: string;
}

export interface ZernioExternalPostWebhookPost {
  id: string;
  source: "external";
  platform?: string;
  deletedAt?: string;
}

export interface ZernioExternalPostWebhookEvent {
  id: string;
  event: "post.external.created" | "post.external.updated" | "post.external.deleted";
  post: ZernioExternalPostWebhookPost;
  account: ZernioExternalPostWebhookAccount;
  timestamp: string;
}

export type ZernioWebhookEvent = ZernioInboxWebhookEvent | ZernioPostWebhookEvent | ZernioExternalPostWebhookEvent;

/**
 * Distingue un event `post.external.*` (post détecté nativement sur la
 * plateforme, HORS pipeline de publication Flexco) d'un event `post.*`
 * "normal" ci-dessous — à vérifier EN PREMIER, avant `isZernioPostEvent`
 * (qui matcherait sinon aussi sur le préfixe `post.`).
 */
export function isZernioExternalPostEvent(raw: { event: string }): raw is ZernioExternalPostWebhookEvent {
  return raw.event.startsWith("post.external.");
}

/** Distingue les catégories d'événements Zernio partageant le même webhook (voir app/api/webhooks/zernio/route.ts). */
export function isZernioPostEvent(raw: { event: string }): raw is ZernioPostWebhookEvent {
  return raw.event.startsWith("post.") && !isZernioExternalPostEvent(raw);
}
