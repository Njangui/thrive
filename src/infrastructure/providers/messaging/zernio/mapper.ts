import type {
  DomainEvent,
  MessageReceivedEvent,
  MessageFailedEvent,
  ProviderAccountStatusUpdatedEvent,
  SocialPostStatusUpdatedEvent,
  CommentReceivedEvent,
  ExternalPostTrackedEvent,
} from "@/domain/events/domain-events";
import { INBOUND_ATTACHMENT_PLACEHOLDER_PREFIX } from "@/domain/events/domain-events";
import type { ZernioInboxWebhookEvent, ZernioPostWebhookEvent, ZernioExternalPostWebhookEvent } from "./types";

/** Type que MessageReceivedEvent.payload.attachment reconnaît (voir domain-events.ts). */
type InboundAttachment = NonNullable<MessageReceivedEvent["payload"]["attachment"]>;
const ATTACHMENT_TYPES = new Set(["image", "video", "audio", "file"]);

/**
 * CORRECTIF Lot P — `ZernioInboxWebhookMessage.attachments` est typé
 * `unknown[]` (forme NON confirmée par la doc Zernio au niveau champ, voir
 * types.ts). Avant ce correctif, un message SANS texte — vocal, photo,
 * document — était purement et simplement ignoré par ce mapper : jamais
 * enregistré, jamais notifié au commerçant, le client n'avait AUCUNE
 * réaction (constaté en test réel par le commerçant, capture d'écran
 * WhatsApp à l'appui). Lecture défensive, jamais un champ exigé : seule une
 * `url` de type `string` est retenue comme pièce jointe structurée (le
 * reste de la chaîne — miniature dans le fil admin — en a besoin) ; un
 * premier élément de `attachments[]` qui n'expose pas d'URL exploitable
 * compte quand même comme "une pièce jointe a été envoyée" (placeholder
 * textuel), jamais comme un message vide silencieusement perdu.
 */
function extractZernioAttachment(attachments: unknown[] | undefined): InboundAttachment | null {
  const first = attachments?.[0];
  if (!first || typeof first !== "object") return null;
  const raw = first as Record<string, unknown>;
  const url = typeof raw.url === "string" ? raw.url : typeof raw.link === "string" ? raw.link : null;
  if (!url) return null;
  const rawType = typeof raw.type === "string" ? raw.type : undefined;
  return {
    url,
    type: rawType && ATTACHMENT_TYPES.has(rawType) ? (rawType as InboundAttachment["type"]) : "file",
    fileName: typeof raw.fileName === "string" ? raw.fileName : typeof raw.filename === "string" ? raw.filename : undefined,
    mimeType: typeof raw.mimeType === "string" ? raw.mimeType : typeof raw.mimetype === "string" ? raw.mimetype : undefined,
    fileId: typeof raw.id === "string" ? raw.id : undefined,
  };
}

const ATTACHMENT_LABELS: Record<string, string> = { image: "une photo", video: "une vidéo", audio: "un message vocal", file: "un document" };

/** Texte affiché côté commerçant/IA quand le client n'a envoyé qu'une pièce jointe, sans légende. */
function buildAttachmentPlaceholder(attachment: InboundAttachment | null, hasUnrecognizedAttachment: boolean): string {
  if (attachment) return `${INBOUND_ATTACHMENT_PLACEHOLDER_PREFIX} (${ATTACHMENT_LABELS[attachment.type] ?? "un fichier"}).`;
  if (hasUnrecognizedAttachment) return `${INBOUND_ATTACHMENT_PLACEHOLDER_PREFIX}.`;
  return "";
}

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
      if (!raw.conversation?.id) {
        // Sans conversation identifiable, impossible de répondre ni même
        // de savoir à quel fil rattacher le message — on ignore.
        return null;
      }

      const text = raw.message?.text?.trim();
      // CORRECTIF Lot P : un message SANS texte (vocal, photo, document)
      // n'est plus perdu — voir extractZernioAttachment ci-dessus. `content`
      // reçoit un texte de remplacement reconnu par le pipeline de réponse
      // automatique (domain-events.ts::isInboundAttachmentPlaceholder), qui
      // ne le traite JAMAIS comme une vraie question.
      const hasAnyAttachment = Boolean(raw.message?.attachments?.length);
      const attachment = extractZernioAttachment(raw.message?.attachments);
      const content = text || buildAttachmentPlaceholder(attachment, hasAnyAttachment);
      if (!content) {
        // Ni texte, ni pièce jointe détectable : rien d'exploitable.
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
          content,
          externalMessageId: raw.message?.id ?? raw.id,
          channel: raw.conversation.platform ?? raw.account.platform ?? "whatsapp",
          providerAccountId: raw.account.id,
          ...(attachment ? { attachment } : {}),
        },
      };
      return event;
    }

    // CONFIRMÉ Lot 3 (audit master prompt §44) : "message.failed" existe
    // (voir types.ts) — jusqu'ici dans la liste d'events confirmés mais
    // jamais mappé (TODO laissé par un lot précédent). Le champ exact
    // portant le motif d'échec n'est PAS confirmé au niveau du payload —
    // lu défensivement depuis `metadata.error`/`metadata.reason` sans
    // jamais l'exiger, jamais inventé si absent.
    case "message.failed": {
      const event: MessageFailedEvent = {
        type: "MESSAGE_FAILED",
        organizationId,
        occurredAt: raw.timestamp,
        externalEventId: raw.id,
        sourceProvider: "zernio",
        payload: {
          externalMessageId: raw.message?.id,
          externalThreadId: raw.conversation?.id,
          errorMessage:
            typeof raw.metadata?.error === "string"
              ? raw.metadata.error
              : typeof raw.metadata?.reason === "string"
                ? raw.metadata.reason
                : undefined,
        },
      };
      return event;
    }

    // CONFIRMÉ Lot 3 (voir types.ts) : "account.connected"/"account.disconnected".
    case "account.connected":
    case "account.disconnected": {
      const event: ProviderAccountStatusUpdatedEvent = {
        type: "PROVIDER_ACCOUNT_STATUS_UPDATED",
        organizationId,
        occurredAt: raw.timestamp,
        externalEventId: raw.id,
        sourceProvider: "zernio",
        payload: {
          accountId: raw.account.id,
          status: raw.event === "account.connected" ? "connected" : "error",
        },
      };
      return event;
    }

    // Lot 5 (20/09/2026) — ferme le TODO laissé par le Lot M/I ("un
    // webhook temps réel dédié reste à construire") : synchronisation
    // temps réel des commentaires, en complément (pas en remplacement)
    // du pull manuel existant (social-comment-service.ts::
    // syncCommentsForPost, conservé pour un rattrapage à la demande).
    // `comment.message`/`comment.id` sont considérés requis (par analogie
    // avec la ressource REST confirmée, voir types.ts) — un event sans
    // l'un des deux est ignoré plutôt que de stocker un commentaire
    // incomplet. `post.id` manquant = event inexploitable (on ne peut
    // rattacher le commentaire à aucun post, même en créant une ligne à
    // la volée) — jamais deviné.
    case "comment.received": {
      if (!raw.comment?.id || !raw.comment?.message || !raw.post?.id) {
        return null;
      }

      const event: CommentReceivedEvent = {
        type: "COMMENT_RECEIVED",
        organizationId,
        occurredAt: raw.timestamp,
        externalEventId: raw.id,
        sourceProvider: "zernio",
        payload: {
          providerPostId: raw.post.id,
          providerAccountId: raw.account.id,
          platform: raw.account.platform,
          externalCommentId: raw.comment.id,
          authorName: raw.comment.from?.name,
          authorExternalId: raw.comment.from?.id,
          content: raw.comment.message,
        },
      };
      return event;
    }

    // Confirmés (types.ts) mais pas encore consommés par une fonctionnalité
    // Flexco dans ce lot : conversation.started, message.sent/edited/
    // deleted/delivered/read, reaction.received, review.new/updated
    // (aucune fonctionnalité "avis" dans Flexco à ce jour — voir
    // RAPPORT_LOT_3.md, section Missing). Logué proprement plutôt que
    // silencieusement ignoré (section 44 : "Les événements non supportés
    // doivent être loggés proprement").
    default:
      console.info(`Zernio webhook: événement "${raw.event}" reçu mais non traité par ce lot (id=${raw.id}).`);
      return null;
  }
}

/**
 * Lot M, Partie 2 — traduit un événement webhook `post.*` (voir types.ts)
 * en `SOCIAL_POST_STATUS_UPDATED`. Seul endroit qui connaît la forme brute
 * Zernio pour cette catégorie d'événement, même discipline que
 * `mapZernioEventToDomainEvent` ci-dessus.
 *
 * `null` pour tout event qu'on ne traite pas activement dans ce lot
 * (post.scheduled/post.cancelled/post.recycled — déjà reflétés côté
 * Flexco par nos propres actions schedulePost/cancelPost, pas par une
 * confirmation webhook a posteriori) ou pour un event sans id de post
 * exploitable (jamais deviné).
 */
export function mapZernioPostEventToDomainEvent(
  raw: ZernioPostWebhookEvent,
  organizationId: string,
): SocialPostStatusUpdatedEvent | null {
  const providerPostId = raw.post?._id ?? raw.post?.id ?? raw.postId;
  if (!providerPostId) return null;

  const base = {
    type: "SOCIAL_POST_STATUS_UPDATED" as const,
    organizationId,
    occurredAt: raw.timestamp,
    externalEventId: raw.id,
    sourceProvider: "zernio",
  };

  switch (raw.event) {
    case "post.published":
    case "post.failed":
    case "post.partial": {
      const overallStatus: "published" | "failed" | "partial" =
        raw.event === "post.published" ? "published" : raw.event === "post.failed" ? "failed" : "partial";

      // `platforms[]` peut être absent de l'enveloppe webhook elle-même
      // (voir la note "ENCORE NON CONFIRMÉ" dans types.ts) — quand c'est
      // le cas, `targets` reste vide : le statut agrégé du post est mis
      // à jour quand même, seul le détail par plateforme attendra soit
      // un futur event `post.platform.*`, soit un appel explicite à
      // `getPostStatus` (déjà existant, SocialPublishingProvider).
      const targets = (raw.post?.platforms ?? [])
        .filter((p) => p.status === "published" || p.status === "failed")
        .map((p) => ({
          platform: p.platform,
          accountId: typeof p.accountId === "string" ? p.accountId : p.accountId._id,
          status: p.status as "published" | "failed",
          platformPostId: p.platformPostId,
          platformPostUrl: p.platformPostUrl,
          errorMessage: p.error,
        }));

      return {
        ...base,
        type: "SOCIAL_POST_STATUS_UPDATED",
        payload: {
          providerPostId,
          overallStatus,
          overallErrorMessage: raw.post?.error ?? raw.error,
          targets,
        },
      };
    }

    case "post.platform.published":
    case "post.platform.failed": {
      // Granularité fine : un seul résultat de plateforme par event.
      // CONFIRMÉ pour le nom de l'event uniquement — le placement exact
      // des champs `platform`/`accountId` (racine du payload, pas
      // `post.platforms[0]`) est une hypothèse raisonnable par symétrie
      // avec l'enveloppe inbox, pas 100% vérifiée verbatim (voir types.ts).
      const platform = raw.platform ?? raw.post?.platforms?.[0]?.platform;
      const rawAccountId = raw.accountId ?? raw.post?.platforms?.[0]?.accountId;
      const accountId = typeof rawAccountId === "string" ? rawAccountId : rawAccountId?._id;
      if (!platform || !accountId) return null;

      const status: "published" | "failed" = raw.event === "post.platform.published" ? "published" : "failed";

      return {
        ...base,
        type: "SOCIAL_POST_STATUS_UPDATED",
        payload: {
          providerPostId,
          targets: [
            {
              platform,
              accountId,
              status,
              platformPostUrl: raw.platformPostUrl ?? raw.post?.platforms?.[0]?.platformPostUrl,
              errorMessage: raw.error ?? raw.post?.platforms?.[0]?.error,
            },
          ],
        },
      };
    }

    default:
      return null;
  }
}

/**
 * Lot 5 — traduit un événement `post.external.*` (post détecté
 * nativement sur la plateforme, voir types.ts) en `EXTERNAL_POST_TRACKED`.
 * Volontairement séparé de `mapZernioPostEventToDomainEvent` ci-dessus :
 * forme de payload différente (`ZernioExternalPostWebhookPost`, pas
 * `ZernioPostResource`) et sémantique différente (un post qui existe
 * DÉJÀ sur la plateforme, jamais un statut de publication Flexco).
 */
export function mapZernioExternalPostEventToDomainEvent(
  raw: ZernioExternalPostWebhookEvent,
  organizationId: string,
): ExternalPostTrackedEvent | null {
  if (!raw.post?.id) return null;

  return {
    type: "EXTERNAL_POST_TRACKED",
    organizationId,
    occurredAt: raw.timestamp,
    externalEventId: raw.id,
    sourceProvider: "zernio",
    payload: {
      providerPostId: raw.post.id,
      providerAccountId: raw.account.id,
      platform: raw.post.platform ?? raw.account.platform,
      deleted: raw.event === "post.external.deleted",
    },
  };
}
