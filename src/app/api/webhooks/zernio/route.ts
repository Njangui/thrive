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
} from "@/infrastructure/providers/messaging/zernio/mapper";
import { isZernioPostEvent } from "@/infrastructure/providers/messaging/zernio/types";
import {
  resolveOrganizationIdByZernioAccount,
  resolveOrganizationIdByProviderPostId,
} from "@/infrastructure/providers/messaging/zernio/resolve-organization";
import { handleInboundMessage } from "@/application/services/conversation-service";
import { routeMessage } from "@/application/services/conversation-orchestrator";
import { escalateToHuman } from "@/application/services/handoff-service";
import { getMessagingProvider } from "@/infrastructure/providers/registry";
import { activateGroupFromInboundConversation } from "@/application/services/whatsapp-group-service";
import { handlePostStatusWebhook } from "@/application/services/marketing-service";

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
 */
export async function POST(request: Request) {
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

    const organizationId = isZernioPostEvent(rawEvent)
      ? await resolveOrganizationIdByProviderPostId(
          rawEvent.post?._id ?? rawEvent.post?.id ?? rawEvent.postId ?? "",
        )
      : await resolveOrganizationIdByZernioAccount(rawEvent.account.id);

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

      // Lot M, Partie 1 — active un groupe WhatsApp connecté dès qu'un
      // premier message EN provient, indépendamment du fait que ce
      // message produise ou non un DomainEvent complet ci-dessous (un
      // message de groupe purement média, sans texte, établit quand même
      // la conversation côté Zernio). Best-effort, jamais bloquant.
      if (rawEvent.event === "message.received" && rawEvent.conversation?.id) {
        await activateGroupFromInboundConversation(organizationId, rawEvent.conversation.id);
      }

      const domainEvent = mapZernioEventToDomainEvent(rawEvent, organizationId);
      if (!domainEvent) {
        await markWebhookEvent(externalEventId, "ignored_duplicate");
        continue;
      }

      if (domainEvent.type === "MESSAGE_RECEIVED") {
        const result = await handleInboundMessage(domainEvent);

        // Le ConversationOrchestrator est le SEUL point d'entrée vers une
        // réponse (section 17/45 doc 2) : règles/FAQ/catalogue/business
        // data d'abord, IA en dernier recours. Ne jamais appeler l'IA
        // directement ici — voir docs/GAP_ANALYSIS.md section L.
        const routing = await routeMessage(organizationId, result.conversationId, domainEvent.payload.content);

        if (routing.handoffReason) {
          await escalateToHuman(organizationId, result.conversationId, routing.handoffReason);
        }

        if (routing.replyText) {
          const messaging = await getMessagingProvider(organizationId);
          await messaging.sendMessage(organizationId, {
            to: domainEvent.payload.phoneE164 ?? domainEvent.payload.externalContactId,
            channel: "whatsapp",
            content: routing.replyText,
            // CONFIRMÉ : répondre via Zernio exige le conversationId, pas
            // juste un numéro — voir adapter.ts.
            externalThreadId: domainEvent.payload.externalThreadId,
          });

          await supabase.from("messages").insert({
            organization_id: organizationId,
            conversation_id: result.conversationId,
            direction: "outbound",
            // `sender: "ai"` couvre toute réponse automatique (FAQ, catalogue,
            // business data ou vrai LLM) — le détail exact est dans
            // `metadata.intent` pour l'observabilité (section 48).
            sender: "ai",
            content: routing.replyText,
            metadata: { intent: routing.intent, ai_invoked: routing.aiInvoked },
          });
        }
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
