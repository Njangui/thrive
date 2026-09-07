import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getMessagingProvider } from "@/infrastructure/providers/registry";
import { NotFoundError, ValidationError } from "@/lib/errors";

export interface ConversationListItem {
  id: string;
  contactName: string | null;
  contactPhone: string | null;
  handoffStatus: string;
  handoffReason: string | null;
  lastMessageAt: string | null;
}

/** Section 49 : liste triée pour que l'admin voie d'abord ce qui a besoin de lui. */
export async function listConversationsForOrg(organizationId: string): Promise<ConversationListItem[]> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("conversations")
    .select("id, handoff_status, handoff_reason, last_message_at, contacts(full_name, phone_e164)")
    .eq("organization_id", organizationId)
    .order("last_message_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(`Erreur lecture conversations: ${error.message}`);

  const items = (data ?? []).map((c) => ({
    id: c.id,
    contactName: (c as unknown as { contacts?: { full_name?: string } }).contacts?.full_name ?? null,
    contactPhone: (c as unknown as { contacts?: { phone_e164?: string } }).contacts?.phone_e164 ?? null,
    handoffStatus: c.handoff_status,
    handoffReason: c.handoff_reason,
    lastMessageAt: c.last_message_at,
  }));

  // Priorité : ce qui attend un humain en premier (section 49).
  return items.sort((a, b) => {
    if (a.handoffStatus === "pending_human" && b.handoffStatus !== "pending_human") return -1;
    if (b.handoffStatus === "pending_human" && a.handoffStatus !== "pending_human") return 1;
    return 0;
  });
}

export interface ConversationThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  sender: "contact" | "ai" | "human";
  content: string;
  createdAt: string;
}

export interface ConversationThread {
  id: string;
  externalThreadId: string | null;
  handoffStatus: string;
  handoffReason: string | null;
  contactName: string | null;
  contactPhone: string | null;
  messages: ConversationThreadMessage[];
}

// OPTIMISATION : cette fonction chargeait TOUT l'historique de messages
// d'une conversation, sans limite. Sans risque pour une conversation
// jeune, mais une conversation WhatsApp active peut s'étaler sur des mois
// — le master prompt exige la pagination pour ce type d'écran (section
// 73) et met explicitement en garde contre l'envoi d'un historique non
// borné (section 33, certes à propos du contexte IA, pas de l'affichage
// humain, mais le principe "ne pas charger un historique illimité"
// s'applique tout autant ici). On charge les MESSAGES_PAGE_SIZE plus
// récents (tri desc côté requête, où l'index existe déjà via
// created_at), puis on ré-ordonne en mémoire pour l'affichage
// chronologique attendu par `conversation-thread-view.tsx`.
const MESSAGES_PAGE_SIZE = 200;

export async function getConversationThread(
  organizationId: string,
  conversationId: string,
): Promise<ConversationThread> {
  const supabase = getSupabaseServiceClient();

  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select("id, external_thread_id, handoff_status, handoff_reason, contacts(full_name, phone_e164)")
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .maybeSingle();

  if (convError) throw new Error(`Erreur lecture conversation: ${convError.message}`);
  if (!conversation) throw new NotFoundError("Conversation introuvable");

  const { data: recentMessagesDesc, error: messagesError } = await supabase
    .from("messages")
    .select("id, direction, sender, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(MESSAGES_PAGE_SIZE);

  if (messagesError) throw new Error(`Erreur lecture messages: ${messagesError.message}`);

  const messages = (recentMessagesDesc ?? []).slice().reverse();

  return {
    id: conversation.id,
    externalThreadId: conversation.external_thread_id,
    handoffStatus: conversation.handoff_status,
    handoffReason: conversation.handoff_reason,
    contactName: (conversation as unknown as { contacts?: { full_name?: string } }).contacts?.full_name ?? null,
    contactPhone: (conversation as unknown as { contacts?: { phone_e164?: string } }).contacts?.phone_e164 ?? null,
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      sender: m.sender,
      content: m.content,
      createdAt: m.created_at,
    })),
  };
}

/**
 * Section 22 : pendant HUMAN_ACTIVE, l'IA ne doit plus répondre
 * automatiquement — déjà garanti par le fait que le webhook ne déclenche
 * l'orchestrateur que sur un nouveau message entrant, et que le statut
 * passe explicitement à 'human' ici.
 */
export async function sendHumanReply(
  organizationId: string,
  conversationId: string,
  content: string,
  actorUserId: string,
): Promise<void> {
  if (!content.trim()) throw new ValidationError("Le message ne peut pas être vide");

  const supabase = getSupabaseServiceClient();

  const { data: conversation, error } = await supabase
    .from("conversations")
    .select("external_thread_id, contacts(phone_e164)")
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .single();

  if (error || !conversation?.external_thread_id) {
    throw new NotFoundError("Conversation introuvable ou sans thread provider");
  }

  const contactPhone = (conversation as unknown as { contacts?: { phone_e164?: string } }).contacts?.phone_e164;

  const messaging = await getMessagingProvider(organizationId);
  await messaging.sendMessage(organizationId, {
    to: contactPhone ?? conversation.external_thread_id,
    channel: "whatsapp",
    content,
    externalThreadId: conversation.external_thread_id,
  });

  await supabase.from("messages").insert({
    organization_id: organizationId,
    conversation_id: conversationId,
    direction: "outbound",
    sender: "human",
    content,
  });

  await supabase
    .from("conversations")
    .update({ handoff_status: "human", assigned_user_id: actorUserId, last_message_at: new Date().toISOString() })
    .eq("id", conversationId);
}

export async function returnConversationToAI(organizationId: string, conversationId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  await supabase
    .from("conversations")
    .update({ handoff_status: "ai", handoff_reason: null })
    .eq("organization_id", organizationId)
    .eq("id", conversationId);
}

export async function closeConversation(organizationId: string, conversationId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  await supabase
    .from("conversations")
    .update({ handoff_status: "resolved" })
    .eq("organization_id", organizationId)
    .eq("id", conversationId);
}
