import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getSocialPublishingProvider } from "@/infrastructure/providers/registry";
import { routeMessage } from "./conversation-orchestrator";
import { hasFeature } from "./entitlements-service";
import { resolveMessagingPolicy } from "./messaging-policy-service";
import { getSocialAccountByAccountId } from "./social-account-registry-service";
import { notifyOrgAdmins } from "./notification-service";

/**
 * Lot O — réponse automatique aux commentaires Facebook / Instagram,
 * construite EXACTEMENT comme la messagerie : même orchestrateur (FAQ →
 * infos entreprise → catalogue → IA en dernier recours), même politique
 * de l'offre (IA seulement en « automatique »), mêmes escalades
 * (plainte / remboursement / IA indisponible → un humain), mêmes crédits.
 *
 * TikTok est volontairement à 0 dans `plan_entitlements`
 * (`tiktok_auto_comments`) : retiré à la demande, réactivable depuis
 * /admin/plans sans changement de code.
 */
export const COMMENT_AUTO_REPLY_ENTITLEMENT: Record<string, string> = {
  facebook: "facebook_auto_comments",
  instagram: "instagram_auto_comments",
  tiktok: "tiktok_auto_comments",
};

/** Un commentaire public reste court : un pavé de texte sous une publication est contre-productif. */
export const MAX_PUBLIC_REPLY_LENGTH = 900;
/** Garde-fous anti-boucle / anti-spam. */
export const MAX_AUTO_REPLIES_PER_ACCOUNT_PER_10_MIN = 30;
export const MAX_AUTO_REPLIES_PER_AUTHOR_PER_DAY = 3;

export type CommentAutoReplyOutcome = "replied" | "escalated" | "skipped" | "failed";

export interface CommentAutoReplyInput {
  organizationId: string;
  commentId: string;
  platform: string;
  accountId: string;
  providerPostId: string;
  externalCommentId: string;
  authorExternalId?: string | null;
  authorName?: string | null;
  content: string;
}

/** Tronque proprement (sur une frontière de mot) pour un commentaire public. */
export function clampPublicReply(text: string, max = MAX_PUBLIC_REPLY_LENGTH): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Le commentaire vient-il du compte lui-même (page / profil de l'entreprise) ? */
export function isOwnComment(input: { authorExternalId?: string | null; authorName?: string | null }, account: { accountId: string; username: string | null }): boolean {
  if (input.authorExternalId && input.authorExternalId === account.accountId) return true;
  if (input.authorName && account.username) {
    return input.authorName.trim().toLowerCase().replace(/^@/, "") === account.username.trim().toLowerCase().replace(/^@/, "");
  }
  return false;
}

async function markComment(commentId: string, organizationId: string, patch: Record<string, unknown>): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("social_comments").update(patch).eq("id", commentId).eq("organization_id", organizationId);
  if (error) console.error(`processCommentAutoReply: mise à jour du commentaire ${commentId} impossible:`, error.message);
}

async function escalateComment(input: CommentAutoReplyInput, reason: string): Promise<void> {
  await markComment(input.commentId, input.organizationId, { needs_human: true, handoff_reason: reason });
  await notifyOrgAdmins({
    organizationId: input.organizationId,
    title: "Commentaire à traiter.",
    body: input.authorName
      ? `${input.authorName} : « ${input.content.slice(0, 100)} » — aucune réponse automatique adaptée.`
      : `Commentaire : « ${input.content.slice(0, 100)} » — aucune réponse automatique adaptée.`,
    relatedEntityType: "social_comment",
    relatedEntityId: input.commentId,
    priority: "normal",
  }).catch((error) => console.error("processCommentAutoReply: notification impossible:", error));
}

export async function processCommentAutoReply(input: CommentAutoReplyInput): Promise<CommentAutoReplyOutcome> {
  const { organizationId } = input;
  const entitlementKey = COMMENT_AUTO_REPLY_ENTITLEMENT[input.platform];
  if (!entitlementKey) return "skipped";
  if (input.content.trim().length < 2) return "skipped";
  if (!(await hasFeature(organizationId, entitlementKey))) return "skipped";

  const account = await getSocialAccountByAccountId(input.accountId);
  if (!account || account.organizationId !== organizationId || account.status !== "connected") return "skipped";
  if (!account.autoReplyComments) return "skipped";
  if (isOwnComment(input, account)) {
    await markComment(input.commentId, organizationId, { is_own: true });
    return "skipped";
  }

  const policy = await resolveMessagingPolicy(organizationId);
  if (policy.mode === "off") return "skipped";

  // Anti-boucle / anti-spam (avant tout appel coûteux : IA, crédits).
  const supabase = getSupabaseServiceClient();
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [recentByAccount, recentByAuthor] = await Promise.all([
    supabase.from("social_comments").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("provider_account_id", input.accountId).eq("reply_sender", "ai").gte("replied_at", tenMinutesAgo),
    input.authorName
      ? supabase.from("social_comments").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("provider_account_id", input.accountId).eq("author_name", input.authorName).eq("reply_sender", "ai").gte("replied_at", oneDayAgo)
      : Promise.resolve({ count: 0 }),
  ]);
  if ((recentByAccount.count ?? 0) >= MAX_AUTO_REPLIES_PER_ACCOUNT_PER_10_MIN) {
    await markComment(input.commentId, organizationId, { auto_reply_error: "Limite de réponses automatiques atteinte (anti-spam)." });
    return "skipped";
  }
  if ((recentByAuthor.count ?? 0) >= MAX_AUTO_REPLIES_PER_AUTHOR_PER_DAY) return "skipped";

  try {
    // Aucun historique de conversation : un commentaire est traité seul (conversationId = null).
    const routing = await routeMessage(organizationId, null, input.content, { allowAI: policy.allowAI });

    if (routing.handoffReason) {
      await escalateComment(input, routing.handoffReason);
      return "escalated";
    }
    if (!routing.replyText) {
      // Aucune correspondance (FAQ / infos / catalogue) et pas d'IA : à traiter à la main.
      await escalateComment(input, policy.allowAI ? "unknown_information" : "semi_automatic");
      return "escalated";
    }

    const reply = clampPublicReply(routing.replyText);
    const provider = await getSocialPublishingProvider(organizationId);
    await provider.replyToComment(input.providerPostId, input.accountId, input.externalCommentId, reply);
    await markComment(input.commentId, organizationId, {
      status: "replied",
      reply_content: reply,
      replied_at: new Date().toISOString(),
      reply_sender: "ai",
      auto_reply_intent: routing.intent,
      needs_human: false,
      auto_reply_error: null,
    });
    return "replied";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`processCommentAutoReply(${input.commentId}) échec:`, message);
    await markComment(input.commentId, organizationId, { auto_reply_error: message.slice(0, 500), needs_human: true, handoff_reason: "requires_human_action" });
    return "failed";
  }
}
