import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getSocialPublishingProvider, getAIProvider } from "@/infrastructure/providers/registry";
import { hasCreditsAvailable, consumeCredit } from "./ai-credits-service";
import { NotFoundError } from "@/lib/errors";

/**
 * social-comment-service.ts — Lot I, Partie 3 (commentaires sociaux).
 *
 * Verdict complet dans docs/ZERNIO_INTEGRATION.md : CONFIRMÉ (lecture +
 * réponse) sur Facebook, Instagram, YouTube, LinkedIn, Threads, X/Twitter,
 * Reddit, Bluesky. Masquer/afficher CONFIRMÉ uniquement sur
 * Facebook/Instagram/Threads.
 *
 * Comme le reste du projet : aucun appel direct à un adapter Zernio ici,
 * toujours via `getSocialPublishingProvider()` (ProviderRegistry).
 *
 * Pas de synchronisation temps réel (webhook `comment.received` non
 * exploité en V1, voir docs/ZERNIO_INTEGRATION.md) : `syncCommentsForPost`
 * est un pull explicite, déclenché par un bouton du dashboard.
 */

/**
 * CONFIRMÉ (docs.zernio.com, FAQ "Social Media Comments API") : hide/unhide
 * limité à Facebook, Instagram, Threads — dérivé de la plateforme plutôt
 * que stocké en base (évite une colonne supplémentaire à maintenir en
 * cohérence ; la contrainte vient de la plateforme, pas d'un état qui
 * change dans le temps).
 */
const HIDE_SUPPORTED_PLATFORMS = new Set(["facebook", "instagram", "threads"]);

export function commentHidingSupportedOnPlatform(platform: string): boolean {
  return HIDE_SUPPORTED_PLATFORMS.has(platform);
}

export interface SocialCommentListItem {
  id: string;
  socialPostId: string;
  platform: string;
  authorName: string | null;
  content: string;
  status: "new" | "replied" | "hidden";
  replyContent: string | null;
  repliedAt: string | null;
  createdAt: string;
  /** Extrait du post commenté, pour donner le contexte sans naviguer ailleurs. */
  postContent: string;
}

export interface SyncablePost {
  id: string;
  content: string;
  publishedAt: string | null;
}

interface SocialCommentRow {
  id: string;
  social_post_id: string;
  platform: string;
  author_name: string | null;
  content: string;
  status: "new" | "replied" | "hidden";
  reply_content: string | null;
  replied_at: string | null;
  created_at: string;
  social_posts: { content: string } | { content: string }[] | null;
}

function extractPostContent(row: SocialCommentRow): string {
  const posts = row.social_posts;
  if (!posts) return "";
  return Array.isArray(posts) ? (posts[0]?.content ?? "") : posts.content;
}

/** Lecture des commentaires déjà synchronisés — jamais d'appel réseau ici, voir syncCommentsForPost. */
export async function listComments(organizationId: string): Promise<SocialCommentListItem[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("social_comments")
    .select(
      "id, social_post_id, platform, author_name, content, status, reply_content, replied_at, created_at, social_posts(content)",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Erreur lors de la lecture des commentaires: ${error.message}`);

  return (data as unknown as SocialCommentRow[] | null ?? []).map((row) => ({
    id: row.id,
    socialPostId: row.social_post_id,
    platform: row.platform,
    authorName: row.author_name,
    content: row.content,
    status: row.status,
    replyContent: row.reply_content,
    repliedAt: row.replied_at,
    createdAt: row.created_at,
    postContent: extractPostContent(row),
  }));
}

/** Posts publiés avec un provider_post_id — seuls ceux-là peuvent avoir des commentaires à synchroniser. */
export async function listSyncablePosts(organizationId: string): Promise<SyncablePost[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("social_posts")
    .select("id, content, scheduled_for")
    .eq("organization_id", organizationId)
    .eq("status", "published")
    .not("provider_post_id", "is", null)
    .order("scheduled_for", { ascending: false })
    .limit(50);

  if (error) throw new Error(`Erreur lors de la lecture des publications: ${error.message}`);

  return (data ?? []).map((row) => ({ id: row.id, content: row.content, publishedAt: row.scheduled_for }));
}

/**
 * Récupère les commentaires réels depuis la plateforme sociale pour un
 * post publié et les upsert dans social_comments (déduplication par
 * (post, compte, id externe)). `ignoreDuplicates` : ne réécrit jamais une
 * ligne déjà connue — un commentaire déjà marqué "replied"/"hidden" côté
 * SME-OS ne doit jamais être remis à "new" par un simple re-sync.
 *
 * Contrairement à `notifyOrgAdmins`/`trackEvent` (best-effort), une
 * erreur ici REMONTE à l'appelant : un commerçant qui clique "vérifier
 * les commentaires" doit savoir si ça a échoué, pas croire à tort que
 * tout est à jour.
 */
export async function syncCommentsForPost(
  organizationId: string,
  socialPostId: string,
): Promise<{ syncedCount: number }> {
  const supabase = getSupabaseServiceClient();

  const { data: post, error: postError } = await supabase
    .from("social_posts")
    .select("id, provider_post_id, status")
    .eq("id", socialPostId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (postError) throw new Error(`Erreur lors de la lecture de la publication: ${postError.message}`);
  if (!post) throw new NotFoundError("Publication introuvable.");
  if (!post.provider_post_id || post.status !== "published") {
    return { syncedCount: 0 }; // brouillon/programmé : rien à synchroniser, pas une erreur
  }

  const { data: targets, error: targetsError } = await supabase
    .from("social_post_targets")
    .select("platform, provider_account_id")
    .eq("post_id", socialPostId)
    .eq("status", "published");

  if (targetsError) throw new Error(`Erreur lors de la lecture des cibles de publication: ${targetsError.message}`);
  if (!targets || targets.length === 0) return { syncedCount: 0 };

  const provider = await getSocialPublishingProvider(organizationId);
  let syncedCount = 0;

  for (const target of targets) {
    const comments = await provider.listComments(post.provider_post_id, target.provider_account_id);
    if (comments.length === 0) continue;

    const { error: upsertError } = await supabase.from("social_comments").upsert(
      comments.map((c) => ({
        organization_id: organizationId,
        social_post_id: socialPostId,
        platform: target.platform,
        provider_account_id: target.provider_account_id,
        external_comment_id: c.id,
        author_name: c.authorName,
        content: c.content,
      })),
      { onConflict: "social_post_id,provider_account_id,external_comment_id", ignoreDuplicates: true },
    );

    if (upsertError) {
      throw new Error(`Erreur lors de l'enregistrement des commentaires (${target.platform}): ${upsertError.message}`);
    }
    syncedCount += comments.length;
  }

  return { syncedCount };
}

/**
 * Répond à un commentaire. Envoie réellement la réponse à la plateforme
 * (via le provider) AVANT de marquer la ligne locale "replied" — jamais
 * l'inverse, pour ne jamais afficher une réponse comme envoyée si elle ne
 * l'a pas été.
 */
export async function replyToComment(organizationId: string, commentId: string, content: string): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("La réponse ne peut pas être vide.");

  const supabase = getSupabaseServiceClient();
  const { data: comment, error: fetchError } = await supabase
    .from("social_comments")
    .select("id, provider_account_id, external_comment_id, social_posts(provider_post_id)")
    .eq("id", commentId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (fetchError) throw new Error(`Erreur lors de la lecture du commentaire: ${fetchError.message}`);
  if (!comment) throw new NotFoundError("Commentaire introuvable.");

  const postRef = comment.social_posts as { provider_post_id: string | null } | { provider_post_id: string | null }[] | null;
  const providerPostId = Array.isArray(postRef) ? postRef[0]?.provider_post_id : postRef?.provider_post_id;
  if (!providerPostId) throw new Error("Publication d'origine introuvable — réponse impossible.");

  const provider = await getSocialPublishingProvider(organizationId);
  await provider.replyToComment(providerPostId, comment.provider_account_id, comment.external_comment_id, trimmed);

  const { error: updateError } = await supabase
    .from("social_comments")
    .update({ status: "replied", reply_content: trimmed, replied_at: new Date().toISOString() })
    .eq("id", commentId)
    .eq("organization_id", organizationId);

  if (updateError) {
    // La réponse EST partie côté plateforme à ce stade — ne jamais faire
    // croire l'inverse en levant une erreur "réponse échouée" ici.
    throw new Error(
      `Réponse envoyée avec succès, mais son enregistrement local a échoué (elle réapparaîtra comme "nouvelle" au prochain rafraîchissement) : ${updateError.message}`,
    );
  }
}

async function setCommentHidden(organizationId: string, commentId: string, hidden: boolean): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data: comment, error: fetchError } = await supabase
    .from("social_comments")
    .select("id, provider_account_id, external_comment_id, status, social_posts(provider_post_id)")
    .eq("id", commentId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (fetchError) throw new Error(`Erreur lors de la lecture du commentaire: ${fetchError.message}`);
  if (!comment) throw new NotFoundError("Commentaire introuvable.");

  const postRef = comment.social_posts as { provider_post_id: string | null } | { provider_post_id: string | null }[] | null;
  const providerPostId = Array.isArray(postRef) ? postRef[0]?.provider_post_id : postRef?.provider_post_id;
  if (!providerPostId) throw new Error("Publication d'origine introuvable.");

  const provider = await getSocialPublishingProvider(organizationId);
  if (hidden) {
    await provider.hideComment(providerPostId, comment.provider_account_id, comment.external_comment_id);
  } else {
    await provider.unhideComment(providerPostId, comment.provider_account_id, comment.external_comment_id);
  }

  // Un commentaire déjà répondu qu'on masque garde son statut "replied"
  // pour l'historique — seul un commentaire "new" bascule vers "hidden".
  // Démasquer ramène toujours à "new" (jamais "replied" par erreur).
  const nextStatus = hidden ? "hidden" : "new";
  const { error: updateError } = await supabase
    .from("social_comments")
    .update({ status: comment.status === "replied" && hidden ? comment.status : nextStatus })
    .eq("id", commentId)
    .eq("organization_id", organizationId);

  if (updateError) {
    throw new Error(`Action effectuée sur la plateforme, mais l'enregistrement local a échoué: ${updateError.message}`);
  }
}

/** CONFIRMÉ Facebook/Instagram/Threads uniquement — voir docs/ZERNIO_INTEGRATION.md. */
export async function hideComment(organizationId: string, commentId: string): Promise<void> {
  await setCommentHidden(organizationId, commentId, true);
}

export async function unhideComment(organizationId: string, commentId: string): Promise<void> {
  await setCommentHidden(organizationId, commentId, false);
}

/**
 * Brouillon de réponse suggéré par l'IA — jamais envoyé automatiquement
 * (cahier Lot I : "la validation/envoi final reste toujours une action
 * humaine explicite", bouton "Envoyer" séparé). Best-effort total : une
 * indisponibilité (IA désactivée, crédits épuisés, erreur réseau...) ne
 * doit jamais bloquer la réponse manuelle, donc ne lève jamais — retourne
 * simplement `null`.
 */
export async function draftCommentReplySuggestion(organizationId: string, commentContent: string): Promise<string | null> {
  try {
    if (!(await hasCreditsAvailable(organizationId))) return null;

    const supabase = getSupabaseServiceClient();
    const { data: org } = await supabase.from("organizations").select("name").eq("id", organizationId).maybeSingle();

    const { primary } = await getAIProvider(organizationId);
    const systemPrompt = [
      `Tu es le community manager de "${org?.name ?? "cette entreprise"}".`,
      "Propose une courte réponse professionnelle et chaleureuse à ce commentaire client, en 1 à 2 phrases, dans la langue du commentaire.",
      "N'invente jamais de prix, de stock ou de politique commerciale précise que tu ne connais pas — reste général si nécessaire.",
    ].join(" ");

    const result = await primary.generateText({ systemPrompt, userMessage: commentContent, maxTokens: 150 });

    await consumeCredit(organizationId, 1, "social_comment_draft").catch((err) =>
      console.warn(`[social-comments] échec consumeCredit(${organizationId}):`, err),
    );

    return result.text;
  } catch (err) {
    console.warn(`[social-comments] draftCommentReplySuggestion indisponible (org ${organizationId}):`, err);
    return null;
  }
}
