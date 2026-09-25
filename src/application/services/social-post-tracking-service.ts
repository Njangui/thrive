import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { notifyOrgAdmins } from "./notification-service";
import { isOwnComment } from "./comment-auto-reply-service";
import { getSocialAccountByAccountId } from "./social-account-registry-service";
import type { CommentReceivedEvent, ExternalPostTrackedEvent } from "@/domain/events/domain-events";

/**
 * social-post-tracking-service.ts — Lot 5 (20/09/2026).
 *
 * Répond à une demande explicite : synchroniser les commentaires sociaux
 * "quel que soit l'endroit où le post a été publié, et automatiquement" —
 * pas seulement pour les posts publiés via le composer Flexco (seul cas
 * couvert jusqu'ici par syncCommentsForPost, voir social-comment-
 * service.ts), et sans dépendre d'un clic manuel sur "Vérifier les
 * commentaires".
 *
 * Deux briques CONFIRMÉES côté Zernio rendent ça possible
 * (docs.zernio.com/webhooks, consulté le 20/09/2026), combinées ici :
 * - `post.external.*` : la synchronisation arrière-plan de Zernio
 *   (~horaire, PAS temps réel) détecte tout post publié nativement sur
 *   la plateforme (hors Zernio/Flexco) et le rend "tracké".
 * - `comment.received` : événement temps réel pour tout nouveau
 *   commentaire sur un post "tracké" — ce qui inclut donc, une fois le
 *   premier point câblé, les posts publiés hors Flexco.
 *
 * Limite honnête à communiquer au commerçant (voir RAPPORT livré avec ce
 * lot) : un post fait directement sur Facebook peut mettre jusqu'à ~1h
 * avant d'être "tracké" par Zernio (premier passage de la synchronisation
 * arrière-plan) — ses commentaires ne deviennent temps réel qu'APRÈS ce
 * premier passage. Le bouton manuel existant reste donc utile en attendant.
 *
 * Action requise côté Zernio (PAS du code) : le compte Zernio de chaque
 * tenant doit avoir `comment.received`, `post.external.created`,
 * `post.external.updated` et `post.external.deleted` dans les événements
 * souscrits de son webhook (dashboard Zernio, aucune API de gestion des
 * webhooks appelée par ce projet à ce jour — vérifié, voir RAPPORT).
 */

interface TrackedPostRef {
  socialPostId: string;
  platform: string;
}

/**
 * Fait exister une ligne `social_posts` (+ `social_post_targets`) pour un
 * post connu de Zernio par son `provider_post_id`, qu'il ait été publié
 * via Flexco (déjà existant, jamais recréé/modifié ici) ou détecté
 * nativement sur la plateforme (`source = 'external'`, voir
 * 0064_external_post_tracking.sql). Idempotent — upsert conceptuel gardé
 * en lecture-puis-écriture (pas un vrai `upsert` SQL) car deux tables
 * sont concernées ; la contrainte unique de 0064 empêche une duplication
 * en cas de course entre deux events concurrents pour le même post.
 *
 * Ne devine JAMAIS une plateforme : si aucune n'est connue (ni fournie
 * par l'appelant, ni déjà en base), la fonction abandonne proprement
 * (log + `null`) plutôt que de stocker une valeur inventée dans une
 * colonne `not null`.
 */
async function ensureTrackedPost(
  organizationId: string,
  providerPostId: string,
  providerAccountId: string,
  platformHint: string | undefined,
): Promise<TrackedPostRef | null> {
  const supabase = getSupabaseServiceClient();

  const { data: existingPost, error: findPostError } = await supabase
    .from("social_posts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("provider_post_id", providerPostId)
    .maybeSingle();

  if (findPostError) {
    console.error(`ensureTrackedPost(${organizationId}, ${providerPostId}) lecture social_posts:`, findPostError.message);
    return null;
  }

  let socialPostId = existingPost?.id as string | undefined;

  if (!socialPostId) {
    if (!platformHint) {
      console.warn(
        `ensureTrackedPost(${organizationId}, ${providerPostId}): plateforme inconnue pour un post jamais vu, ignoré.`,
      );
      return null;
    }

    const { data: created, error: insertPostError } = await supabase
      .from("social_posts")
      .insert({
        organization_id: organizationId,
        // CONFIRMÉ non exploitable ici (voir zernio/types.ts,
        // ZernioExternalPostWebhookPost) : le texte réel du post n'est
        // pas rapatrié, `content` reste NOT NULL côté schéma.
        content: "Publication détectée automatiquement (publiée hors Flexco).",
        status: "published",
        provider_post_id: providerPostId,
        source: "external",
      })
      .select("id")
      .single();

    // Contrainte unique 0064 violée = un event concurrent a créé la
    // ligne entre notre lecture et notre écriture — pas une vraie erreur,
    // on relit plutôt que d'abandonner le commentaire.
    if (insertPostError?.code === "23505") {
      const { data: retryPost } = await supabase
        .from("social_posts")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("provider_post_id", providerPostId)
        .maybeSingle();
      socialPostId = retryPost?.id;
    } else if (insertPostError || !created) {
      console.error(
        `ensureTrackedPost(${organizationId}, ${providerPostId}) création social_posts:`,
        insertPostError?.message,
      );
      return null;
    } else {
      socialPostId = created.id;
    }

    if (!socialPostId) return null;
  }

  const { data: target, error: targetReadError } = await supabase
    .from("social_post_targets")
    .select("platform")
    .eq("post_id", socialPostId)
    .eq("provider_account_id", providerAccountId)
    .maybeSingle();

  if (targetReadError) {
    console.error(`ensureTrackedPost(${organizationId}, ${providerPostId}) lecture target:`, targetReadError.message);
    return null;
  }

  if (target) {
    return { socialPostId, platform: target.platform };
  }

  // Post déjà connu mais sans cible pour CE compte précis (rare — ex.
  // premier `post.external.created` créé sans platformHint côté d'un
  // autre event puis complété ici). Jamais deviné : sans plateforme
  // connue, on abandonne plutôt que d'inventer.
  if (!platformHint) {
    console.warn(
      `ensureTrackedPost(${organizationId}, ${providerPostId}): aucune cible pour le compte ${providerAccountId} et plateforme inconnue, ignoré.`,
    );
    return null;
  }

  const { error: insertTargetError } = await supabase.from("social_post_targets").insert({
    organization_id: organizationId,
    post_id: socialPostId,
    platform: platformHint,
    provider_account_id: providerAccountId,
    status: "published",
  });

  if (insertTargetError) {
    console.error(`ensureTrackedPost(${organizationId}, ${providerPostId}) création target:`, insertTargetError.message);
    return null;
  }

  return { socialPostId, platform: platformHint };
}

/**
 * Consomme un event EXTERNAL_POST_TRACKED (post.external.created/updated).
 * `post.external.deleted` n'efface jamais la ligne locale (section 10/52
 * doc 2 : jamais de suppression d'un post déjà publié/tracké, même
 * détecté a posteriori) — juste loggé, pour observabilité.
 */
export async function trackExternalPost(event: ExternalPostTrackedEvent): Promise<void> {
  if (event.payload.deleted) {
    console.info(
      `trackExternalPost: post.external.deleted (${event.payload.providerPostId}), ligne locale conservée (historique).`,
    );
    return;
  }

  await ensureTrackedPost(
    event.organizationId,
    event.payload.providerPostId,
    event.payload.providerAccountId,
    event.payload.platform,
  );
}

/**
 * Consomme un event COMMENT_RECEIVED : synchronisation temps réel,
 * complète le pull manuel existant (jamais supprimé — utile en
 * rattrapage, notamment pendant la fenêtre ~horaire avant qu'un post
 * externe ne soit tracké, voir en-tête de fichier).
 *
 * Filet de sécurité : si le post n'a pas encore de ligne locale (comment
 * arrivé avant le `post.external.created` qui l'aurait créée), la ligne
 * est créée à la volée ici plutôt que de perdre le commentaire — même
 * mécanisme (`ensureTrackedPost`) que `trackExternalPost` ci-dessus.
 */
export async function handleIncomingComment(event: CommentReceivedEvent): Promise<{ commentId: string } | null> {
  const supabase = getSupabaseServiceClient();

  const tracked = await ensureTrackedPost(
    event.organizationId,
    event.payload.providerPostId,
    event.payload.providerAccountId,
    event.payload.platform,
  );

  if (!tracked) {
    console.warn(
      `handleIncomingComment: post introuvable/non-créable pour org ${event.organizationId}, ` +
        `provider_post_id ${event.payload.providerPostId} — commentaire ${event.payload.externalCommentId} perdu.`,
    );
    return null;
  }

  // Le commentaire vient-il du compte du commerçant lui-même ? Se produit chaque fois qu'il répond à un
  // commentaire — soit directement sur la plateforme, soit via `replyToComment` (social-comment-service.ts) :
  // Zernio relivre alors CETTE réponse comme un nouveau `comment.received`. Vérifié ICI (pas seulement dans
  // `processCommentAutoReply`, qui ne l'évalue même pas si la réponse automatique est désactivée) car
  // `notifyOrgAdmins` ci-dessous notifierait sinon le commerçant de son PROPRE message, à chaque réponse.
  const account = await getSocialAccountByAccountId(event.payload.providerAccountId);
  const isOwn = Boolean(account) && isOwnComment(event.payload, account!);

  const { data: inserted, error: upsertError } = await supabase
    .from("social_comments")
    .upsert(
      {
        organization_id: event.organizationId,
        social_post_id: tracked.socialPostId,
        platform: tracked.platform,
        provider_account_id: event.payload.providerAccountId,
        external_comment_id: event.payload.externalCommentId,
        author_name: event.payload.authorName,
        author_external_id: event.payload.authorExternalId ?? null,
        content: event.payload.content,
        is_own: isOwn,
      },
      { onConflict: "social_post_id,provider_account_id,external_comment_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (upsertError) {
    console.error(`handleIncomingComment(${event.organizationId}):`, upsertError.message);
    return null;
  }

  // `ignoreDuplicates: true` ne renvoie aucune ligne pour un commentaire
  // déjà connu (re-livraison webhook, ou déjà récupéré par un sync
  // manuel entre-temps) — jamais de notification en double dans ce cas.
  if (!inserted) return null;

  // Stocké pour l'historique du fil (répondre à ce fil doit rester cohérent) mais jamais notifié : voir
  // le calcul de `isOwn` ci-dessus. `processCommentAutoReply` (appelée juste après par le webhook) fera de
  // toute façon le même constat et n'y répondra pas automatiquement.
  if (isOwn) return { commentId: inserted.id as string };

  await notifyOrgAdmins({
    organizationId: event.organizationId,
    title: "Nouveau commentaire reçu.",
    body: event.payload.authorName
      ? `${event.payload.authorName} a commenté votre publication : « ${truncate(event.payload.content, 120)} »`
      : `Nouveau commentaire : « ${truncate(event.payload.content, 120)} »`,
    relatedEntityType: "social_comment",
    relatedEntityId: tracked.socialPostId,
  }).catch((err) => {
    console.error(`handleIncomingComment(${event.organizationId}): échec notification:`, err);
  });

  return { commentId: inserted.id as string };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
