import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import type { HandoffReason } from "@/domain/entities/conversation";
import { notifyOrgAdmins } from "./notification-service";

/**
 * Bascule une conversation en attente d'intervention humaine (section 10).
 * Le dashboard doit filtrer sur handoff_status = 'pending_human' pour
 * afficher la file d'attente (Phase 10, RevenueWidget/ConversationsWidget).
 */
export async function escalateToHuman(
  organizationId: string,
  conversationId: string,
  reason: HandoffReason,
): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { error } = await supabase
    .from("conversations")
    .update({ handoff_status: "pending_human", handoff_reason: reason })
    .eq("id", conversationId)
    .eq("organization_id", organizationId);

  if (error) {
    throw new Error(`Impossible d'escalader la conversation ${conversationId}: ${error.message}`);
  }

  await notifyOrgAdmins({
    organizationId,
    title: "Une conversation nécessite votre intervention.",
    body: `Motif : ${reason}`,
    relatedEntityType: "conversation",
    relatedEntityId: conversationId,
  });
}

/**
 * CORRECTIF Lot 3 (audit master prompt §31) : garde-fou explicite, jusqu'ici
 * absent. `app/api/webhooks/zernio/route.ts` appelait `routeMessage()`
 * (donc une éventuelle réponse IA automatique) sur CHAQUE message entrant,
 * sans jamais vérifier `handoff_status` — un commentaire pré-existant dans
 * `conversation-admin-service.ts` prétendait à tort que c'était "déjà
 * garanti par le fait que le webhook ne déclenche l'orchestrateur que sur
 * un nouveau message entrant", ce qui ne dit rien sur le statut de
 * handoff : un nouveau message PENDANT une prise en charge humaine EST un
 * nouveau message entrant, donc déclenchait quand même l'IA.
 *
 * Seul le statut 'ai' autorise une réponse automatique. 'pending_human'
 * (en attente) et 'human' (déjà pris en charge) doivent tous les deux
 * bloquer l'IA — la reprise se fait uniquement via
 * `returnConversationToAI()` (action explicite de l'admin). 'resolved'
 * bloque aussi (une conversation clôturée ne doit pas repartir seule).
 */
export function shouldAutoRespond(handoffStatus: string): boolean {
  return handoffStatus === "ai";
}

export type AutoReplyMode = "full" | "deterministic_only" | "none";

/**
 * CORRECTIF (sept. 2026) — décide QUEL type de réponse automatique est
 * permis pour une conversation, au lieu du simple oui/non de
 * `shouldAutoRespond`.
 *
 * Problème corrigé : quand l'IA n'est pas activée, le premier message
 * qu'aucune règle ne couvre est escaladé (`ai_unavailable`) et la
 * conversation passe en `pending_human`. `shouldAutoRespond` renvoyait
 * alors `false` POUR TOUS LES MESSAGES SUIVANTS — la FAQ, pourtant
 * configurée et gratuite, restait muette pour le reste de la
 * conversation, et le commerçant devait répondre à la main.
 *
 * - `full` : statut `ai` — FAQ, catalogue, infos business, puis IA.
 * - `deterministic_only` : `pending_human` déclenché UNIQUEMENT parce que
 *   l'IA était indisponible (aucun humain n'a pris la main, aucune plainte
 *   en cours) — les réponses sûres et déterministes (FAQ, catalogue,
 *   horaires) restent permises ; jamais l'IA, jamais une nouvelle escalade
 *   pour le même motif.
 * - `none` : prise en charge humaine (`human`), plainte/remboursement en
 *   attente, ou conversation clôturée — aucune réponse automatique.
 */
export function getAutoReplyMode(handoffStatus: string, handoffReason: string | null | undefined): AutoReplyMode {
  if (handoffStatus === "ai") return "full";
  if (handoffStatus === "pending_human" && handoffReason === "ai_unavailable") return "deterministic_only";
  return "none";
}

/**
 * Notifie les admins qu'un message client est arrivé et que PERSONNE ne
 * lui répond automatiquement (prise en charge humaine, conversation
 * clôturée, ou message sans réponse possible). Sans cela, une fois qu'un
 * commerçant a pris la main, les réponses du client n'apparaissaient
 * nulle part : ni alerte, ni son, il fallait ouvrir la messagerie pour le
 * découvrir. Ne lève jamais (`notifyOrgAdmins` non plus).
 */
export async function notifyUnansweredInboundMessage(
  organizationId: string,
  conversationId: string,
  contactName: string | null | undefined,
  content: string,
  hasAttachment = false,
): Promise<void> {
  const preview = content.trim() ? content.trim().slice(0, 90) : hasAttachment ? "Pièce jointe reçue" : "Nouveau message";
  await notifyOrgAdmins({
    organizationId,
    title: contactName ? `Message de ${contactName}` : "Nouveau message client",
    body: preview,
    relatedEntityType: "conversation",
    relatedEntityId: conversationId,
    priority: "important",
  });
}

/**
 * Heuristique V1 très simple pour décider si une réponse IA doit être
 * bloquée et escaladée plutôt qu'envoyée. À affiner en Phase 8 avec de
 * vrais signaux (confiance du modèle, mots-clés de plainte, etc.) — ne
 * pas la sur-construire avant d'avoir des cas réels observés.
 */
export function shouldEscalate(userMessage: string): HandoffReason | null {
  const lower = userMessage.toLowerCase();
  if (/(rembours|remboursement)/.test(lower)) return "refund_request";
  if (/(plainte|inadmissible|scandaleux|d[ée]çu)/.test(lower)) return "complaint";
  return null;
}
