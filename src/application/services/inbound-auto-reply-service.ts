import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { isInboundAttachmentPlaceholder } from "@/domain/events/domain-events";
import { routeMessage, type OrchestrationResult } from "./conversation-orchestrator";
import {
  escalateToHuman,
  getAutoReplyMode,
  notifyAutoReplyFailed,
  notifyUnansweredInboundMessage,
  type AutoReplyMode,
} from "./handoff-service";
import { resolveMessagingPolicy, type MessagingPolicy } from "./messaging-policy-service";
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
 *
 * Lot P — règle d'or : AUCUN message client ne reste sans réaction.
 *  - rien ne correspond (IA indisponible, offre semi-automatique, plainte,
 *    erreur technique, message avec pièce jointe seule) → accusé de réception
 *    poli au client (au plus un par fenêtre, pas de spam) + notification du
 *    commerçant ;
 *  - un envoi qui échoue prévient le commerçant au lieu de faire échouer le
 *    webhook en silence ;
 *  - une conversation en attente parce que l'IA était indisponible RÉESSAIE
 *    l'IA quand l'offre l'autorise (elle a pu être activée / rétablie).
 */
export const SEMI_AUTOMATIC_COURTESY_MESSAGE =
  "Merci pour votre message ! Un membre de l'équipe vous répondra dès que possible.";

/** Intentions (`messages.metadata.intent`) des accusés de réception — servent à ne pas les répéter. */
export const COURTESY_ACK_INTENTS = ["semi_automatic_handoff", "ai_unavailable_handoff", "courtesy_ack"] as const;
type CourtesyAckIntent = (typeof COURTESY_ACK_INTENTS)[number];
/** Un même accusé de réception n'est pas renvoyé pendant cette durée. */
export const COURTESY_ACK_WINDOW_MINUTES = 30;

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

/**
 * Envoie puis enregistre la réponse. Renvoie `false` (sans lever) si l'envoi
 * échoue : l'appelant décide quoi faire (prévenir le commerçant). Une
 * réponse qui n'est pas partie n'est JAMAIS enregistrée comme envoyée.
 */
async function sendAndStore(
  params: InboundAutoReplyParams,
  reply: AutoReplyPayload,
  metadata: { intent: string; ai_invoked: boolean },
): Promise<boolean> {
  try {
    await params.send(reply);
  } catch (error) {
    console.error(`processInboundAutoReply: envoi impossible (org ${params.organizationId}, conversation ${params.conversationId}, intent ${metadata.intent}):`, error);
    return false;
  }
  try {
    const supabase = getSupabaseServiceClient();
    const { error } = await supabase.from("messages").insert({
      organization_id: params.organizationId,
      conversation_id: params.conversationId,
      direction: "outbound",
      // `sender: "ai"` couvre toute réponse automatique (FAQ, catalogue,
      // infos entreprise ou LLM) — le détail est dans `metadata.intent`.
      sender: "ai",
      content: reply.text,
      metadata,
    });
    if (error) console.error(`processInboundAutoReply: réponse envoyée mais non enregistrée (conversation ${params.conversationId}):`, error.message);
  } catch (error) {
    console.error(`processInboundAutoReply: réponse envoyée mais non enregistrée (conversation ${params.conversationId}):`, error);
  }
  return true;
}

/** Le dernier message sortant est-il déjà un accusé de réception récent ? */
async function courtesyAckRecentlySent(params: InboundAutoReplyParams): Promise<boolean> {
  try {
    const { data } = await getSupabaseServiceClient()
      .from("messages")
      .select("created_at, metadata")
      .eq("conversation_id", params.conversationId)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return false;
    const intent = (data.metadata as { intent?: string } | null)?.intent;
    if (!intent || !(COURTESY_ACK_INTENTS as readonly string[]).includes(intent)) return false;
    return Date.now() - new Date(data.created_at as string).getTime() < COURTESY_ACK_WINDOW_MINUTES * 60_000;
  } catch {
    return false;
  }
}

/** Accuse réception au client (une fois par fenêtre). Ne lève jamais. */
async function sendCourtesyAck(params: InboundAutoReplyParams, intent: CourtesyAckIntent): Promise<void> {
  if (await courtesyAckRecentlySent(params)) return;
  const sent = await sendAndStore(params, { text: SEMI_AUTOMATIC_COURTESY_MESSAGE }, { intent, ai_invoked: false });
  if (!sent) console.warn(`processInboundAutoReply: accusé de réception non envoyé (org ${params.organizationId}).`);
}

function courtesyIntentFor(reason: string | null | undefined): CourtesyAckIntent {
  if (reason === "semi_automatic") return "semi_automatic_handoff";
  if (reason === "ai_unavailable") return "ai_unavailable_handoff";
  return "courtesy_ack";
}

export const BROADCAST_OPT_OUT_CONFIRMATION = "C'est noté : vous ne recevrez plus nos diffusions. Vous pouvez toujours nous écrire.";

/** « STOP » : le contact de la conversation est désinscrit des diffusions, avec confirmation. */
async function applyBroadcastOptOut(params: InboundAutoReplyParams): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { data: conversation } = await supabase.from("conversations").select("contact_id").eq("id", params.conversationId).eq("organization_id", params.organizationId).maybeSingle();
  if (!conversation?.contact_id) return false;
  await supabase.from("contacts").update({ broadcast_opt_out: true, broadcast_opt_out_at: new Date().toISOString() }).eq("id", conversation.contact_id).eq("organization_id", params.organizationId);
  const sent = await sendAndStore(params, { text: BROADCAST_OPT_OUT_CONFIRMATION }, { intent: "broadcast_opt_out", ai_invoked: false });
  if (!sent) console.warn(`processInboundAutoReply: confirmation de désinscription non envoyée (org ${params.organizationId}).`);
  return true;
}

/** Message dont le seul contenu est une pièce jointe (vocal, photo, document) : aucun texte à interpréter. */
function isAttachmentOnly(params: InboundAutoReplyParams): boolean {
  // CORRECTIF Lot P : reconnaît le texte de remplacement même quand
  // `hasAttachment` est resté `false` — c'est le cas quand la pièce jointe
  // n'exposait pas d'URL exploitable (forme non confirmée par Zernio, voir
  // zernio/mapper.ts::extractZernioAttachment) : le message reste bien
  // "seulement une pièce jointe", même sans objet `attachment` structuré.
  return Boolean(params.hasAttachment) || isInboundAttachmentPlaceholder(params.content) || !params.content.trim();
}

async function resolvePolicySafely(organizationId: string): Promise<MessagingPolicy> {
  try {
    return await resolveMessagingPolicy(organizationId);
  } catch (error) {
    // Fail-closed : sans politique lisible, pas de réponse automatique — mais le message est notifié.
    console.error(`processInboundAutoReply: politique de messagerie illisible (org ${organizationId}):`, error);
    return { mode: "off", allowAI: false };
  }
}

async function tryEscalate(params: InboundAutoReplyParams, reason: Parameters<typeof escalateToHuman>[2]): Promise<boolean> {
  try {
    await escalateToHuman(params.organizationId, params.conversationId, reason);
    return true;
  } catch (error) {
    console.error(`processInboundAutoReply: escalade « ${reason} » impossible (conversation ${params.conversationId}):`, error);
    return false;
  }
}

async function answerTextMessage(params: InboundAutoReplyParams, policy: MessagingPolicy, mode: AutoReplyMode): Promise<InboundAutoReplyOutcome> {
  const { organizationId, conversationId } = params;

  let routing: OrchestrationResult;
  try {
    routing = await routeMessage(organizationId, conversationId, params.content, {
      // `deterministic_only` (offre sans IA) : FAQ/catalogue/infos restent permis, jamais l'IA.
      allowAI: mode === "full" && policy.allowAI,
    });
  } catch (error) {
    // Erreur technique imprévue : le client reçoit un accusé, le commerçant est notifié (via « unanswered »).
    console.error(`processInboundAutoReply: routage impossible (org ${organizationId}, conversation ${conversationId}):`, error);
    await sendCourtesyAck(params, "courtesy_ack");
    return "unanswered";
  }

  let outcome: InboundAutoReplyOutcome = "unanswered";

  if (routing.handoffReason) {
    // Déjà en attente pour ce même motif : ni nouvelle escalade ni notification
    // en double — le message sera notifié individuellement plus bas.
    const alreadyPendingForSameReason = params.handoffStatus === "pending_human" && params.handoffReason === routing.handoffReason;
    if (!alreadyPendingForSameReason && (await tryEscalate(params, routing.handoffReason))) {
      outcome = "escalated"; // escalateToHuman notifie déjà les admins
    }
  }

  if (routing.replyText) {
    const sent = await sendAndStore(params, { text: routing.replyText, imageUrl: routing.replyImageUrl }, { intent: routing.intent, ai_invoked: routing.aiInvoked });
    if (sent) return "replied";
    await notifyAutoReplyFailed(organizationId, conversationId, params.contactFullName);
    return outcome;
  }

  if (routing.handoffReason) {
    // Plainte, remboursement, IA indisponible : le client est prévenu, un humain prend le relais.
    await sendCourtesyAck(params, courtesyIntentFor(routing.handoffReason));
    return outcome;
  }

  if (mode === "full" && !policy.allowAI) {
    // Semi-automatique : rien dans la FAQ / les infos / le catalogue ne
    // correspond → un humain prend le relais, le client est prévenu.
    if (await tryEscalate(params, "semi_automatic")) outcome = "escalated";
    await sendCourtesyAck(params, "semi_automatic_handoff");
    return outcome;
  }

  // Déjà en attente d'un humain et rien ne correspond : un accusé (une fois par
  // fenêtre) plutôt que le silence ; le commerçant est notifié de ce message.
  await sendCourtesyAck(params, "courtesy_ack");
  return outcome;
}

export async function processInboundAutoReply(params: InboundAutoReplyParams): Promise<InboundAutoReplyOutcome> {
  const { organizationId, conversationId } = params;
  if (detectBroadcastOptOut(params.content) && (await applyBroadcastOptOut(params))) return "replied";

  const policy = await resolvePolicySafely(organizationId);
  let mode = getAutoReplyMode(params.handoffStatus, params.handoffReason);
  // Réessai de l'IA : `deterministic_only` n'existe que parce que l'IA était
  // indisponible (ou l'offre semi-automatique). Si l'offre l'autorise
  // maintenant, on retente — sans crédit consommé tant qu'elle reste
  // indisponible (la réservation vient APRÈS le contrôle de disponibilité).
  if (mode === "deterministic_only" && policy.allowAI) mode = "full";

  let outcome: InboundAutoReplyOutcome = "unanswered";

  if (policy.mode !== "off" && mode !== "none" && params.autoReplyAllowed !== false) {
    if (isAttachmentOnly(params)) {
      // Une photo ou un vocal ne se traite ni par FAQ ni par IA : accusé de
      // réception au client, notification au commerçant (ci-dessous).
      await sendCourtesyAck(params, "courtesy_ack");
    } else {
      outcome = await answerTextMessage(params, policy, mode);
    }
  }

  if (outcome === "unanswered") {
    await notifyUnansweredInboundMessage(organizationId, conversationId, params.contactFullName, params.content, Boolean(params.hasAttachment));
  }
  return outcome;
}
