import type {
  DomainEvent,
  MessageReceivedEvent,
  MessageFailedEvent,
  ProviderAccountStatusUpdatedEvent,
  SocialPostStatusUpdatedEvent,
  CommentReceivedEvent,
  ExternalPostTrackedEvent,
} from "@/domain/events/domain-events";
import type { ZernioInboxWebhookEvent, ZernioPostWebhookEvent, ZernioExternalPostWebhookEvent } from "./types";

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
          providerAccountId: raw.account.id,
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
          content: raw.comment.message,
        },
      };
      return event;
    }

    // Confirmés (types.ts) mais pas encore consommés par une fonctionnalité
    // CRESYVA dans ce lot : conversation.started, message.sent/edited/
    // deleted/delivered/read, reaction.received, review.new/updated
    // (aucune fonctionnalité "avis" dans CRESYVA à ce jour — voir
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
 * CRESYVA par nos propres actions schedulePost/cancelPost, pas par une
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
 * DÉJÀ sur la plateforme, jamais un statut de publication CRESYVA).
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
