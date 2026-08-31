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
