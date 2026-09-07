import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import type { MessageReceivedEvent } from "@/domain/events/domain-events";
import { findOrCreateOpenLead, computeRuleBasedScore } from "./lead-service";

export interface HandleInboundMessageResult {
  contactId: string;
  conversationId: string;
  leadId: string;
  messageId: string;
}

/**
 * Traite un MESSAGE_RECEIVED normalisé (peu importe le provider d'origine).
 * Implémente les étapes 6 à 13 du workflow central (section 64) :
 * message normalisé -> conversation -> contact -> lead -> score.
 *
 * La génération de réponse IA et l'envoi (étapes 10-11) sont volontairement
 * hors de ce service — voir application/services/ai-response-service.ts
 * (Phase 8) pour ne pas coupler CRM et AI Gateway.
 */
export async function handleInboundMessage(
  event: MessageReceivedEvent,
): Promise<HandleInboundMessageResult> {
  const supabase = getSupabaseServiceClient();
  const { organizationId, payload } = event;

  // 1. Contact : upsert par (organization_id, phone_e164)
  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .upsert(
      {
        organization_id: organizationId,
        phone_e164: payload.phoneE164 ?? null,
        full_name: payload.contactFullName ?? null,
        source_channel: payload.channel,
      },
      { onConflict: "organization_id,phone_e164" },
    )
    .select("id")
    .single();

  if (contactError || !contact) {
    throw new Error(`Impossible d'upsert le contact: ${contactError?.message}`);
  }

  // 2. Conversation : upsert par (organization_id, channel, external_thread_id)
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .upsert(
      {
        organization_id: organizationId,
        contact_id: contact.id,
        channel: payload.channel,
        external_thread_id: payload.externalThreadId,
        last_message_at: event.occurredAt,
      },
      { onConflict: "organization_id,channel,external_thread_id" },
    )
    .select("id")
    .single();

  if (conversationError || !conversation) {
    throw new Error(`Impossible d'upsert la conversation: ${conversationError?.message}`);
  }

  // 3. Message (l'idempotence globale du webhook est déjà garantie en amont
  // par webhook_events — voir app/api/webhooks/zernio/route.ts)
  const { data: message, error: messageError } = await supabase
    .from("messages")
    .insert({
      organization_id: organizationId,
      conversation_id: conversation.id,
      direction: "inbound",
      sender: "contact",
      content: payload.content,
      external_message_id: payload.externalMessageId,
    })
    .select("id")
    .single();

  if (messageError || !message) {
    throw new Error(`Impossible d'enregistrer le message: ${messageError?.message}`);
  }

  // 4. Lead : récupère un lead ouvert existant ou en crée un
  const lead = await findOrCreateOpenLead(organizationId, contact.id, payload.channel);

  // 5. Score V1 (rule-based, section 12) — recalculé à chaque message entrant
  await computeRuleBasedScore(lead.id);

  return {
    contactId: contact.id,
    conversationId: conversation.id,
    leadId: lead.id,
    messageId: message.id,
  };
}
