import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getSocialPublishingProvider } from "@/infrastructure/providers/registry";
import { resolveOrganizationIdByProviderPostId } from "@/infrastructure/providers/messaging/zernio/resolve-organization";
import { ValidationError } from "@/lib/errors";

/**
 * Lot O — premier commentaire automatique sous une publication.
 *
 *  - Facebook, Instagram, LinkedIn (et YouTube côté Zernio) : le champ
 *    `firstComment` de la création de post est publié par Zernio lui-même
 *    (voir ZernioSocialAdapter). Rien à faire ici.
 *  - TikTok : Zernio ne publie pas de `firstComment` pour TikTok. On
 *    poste (puis épingle) un commentaire de premier niveau APRÈS la
 *    publication, dès que l'URL de la vidéo est connue (TikTok ne la
 *    fournit que quelques minutes plus tard — webhook
 *    `post.tiktok.url_resolved` ou, à défaut, le cron
 *    `/api/cron/process-first-comments`).
 *
 * NON VÉRIFIÉ EN CONDITIONS RÉELLES : la forme exacte du webhook
 * `post.tiktok.url_resolved` et de la réponse « créer un commentaire »
 * n'est pas confirmée — lecture défensive, erreurs conservées sur la ligne
 * (`social_first_comments.error_message`) et jamais silencieuses.
 */
export const FIRST_COMMENT_MAX_LENGTH = 2000;
/** Après ce délai sans URL TikTok, on abandonne (statut `skipped`). */
export const FIRST_COMMENT_GIVE_UP_MS = 24 * 60 * 60 * 1000;

export function normalizeFirstComment(text: string | null | undefined): string | undefined {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return undefined;
  if (trimmed.length > FIRST_COMMENT_MAX_LENGTH) {
    throw new ValidationError(`Le premier commentaire ne peut pas dépasser ${FIRST_COMMENT_MAX_LENGTH} caractères.`);
  }
  return trimmed;
}

/** https://www.tiktok.com/@compte/video/7300000000000000000 → identifiant numérique de la vidéo. */
export function parseTikTokVideoId(url: string | null | undefined): string | null {
  const match = url?.match(/\/video\/(\d{6,25})/);
  return match?.[1] ?? null;
}

export async function queueTikTokFirstComment(input: { organizationId: string; socialPostId: string; accountId: string; content: string }): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("social_first_comments").upsert(
    {
      organization_id: input.organizationId,
      social_post_id: input.socialPostId,
      platform: "tiktok",
      account_id: input.accountId,
      content: input.content,
      status: "pending",
    },
    { onConflict: "social_post_id,account_id", ignoreDuplicates: true },
  );
  if (error) console.error("queueTikTokFirstComment:", error.message);
}

interface PendingFirstComment {
  id: string;
  organization_id: string;
  social_post_id: string;
  account_id: string;
  content: string;
  attempts: number;
  created_at: string;
}

/** Poste (puis épingle) le commentaire d'UNE ligne. Verrou optimiste : deux livraisons concurrentes ne le postent qu'une fois. */
async function attemptFirstComment(row: PendingFirstComment, providerPostId: string, videoId: string): Promise<"posted" | "failed" | "skipped"> {
  const supabase = getSupabaseServiceClient();
  const { data: claimed } = await supabase
    .from("social_first_comments")
    .update({ attempts: row.attempts + 1 })
    .eq("id", row.id)
    .eq("status", "pending")
    .eq("attempts", row.attempts)
    .select("id")
    .maybeSingle();
  if (!claimed) return "skipped";

  try {
    const provider = await getSocialPublishingProvider(row.organization_id);
    if (!provider.postTopLevelComment) throw new Error("Le connecteur ne permet pas de publier un premier commentaire TikTok.");
    const posted = await provider.postTopLevelComment(videoId, row.account_id, row.content);
    // Épinglage : best-effort — un échec d'épinglage ne défait pas le commentaire posté.
    if (posted.commentId && provider.pinComment) {
      await provider.pinComment(videoId, row.account_id, posted.commentId).catch((error) => console.warn("first-comment: épinglage TikTok impossible:", error));
    }
    await supabase.from("social_first_comments").update({ status: "posted", posted_at: new Date().toISOString(), error_message: null }).eq("id", row.id);
    return "posted";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("social_first_comments").update({ status: row.attempts + 1 >= 3 ? "failed" : "pending", error_message: message.slice(0, 500) }).eq("id", row.id);
    void providerPostId;
    return "failed";
  }
}

/** Webhook `post.tiktok.url_resolved` : lecture défensive (forme non confirmée). */
export async function handleTikTokUrlResolvedWebhook(raw: Record<string, unknown>): Promise<{ posted: number; failed: number }> {
  const post = (raw.post ?? {}) as Record<string, unknown>;
  const results = Array.isArray(post.platformResults) ? (post.platformResults as Record<string, unknown>[]) : [];
  const providerPostId = String(post._id ?? post.id ?? raw.postId ?? "");
  const url = [raw.platformPostUrl, raw.url, post.platformPostUrl, results.find((r) => r.platform === "tiktok")?.platformPostUrl].find((value): value is string => typeof value === "string");
  const videoId = parseTikTokVideoId(url);
  if (!providerPostId || !videoId) return { posted: 0, failed: 0 };

  const organizationId = await resolveOrganizationIdByProviderPostId(providerPostId);
  if (!organizationId) return { posted: 0, failed: 0 };

  const supabase = getSupabaseServiceClient();
  const { data: postRow } = await supabase.from("social_posts").select("id").eq("organization_id", organizationId).eq("provider_post_id", providerPostId).maybeSingle();
  if (!postRow) return { posted: 0, failed: 0 };
  const { data: rows } = await supabase
    .from("social_first_comments")
    .select("id, organization_id, social_post_id, account_id, content, attempts, created_at")
    .eq("social_post_id", postRow.id)
    .eq("platform", "tiktok")
    .eq("status", "pending");

  let posted = 0;
  let failed = 0;
  for (const row of (rows ?? []) as PendingFirstComment[]) {
    const outcome = await attemptFirstComment(row, providerPostId, videoId);
    if (outcome === "posted") posted++;
    if (outcome === "failed") failed++;
  }
  return { posted, failed };
}

/**
 * Filet de sécurité (cron) : pour chaque premier commentaire TikTok en
 * attente, relit le statut du post chez Zernio pour obtenir l'URL de la
 * vidéo. Abandonne après 24 h sans URL.
 */
export async function processPendingFirstComments(now = new Date()): Promise<{ posted: number; failed: number; skipped: number; waiting: number }> {
  const supabase = getSupabaseServiceClient();
  const { data: rows, error } = await supabase
    .from("social_first_comments")
    .select("id, organization_id, social_post_id, account_id, content, attempts, created_at, social_posts(provider_post_id)")
    .eq("status", "pending")
    .eq("platform", "tiktok")
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(`Lecture des premiers commentaires en attente impossible: ${error.message}`);

  const result = { posted: 0, failed: 0, skipped: 0, waiting: 0 };
  for (const raw of rows ?? []) {
    const row = raw as unknown as PendingFirstComment & { social_posts: { provider_post_id: string | null } | { provider_post_id: string | null }[] | null };
    const postRef = Array.isArray(row.social_posts) ? row.social_posts[0] : row.social_posts;
    const providerPostId = postRef?.provider_post_id;
    const age = now.getTime() - new Date(row.created_at).getTime();

    if (!providerPostId) {
      result.skipped++;
      continue;
    }
    if (age > FIRST_COMMENT_GIVE_UP_MS) {
      await supabase.from("social_first_comments").update({ status: "skipped", error_message: "URL TikTok jamais résolue (24 h)." }).eq("id", row.id).eq("status", "pending");
      result.skipped++;
      continue;
    }
    try {
      const provider = await getSocialPublishingProvider(row.organization_id);
      const status = await provider.getPostStatus(providerPostId);
      const target = status.targets.find((t) => t.platform === "tiktok" && t.accountId === row.account_id);
      const videoId = parseTikTokVideoId(target?.platformPostUrl);
      if (!videoId) {
        result.waiting++;
        continue;
      }
      const outcome = await attemptFirstComment(row, providerPostId, videoId);
      if (outcome === "posted") result.posted++;
      else if (outcome === "failed") result.failed++;
      else result.skipped++;
    } catch (error) {
      console.warn(`processPendingFirstComments(${row.id}):`, error);
      result.failed++;
    }
  }
  return result;
}
