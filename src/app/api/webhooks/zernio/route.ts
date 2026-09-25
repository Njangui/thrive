import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import {
  hashPayload,
  parseZernioWebhookPayload,
  verifyZernioSignature,
} from "@/infrastructure/providers/messaging/zernio/webhook-handler";
import {
  mapZernioEventToDomainEvent,
  mapZernioPostEventToDomainEvent,
  mapZernioExternalPostEventToDomainEvent,
} from "@/infrastructure/providers/messaging/zernio/mapper";
import { isZernioPostEvent, isZernioExternalPostEvent } from "@/infrastructure/providers/messaging/zernio/types";
import {
  resolveOrganizationIdByZernioAccount,
  resolveOrganizationIdByZernioAccountAnyStatus,
  resolveOrganizationIdByProviderPostId,
  resolveOrganizationIdBySocialProfile,
  resolveOrganizationIdByWhatsAppGroupsAccount,
} from "@/infrastructure/providers/messaging/zernio/resolve-organization";
import { handleInboundMessage } from "@/application/services/conversation-service";
import { processInboundAutoReply } from "@/application/services/inbound-auto-reply-service";
import { handleTikTokUrlResolvedWebhook } from "@/application/services/first-comment-service";
import { processCommentAutoReply } from "@/application/services/comment-auto-reply-service";
import { evaluateInboxChannel } from "@/application/services/inbox-channel-policy";
import { resolveOrganizationIdBySocialAccount, setSocialAccountStatus } from "@/application/services/social-account-registry-service";
import { getMessagingProviderForChannel } from "@/infrastructure/providers/registry";
import { activateGroupFromInboundConversation } from "@/application/services/whatsapp-group-service";
import { isWhatsAppGroupThread } from "@/application/services/whatsapp-group-threads";
import { handlePostStatusWebhook } from "@/application/services/marketing-service";
import { handleAccountStatusChanged } from "@/application/services/provider-connection-service";
import { notifyOrgAdmins } from "@/application/services/notification-service";
import { trackExternalPost, handleIncomingComment } from "@/application/services/social-post-tracking-service";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Pipeline (section 37) :
 * External Webhook -> Signature Verification -> Provider Adapter ->
 * Normalize Event -> Internal Event -> Application Service -> DB/AI
 *
 * Toujours répondre 200 rapidement même en cas d'événement ignoré/dupliqué,
 * pour éviter que Zernio ne retente indéfiniment (section 38).
 *
 * Lot M — ce même webhook reçoit maintenant deux catégories d'événements
 * qui partagent l'enveloppe/la signature/la déduplication mais divergent
 * ensuite : inbox (`message.*`/`reaction.*`/`comment.*`/`review.*`,
 * routées par `account.id`) et publications (`post.*`, routées par
 * `social_posts.provider_post_id` — voir resolve-organization.ts pour le
 * détail de pourquoi `account.id` n'est pas fiable pour cette catégorie).
 *
 * Repasse sécurité P0 (07/09/2026, section 12 de la mission) : rate
 * limiting ajouté — absent jusqu'ici alors que le webhook NotchPay
 * (même famille, même exposition publique) en a un depuis son origine.
 * Ce webhook fait PLUS de travail par requête que NotchPay (route
 * jusqu'à l'IA, l'activation de groupe, les publications) — au moins
 * aussi justifié d'être protégé. Vérifié AVANT la vérification de
 * signature, même raisonnement que NotchPay : un flood ne doit pas
 * faire consommer du temps de vérification cryptographique pour rien.
 */
export async function POST(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const clientIp = forwardedFor?.split(",")[0]?.trim() ?? "unknown";
  const retryAfter = await checkRateLimit("webhook", clientIp);
  if (retryAfter !== null) {
    return NextResponse.json({ error: "too many requests" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  const rawBody = await request.text();
  // CONFIRMÉ (docs.zernio.com/webhooks) : header `X-Zernio-Signature`.
  const signature = request.headers.get("x-zernio-signature");

  if (!verifyZernioSignature(rawBody, signature, env.ZERNIO_WEBHOOK_SIGNING_SECRET ?? "")) {
    console.warn("Zernio webhook: signature invalide, rejeté.");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const supabase = getSupabaseServiceClient();
  const rawEvents = parseZernioWebhookPayload(rawBody);

  for (const rawEvent of rawEvents) {
    // CONFIRMÉ : `id` (racine du payload) est la clé de déduplication
    // officielle (== header X-Zernio-Event-Id), pour TOUTE catégorie
    // d'événement.
    const externalEventId = rawEvent.id;

    // CORRECTIF (15/09/2026) : le bouton "Send test webhook" du dashboard
    // Zernio envoie `{ id, event: "webhook.test", message, timestamp }` —
    // un événement hors de toute catégorie confirmée (ni `post.*`, ni
    // inbox), sans `account`. Le code plus bas suppose `rawEvent.account.id`
    // dès qu'il ne s'agit pas d'un post event, ce qui plantait sur ce
    // payload (TypeError: Cannot read properties of undefined (reading
    // 'id')) -> 500 -> "Send test webhook" échoue côté Zernio, et par
    // extension tout futur type d'événement non documenté planterait pareil.
    // Comme pour un tenant non résolu juste en dessous (section 38 :
    // toujours 200, jamais de retry inutile), on ignore proprement plutôt
    // que de laisser remonter l'exception.
    // Lot O : `post.tiktok.url_resolved` — l'URL de la vidéo TikTok est connue, le premier
    // commentaire en attente peut partir. Traité avant tout le reste (forme du payload non confirmée).
    if ((rawEvent.event as string) === "post.tiktok.url_resolved") {
      try {
        const outcome = await handleTikTokUrlResolvedWebhook(rawEvent as unknown as Record<string, unknown>);
        console.info(`Zernio webhook: post.tiktok.url_resolved → ${outcome.posted} commentaire(s) posté(s), ${outcome.failed} échec(s).`);
      } catch (error) {
        console.error("Zernio webhook: premier commentaire TikTok impossible:", error);
      }
      continue;
    }

    if (!isZernioPostEvent(rawEvent) && !rawEvent.account?.id) {
      console.info(
        `Zernio webhook: événement "${rawEvent.event}" (${externalEventId}) sans "account" exploitable (ex: test webhook du dashboard), ignoré.`,
      );
      continue;
    }

    // Lot 5 : `post.external.*` et `comment.received` doivent router par
    // `account.profileId`, PAS `account.id` — voir resolve-organization.ts
    // ::resolveOrganizationIdBySocialProfile pour pourquoi (lu dans
    // zernio-channel-service.ts avant d'écrire ceci : la ligne
    // provider_connections 'social' d'un tenant est unique et son
    // metadata.accountId est réécrit à chaque nouvelle connexion — un
    // routage par account.id y résoudrait silencieusement le MAUVAIS
    // tenant dès qu'un deuxième compte social est connecté quelque part).
    // Pas de repli sur account.id ici : un profileId absent du payload
    // doit rester non-résolu (null), jamais deviné.
    const isSocialAccountEvent = isZernioExternalPostEvent(rawEvent) || rawEvent.event === "comment.received";

    // Fusion V22 — correctif : le numéro Zernio DÉDIÉ aux groupes WhatsApp
    // (`resolveOrganizationIdByWhatsAppGroupsAccount`, distinct du compte de
    // messagerie) n'était jamais interrogé ici — ses événements étaient
    // systématiquement ignorés faute de tenant résolu, et l'activation de
    // groupe (juste plus bas) ne se déclenchait donc jamais. `isGroupsAccountEvent`
    // trace le fait que la résolution vient bien de ce compte dédié : TOUT
    // message qui en provient est un message de groupe, indépendamment de
    // whatsapp_groups (un groupe pas encore "connecté" par le marchand doit
    // quand même être traité comme un groupe, jamais comme un client).
    let organizationId: string | null;
    let isGroupsAccountEvent = false;

    if (isZernioPostEvent(rawEvent)) {
      organizationId = await resolveOrganizationIdByProviderPostId(
        rawEvent.post?._id ?? rawEvent.post?.id ?? rawEvent.postId ?? "",
      );
    } else if (isSocialAccountEvent) {
      organizationId =
        (await resolveOrganizationIdBySocialAccount(rawEvent.account.id)) ??
        (rawEvent.account.profileId ? await resolveOrganizationIdBySocialProfile(rawEvent.account.profileId) : null);
    } else if (rawEvent.event === "account.connected" || rawEvent.event === "account.disconnected") {
      // CORRECTIF Lot 3 : account.connected/disconnected doivent rester
      // routables quel que soit le statut ACTUEL de la ligne (c'est
      // justement ce que l'event change) — voir resolve-organization.ts.
      organizationId = await resolveOrganizationIdByZernioAccountAnyStatus(rawEvent.account.id);
    } else {
      organizationId =
        (await resolveOrganizationIdByZernioAccount(rawEvent.account.id)) ??
        // Lot O : comptes Messenger / Instagram (registre social_accounts).
        (await resolveOrganizationIdBySocialAccount(rawEvent.account.id));
      if (!organizationId) {
        organizationId = await resolveOrganizationIdByWhatsAppGroupsAccount(rawEvent.account.id);
        isGroupsAccountEvent = organizationId !== null;
      }
    }

    if (!organizationId) {
      console.warn(`Zernio webhook: aucun tenant résolu pour l'événement ${rawEvent.event} (${externalEventId}), ignoré.`);
      continue;
    }

    // --- Idempotence (section 38) ---
    const { error: insertEventError } = await supabase.from("webhook_events").insert({
      organization_id: organizationId,
      provider: "zernio",
      external_event_id: externalEventId,
      event_type: rawEvent.event,
      payload_hash: hashPayload(rawBody),
      status: "received",
    });

    if (insertEventError) {
      // Violation de la contrainte unique (provider, external_event_id) =
      // événement déjà vu -> on l'ignore silencieusement.
      if (insertEventError.code === "23505") {
        console.info(`Zernio webhook: événement dupliqué ignoré (${externalEventId})`);
        continue;
      }
      console.error("Zernio webhook: échec insertion webhook_events:", insertEventError.message);
      continue;
    }

    try {
      if (isZernioPostEvent(rawEvent)) {
        const postEvent = mapZernioPostEventToDomainEvent(rawEvent, organizationId);
        if (postEvent) {
          await handlePostStatusWebhook(postEvent);
        }
        await markWebhookEvent(externalEventId, "processed");
        continue;
      }

      // Lot 5 — post détecté nativement sur la plateforme (hors Flexco),
      // voir social-post-tracking-service.ts. Catégorie séparée du bloc
      // ci-dessus : forme de payload différente (ZernioExternalPostWebhookPost,
      // pas ZernioPostResource), jamais notre propre pipeline de publication.
      if (isZernioExternalPostEvent(rawEvent)) {
        const externalPostEvent = mapZernioExternalPostEventToDomainEvent(rawEvent, organizationId);
        if (externalPostEvent) {
          await trackExternalPost(externalPostEvent);
        }
        await markWebhookEvent(externalEventId, "processed");
        continue;
      }

      // Lot M, Partie 1 — active un groupe WhatsApp connecté dès qu'un
      // premier message EN provient, indépendamment du fait que ce
      // message produise ou non un DomainEvent complet ci-dessous (un
      // message de groupe purement média, sans texte, établit quand même
      // la conversation côté Zernio). Best-effort, jamais bloquant.
      let isGroupMessage = false;
      if (rawEvent.event === "message.received" && rawEvent.conversation?.id) {
        await activateGroupFromInboundConversation(organizationId, rawEvent.conversation.id);
        // Lot P : un message de groupe WhatsApp connecté (diffusion) ne doit
        // jamais déclencher de réponse automatique — voir
        // whatsapp-group-threads.ts::isWhatsAppGroupThread. Deux façons de
        // le savoir : (1) l'événement vient du compte Zernio DÉDIÉ aux
        // groupes (isGroupsAccountEvent, toujours vrai dans ce cas) ; (2) un
        // groupe reçu par erreur sur le compte de messagerie standard, en
        // défense en profondeur — uniquement pertinent pour WhatsApp, les
        // autres canaux (Messenger/Instagram) n'ont pas de notion de groupe.
        isGroupMessage =
          isGroupsAccountEvent ||
          (rawEvent.account.platform === "whatsapp" && (await isWhatsAppGroupThread(organizationId, rawEvent.conversation.id)));
      }

      const domainEvent = mapZernioEventToDomainEvent(rawEvent, organizationId);
      if (!domainEvent) {
        await markWebhookEvent(externalEventId, "ignored_duplicate");
        continue;
      }

      if (domainEvent.type === "MESSAGE_RECEIVED" && isGroupMessage) {
        console.info(`Zernio webhook: message de groupe WhatsApp connecté (org ${organizationId}), aucune conversation client ni réponse automatique créée.`);
        await markWebhookEvent(externalEventId, "processed");
        continue;
      }

      if (
        domainEvent.type === "MESSAGE_RECEIVED" &&
        domainEvent.payload.channel === "whatsapp" &&
        (await isWhatsAppGroupThread(organizationId, domainEvent.payload.externalThreadId))
      ) {
        // Défense en profondeur (fusion #23, restaurée lors de la fusion Flexco×THRIVE
        // du 23/09/2026) : un fil dont l'identifiant est celui d'un groupe WhatsApp connecté
        // n'est pas une conversation client, même reçu par un compte de messagerie normal —
        // couvre les cas que le contrôle isGroupMessage ci-dessus ne verrait pas (ex.
        // rawEvent.conversation.id absent du payload de cet événement précis).
        console.info(`Zernio webhook: message du groupe WhatsApp ${domainEvent.payload.externalThreadId} (org ${organizationId}) — ignoré, jamais traité comme un client.`);
        await markWebhookEvent(externalEventId, "processed");
        continue;
      }

      if (domainEvent.type === "MESSAGE_RECEIVED") {
        // Lot O — messagerie unifiée : WhatsApp, Messenger et Instagram
        // arrivent par la même boîte Zernio. Un canal non inclus dans l'offre
        // (ou un compte inconnu) est ignoré AVANT toute écriture.
        const inboundChannel = domainEvent.payload.channel;
        const inboxDecision = await evaluateInboxChannel(organizationId, inboundChannel, domainEvent.payload.providerAccountId);
        if (!inboxDecision.allowed) {
          console.info(`Zernio webhook: message ${inboundChannel} ignoré (org ${organizationId}) — ${inboxDecision.reason}`);
          await markWebhookEvent(externalEventId, "ignored_duplicate");
          continue;
        }

        const result = await handleInboundMessage(domainEvent);

        // Le message est toujours enregistré (CRM/historique) ; la réponse
        // automatique suit la politique de l'offre et le réglage du compte —
        // voir inbound-auto-reply-service.ts. Jamais d'IA pendant une prise
        // en charge humaine (handoff-service.ts::getAutoReplyMode).
        await processInboundAutoReply({
          organizationId,
          conversationId: result.conversationId,
          content: domainEvent.payload.content,
          contactFullName: domainEvent.payload.contactFullName,
          hasAttachment: Boolean(domainEvent.payload.attachment),
          handoffStatus: result.handoffStatus,
          handoffReason: result.handoffReason,
          autoReplyAllowed: inboxDecision.autoReply,
          send: async (reply) => {
            const messaging = await getMessagingProviderForChannel(organizationId, inboundChannel, domainEvent.payload.providerAccountId);
            await messaging.sendMessage(organizationId, {
              to: domainEvent.payload.phoneE164 ?? domainEvent.payload.externalContactId,
              channel: inboundChannel as "whatsapp" | "telegram" | "facebook" | "instagram",
              content: reply.text,
              // CONFIRMÉ : répondre via Zernio exige le conversationId, pas juste un numéro.
              externalThreadId: domainEvent.payload.externalThreadId,
              // Image produit jointe quand le routage en a résolu une.
              attachmentUrl: reply.imageUrl ?? undefined,
              attachmentType: reply.imageUrl ? "image" : undefined,
            });
          },
        });
      }

      // Lot 5 — synchronisation temps réel des commentaires (ferme le
      // TODO "un webhook temps réel dédié reste à construire" laissé par
      // le Lot M/I, voir docs/ZERNIO_INTEGRATION.md). Fonctionne quel que
      // soit l'endroit où le post a été publié : trackExternalPost
      // (ci-dessus) fait exister la ligne locale nécessaire pour un post
      // publié hors Flexco, handleIncomingComment recrée cette ligne à
      // la volée en filet de sécurité si besoin (voir social-post-
      // tracking-service.ts).
      if (domainEvent.type === "COMMENT_RECEIVED") {
        const storedComment = await handleIncomingComment(domainEvent);
        // Lot O : réponse automatique (Facebook / Instagram), même pipeline que
        // la messagerie. Best-effort : une erreur ne doit jamais faire échouer
        // l'accusé de réception du webhook (le commentaire est déjà enregistré).
        if (storedComment) {
          await processCommentAutoReply({
            organizationId,
            commentId: storedComment.commentId,
            platform: domainEvent.payload.platform ?? "",
            accountId: domainEvent.payload.providerAccountId,
            providerPostId: domainEvent.payload.providerPostId,
            externalCommentId: domainEvent.payload.externalCommentId,
            authorExternalId: domainEvent.payload.authorExternalId,
            authorName: domainEvent.payload.authorName,
            content: domainEvent.payload.content,
          }).catch((error) => console.error("Zernio webhook: réponse automatique au commentaire impossible:", error));
        }
      }

      // CORRECTIF Lot 3 (audit master prompt §44) : message.failed
      // confirmé mais jamais traité jusqu'ici.
      if (domainEvent.type === "MESSAGE_FAILED") {
        await notifyOrgAdmins({
          organizationId,
          title: "Message non délivré.",
          body: domainEvent.payload.errorMessage
            ? `Un message n'a pas pu être envoyé : ${domainEvent.payload.errorMessage}`
            : "Un message n'a pas pu être envoyé. Vérifiez la connexion du canal concerné.",
          relatedEntityType: "message",
          relatedEntityId: domainEvent.payload.externalMessageId,
        });
      }

      // CORRECTIF Lot 3 (audit master prompt §32/§44) : account.connected/
      // disconnected confirmés mais jamais traités jusqu'ici — voir
      // provider-connection-service.ts.
      if (domainEvent.type === "PROVIDER_ACCOUNT_STATUS_UPDATED") {
        await handleAccountStatusChanged(organizationId, domainEvent.payload.accountId, domainEvent.payload.status);
        // Lot O : le registre des comptes suit l'état réel (quotas cumulés exacts).
        await setSocialAccountStatus(domainEvent.payload.accountId, domainEvent.payload.status === "connected" ? "connected" : "disconnected");
      }

      await markWebhookEvent(externalEventId, "processed");
    } catch (processingError) {
      console.error("Zernio webhook: échec traitement événement:", processingError);
      await markWebhookEvent(
        externalEventId,
        "failed",
        processingError instanceof Error ? processingError.message : String(processingError),
      );
    }
  }

  return NextResponse.json({ ok: true });
}

async function markWebhookEvent(externalEventId: string, status: string, errorMessage?: string) {
  const supabase = getSupabaseServiceClient();
  await supabase
    .from("webhook_events")
    .update({ status, processed_at: new Date().toISOString(), error_message: errorMessage })
    .eq("provider", "zernio")
    .eq("external_event_id", externalEventId);
}