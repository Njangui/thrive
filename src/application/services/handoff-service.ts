import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import type { HandoffReason } from "@/domain/entities/conversation";
import { describeHandoffReason } from "@/domain/entities/handoff-reasons";
import { notifyOrgAdmins } from "./notification-service";
import { normalizeMessage } from "./message-intents";
import { getHumanPauseMinutes } from "./messaging-settings-service";

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
    // Lot P : libellé français, plus le code brut (« ai_unavailable »).
    body: `Motif : ${describeHandoffReason(reason)}`,
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
 * bloquer l'IA. Lot P : la reprise n'est plus uniquement manuelle — voir
 * `applyAutoResume` (fin de la pause après une réponse humaine, réouverture
 * d'une conversation clôturée) — mais elle est toujours décidée AVANT ce
 * garde-fou, qui reste donc strict.
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
 *   l'IA était indisponible (ou l'offre semi-automatique) — les réponses
 *   sûres et déterministes (FAQ, catalogue, horaires) restent permises.
 *   Lot P : `processInboundAutoReply` repasse en `full` quand l'offre
 *   autorise l'IA (elle a pu être rétablie / activée depuis).
 * - `none` : prise en charge humaine (`human`), plainte/remboursement en
 *   attente, ou conversation clôturée — aucune réponse automatique.
 */
export function getAutoReplyMode(handoffStatus: string, handoffReason: string | null | undefined): AutoReplyMode {
  if (handoffStatus === "ai") return "full";
  if (handoffStatus === "pending_human" && (handoffReason === "ai_unavailable" || handoffReason === "semi_automatic")) return "deterministic_only";
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
 * Lot P — une réponse automatique a été calculée mais n'a pas pu PARTIR
 * (canal déconnecté, fenêtre WhatsApp fermée, erreur du fournisseur). Avant
 * ce correctif l'erreur remontait au webhook, qui marquait l'événement
 * « failed » sans prévenir personne : le client restait sans réponse et le
 * commerçant ne le savait pas.
 */
export async function notifyAutoReplyFailed(
  organizationId: string,
  conversationId: string,
  contactName: string | null | undefined,
): Promise<void> {
  await notifyOrgAdmins({
    organizationId,
    title: "Réponse automatique non envoyée",
    body: contactName
      ? `La réponse à ${contactName} n'a pas pu partir. Ouvrez la conversation pour lui répondre.`
      : "Une réponse automatique n'a pas pu partir. Ouvrez la conversation pour répondre au client.",
    relatedEntityType: "conversation",
    relatedEntityId: conversationId,
    priority: "important",
  });
}

const COMPLAINT_PATTERN =
  /\b(plainte|inadmissible|scandaleu\w*|decu\w*|decevan\w*|arnaque\w*|escroc\w*|honteu\w*|inacceptable|mecontent\w*|insatisfait\w*|catastroph\w*)\b/;

/**
 * Heuristique V1 très simple pour décider si une réponse IA doit être
 * bloquée et escaladée plutôt qu'envoyée. À affiner en Phase 8 avec de
 * vrais signaux (confiance du modèle, mots-clés de plainte, etc.) — ne
 * pas la sur-construire avant d'avoir des cas réels observés.
 *
 * Lot P : travaille sur le texte normalisé (sans accents : « déçue »,
 * « decu » et « DÉÇU » sont équivalents) et couvre les formulations
 * courantes de mécontentement (arnaque, honteux, inacceptable…).
 */
export function shouldEscalate(userMessage: string): HandoffReason | null {
  const normalized = normalizeMessage(userMessage);
  if (/rembours/.test(normalized)) return "refund_request";
  if (COMPLAINT_PATTERN.test(normalized)) return "complaint";
  return null;
}

// ---------------------------------------------------------------------------
// Lot P — reprise AUTOMATIQUE de l'IA (plus de « Rendre à l'IA » manuel)
// ---------------------------------------------------------------------------

export interface AutoResumeInput {
  status: string;
  /** Début de la pause humaine : dernier message humain ou prise en main explicite (le plus récent). */
  pauseStartedAt: Date | null;
  pauseMinutes: number;
  now?: Date;
}

export interface AutoResumeDecision {
  resume: boolean;
  reason: "reopened" | "pause_elapsed" | null;
}

/**
 * Décision PURE (testable sans base) : faut-il rendre la main à l'IA au
 * nouveau message du client ?
 *  - `resolved` : la conversation se rouvre toujours (un fil WhatsApp est
 *    unique par contact ; « clôturée » ne doit pas vouloir dire « muette
 *    pour toujours ») ;
 *  - `human` : quand la pause est écoulée (0 minute = pas de pause) ;
 *    une prise en main dont on ne connaît pas le début reste manuelle ;
 *  - `pending_human` / `ai` : jamais ici (escalade en cours / déjà active).
 */
export function decideAutoResume(input: AutoResumeInput): AutoResumeDecision {
  if (input.status === "resolved") return { resume: true, reason: "reopened" };
  if (input.status !== "human") return { resume: false, reason: null };
  if (input.pauseMinutes <= 0) return { resume: true, reason: "pause_elapsed" };
  if (!input.pauseStartedAt) return { resume: false, reason: null };
  const elapsedMs = (input.now ?? new Date()).getTime() - input.pauseStartedAt.getTime();
  return elapsedMs >= input.pauseMinutes * 60_000 ? { resume: true, reason: "pause_elapsed" } : { resume: false, reason: null };
}

/** Moment où l'IA reprendra (affichage dashboard) ; `null` si non applicable. */
export function getAiResumeAt(pauseStartedAt: Date | null, pauseMinutes: number): Date | null {
  if (!pauseStartedAt || pauseMinutes <= 0) return null;
  return new Date(pauseStartedAt.getTime() + pauseMinutes * 60_000);
}

/**
 * Début de la pause humaine d'une conversation : le plus récent entre le
 * dernier message humain et la prise en main explicite
 * (`conversations.human_takeover_at`, migration 0068 — lue en meilleur
 * effort : absente, on s'appuie sur les messages).
 */
export async function getHumanPauseStart(organizationId: string, conversationId: string): Promise<Date | null> {
  const supabase = getSupabaseServiceClient();
  const candidates: Date[] = [];
  try {
    const { data } = await supabase
      .from("conversations")
      .select("human_takeover_at")
      .eq("id", conversationId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    const takeoverAt = (data as { human_takeover_at?: string | null } | null)?.human_takeover_at;
    if (takeoverAt) candidates.push(new Date(takeoverAt));
  } catch {
    /* colonne absente (migration 0068 pas encore appliquée) : on ignore */
  }
  try {
    const { data } = await supabase
      .from("messages")
      .select("created_at")
      .eq("conversation_id", conversationId)
      .eq("sender", "human")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastHumanAt = (data as { created_at?: string } | null)?.created_at;
    if (lastHumanAt) candidates.push(new Date(lastHumanAt));
  } catch {
    /* jamais bloquant */
  }
  const valid = candidates.filter((d) => !Number.isNaN(d.getTime()));
  if (valid.length === 0) return null;
  return new Date(Math.max(...valid.map((d) => d.getTime())));
}

/** Enregistre le début d'une prise en main (meilleur effort : colonne ajoutée par la migration 0068). */
export async function markHumanTakeover(organizationId: string, conversationId: string, at: Date = new Date()): Promise<void> {
  try {
    await getSupabaseServiceClient()
      .from("conversations")
      .update({ human_takeover_at: at.toISOString() })
      .eq("id", conversationId)
      .eq("organization_id", organizationId);
  } catch {
    /* migration non appliquée : la pause s'appuie alors sur le dernier message humain */
  }
}

export interface EffectiveHandoff {
  handoffStatus: string;
  handoffReason: string | null;
  resumed: boolean;
}

/**
 * Appelée à CHAQUE message entrant (conversation-service.ts), avant toute
 * réponse automatique : rend la main à l'IA quand c'est le bon moment.
 * Ne lève jamais — en cas de doute, le statut existant est conservé (on
 * préfère ne pas répondre que répondre à tort pendant une prise en charge).
 */
export async function applyAutoResume(
  organizationId: string,
  conversationId: string,
  status: string,
  reason: string | null,
): Promise<EffectiveHandoff> {
  const unchanged: EffectiveHandoff = { handoffStatus: status, handoffReason: reason, resumed: false };
  if (status !== "resolved" && status !== "human") return unchanged;

  try {
    let pauseStartedAt: Date | null = null;
    let pauseMinutes = 0;
    if (status === "human") {
      [pauseMinutes, pauseStartedAt] = await Promise.all([
        getHumanPauseMinutes(organizationId),
        getHumanPauseStart(organizationId, conversationId),
      ]);
    }
    const decision = decideAutoResume({ status, pauseStartedAt, pauseMinutes });
    if (!decision.resume) return unchanged;

    const { error } = await getSupabaseServiceClient()
      .from("conversations")
      .update({ handoff_status: "ai", handoff_reason: null })
      .eq("id", conversationId)
      .eq("organization_id", organizationId)
      // Conditionnel : n'écrase pas un changement de statut survenu entre-temps.
      .eq("handoff_status", status);
    if (error) {
      console.warn(`applyAutoResume(${conversationId}): mise à jour impossible:`, error.message);
      return unchanged;
    }
    console.info(`[handoff] conversation ${conversationId} : IA reprise automatiquement (${decision.reason}).`);
    return { handoffStatus: "ai", handoffReason: null, resumed: true };
  } catch (error) {
    console.warn(`applyAutoResume(${conversationId}): erreur inattendue, statut conservé.`, error);
    return unchanged;
  }
}
