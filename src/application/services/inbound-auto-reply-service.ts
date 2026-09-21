import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { routeMessage } from "./conversation-orchestrator";
import { escalateToHuman, getAutoReplyMode, notifyUnansweredInboundMessage } from "./handoff-service";
import { resolveMessagingPolicy } from "./messaging-policy-service";
import { detectBroadcastOptOut } from "./contact-broadcast-service";

/**
 * Lot O — pipeline unique « message entrant → réponse automatique » pour
 * TOUS les canaux (WhatsApp, Telegram, Messenger, Instagram). Il
 * remplace le bloc dupliqué des webhooks Zernio et Telegram et applique
 * la politique de messagerie de l'offre :
 *
 *  Discover (semi-automatique) : FAQ → infos entreprise → catalogue ; si
 *  rien ne correspond, escalade `semi_automatic` + accusé de réception,
 *  sans jamais appeler l'IA.
 *  Starter/Pro (automatique) : même chaîne puis IA en dernier recours.
 */
export const SEMI_AUTOMATIC_COURTESY_MESSAGE =
  "Merci pour votre message ! Un membre de l'équipe vous répondra dès que possible.";

export type InboundAutoReplyOutcome = "replied" | "escalated" | "unanswered";

export interface AutoReplyPayload {
  text: string;
  imageUrl?: string | null;
}

export interface InboundAutoReplyParams {
  organizationId: string;
  conversationId: string;
  content: string;
  contactFullName?: string | null;
  hasAttachment?: boolean;
  handoffStatus: string;
  handoffReason: string | null | undefined;
  /** Réglage par compte (ex: réponses automatiques désactivées sur cette page Facebook). */
  autoReplyAllowed?: boolean;
  /** Envoie la réponse par le canal d'origine (fournisseur résolu par l'appelant). */
  send: (reply: AutoReplyPayload) => Promise<void>;
}

async function sendAndStore(
  params: InboundAutoReplyParams,
  reply: AutoReplyPayload,
  metadata: { intent: string; ai_invoked: boolean },
): Promise<void> {
  await params.send(reply);
  const supabase = getSupabaseServiceClient();
  await supabase.from("messages").insert({
    organization_id: params.organizationId,
    conversation_id: params.conversationId,
    direction: "outbound",
    // `sender: "ai"` couvre toute réponse automatique (FAQ, catalogue,
    // infos entreprise ou LLM) — le détail est dans `metadata.intent`.
    sender: "ai",
    content: reply.text,
    metadata,
  });
}

export const BROADCAST_OPT_OUT_CONFIRMATION = "C'est noté : vous ne recevrez plus nos diffusions. Vous pouvez toujours nous écrire.";

/** « STOP » : le contact de la conversation est désinscrit des diffusions, avec confirmation. */
async function applyBroadcastOptOut(params: InboundAutoReplyParams): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { data: conversation } = await supabase.from("conversations").select("contact_id").eq("id", params.conversationId).eq("organization_id", params.organizationId).maybeSingle();
  if (!conversation?.contact_id) return false;
  await supabase.from("contacts").update({ broadcast_opt_out: true, broadcast_opt_out_at: new Date().toISOString() }).eq("id", conversation.contact_id).eq("organization_id", params.organizationId);
  try {
    await sendAndStore(params, { text: BROADCAST_OPT_OUT_CONFIRMATION }, { intent: "broadcast_opt_out", ai_invoked: false });
  } catch (error) {
    console.warn(`processInboundAutoReply: confirmation de désinscription non envoyée (org ${params.organizationId}):`, error);
  }
  return true;
}

export async function processInboundAutoReply(params: InboundAutoReplyParams): Promise<InboundAutoReplyOutcome> {
  const { organizationId, conversationId } = params;
  if (detectBroadcastOptOut(params.content) && (await applyBroadcastOptOut(params))) return "replied";
  const policy = await resolveMessagingPolicy(organizationId);
  const autoReplyMode = getAutoReplyMode(params.handoffStatus, params.handoffReason);
  let outcome: InboundAutoReplyOutcome = "unanswered";

  if (policy.mode !== "off" && autoReplyMode !== "none" && params.autoReplyAllowed !== false) {
    const routing = await routeMessage(organizationId, conversationId, params.content, {
      // `deterministic_only` (IA indisponible ou escalade semi-automatique déjà
      // faite) : FAQ/catalogue/infos restent permis, jamais l'IA.
      allowAI: autoReplyMode === "full" && policy.allowAI,
    });

    if (routing.handoffReason) {
      await escalateToHuman(organizationId, conversationId, routing.handoffReason);
      outcome = "escalated"; // escalateToHuman notifie déjà les admins
    }

    if (routing.replyText) {
      await sendAndStore(params, { text: routing.replyText, imageUrl: routing.replyImageUrl }, { intent: routing.intent, ai_invoked: routing.aiInvoked });
      outcome = "replied";
    } else if (autoReplyMode === "full" && !policy.allowAI && !routing.handoffReason) {
      // Semi-automatique : rien dans la FAQ / les infos / le catalogue ne
      // correspond → un humain prend le relais, le client est prévenu.
      await escalateToHuman(organizationId, conversationId, "semi_automatic");
      outcome = "escalated";
      try {
        await sendAndStore(params, { text: SEMI_AUTOMATIC_COURTESY_MESSAGE }, { intent: "semi_automatic_handoff", ai_invoked: false });
      } catch (error) {
        console.warn(`processInboundAutoReply: accusé de réception non envoyé (org ${organizationId}):`, error);
      }
    }
  }

  if (outcome === "unanswered") {
    await notifyUnansweredInboundMessage(organizationId, conversationId, params.contactFullName, params.content, Boolean(params.hasAttachment));
  }
  return outcome;
}
