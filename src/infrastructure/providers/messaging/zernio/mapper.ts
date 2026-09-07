import type { DomainEvent, MessageReceivedEvent, SocialPostStatusUpdatedEvent } from "@/domain/events/domain-events";
import type { ZernioInboxWebhookEvent, ZernioPostWebhookEvent } from "./types";

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

/**
 * Lot M, Partie 2 — traduit un événement webhook `post.*` (voir types.ts)
 * en `SOCIAL_POST_STATUS_UPDATED`. Seul endroit qui connaît la forme brute
 * Zernio pour cette catégorie d'événement, même discipline que
 * `mapZernioEventToDomainEvent` ci-dessus.
 *
 * `null` pour tout event qu'on ne traite pas activement dans ce lot
 * (post.scheduled/post.cancelled/post.recycled — déjà reflétés côté
 * SME-OS par nos propres actions schedulePost/cancelPost, pas par une
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
