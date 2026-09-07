import { redirect } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import {
  listComments,
  listSyncablePosts,
  syncCommentsForPost,
  replyToComment,
  hideComment,
  unhideComment,
  commentHidingSupportedOnPlatform,
} from "@/application/services/social-comment-service";
import { AppError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";
import { CommentCard } from "./comment-card";

/**
 * Page /dashboard/comments — Lot I, Partie 3. Périmètre exact du cahier :
 * lecture + réponse aux commentaires, plus masquage (capacité confirmée en
 * bonus, voir social-comment-service.ts). Synchronisation à la demande
 * (bouton "Vérifier les commentaires" par publication), pas de flux temps
 * réel — voir docs/ZERNIO_INTEGRATION.md pour le détail du verdict.
 */

// Priorité d'affichage : les nouveaux commentaires en premier (ce sur quoi
// le commerçant doit agir), puis les répondus, puis les masqués — au sein
// de chaque groupe, du plus récent au plus ancien (déjà l'ordre retourné
// par listComments).
const STATUS_ORDER: Record<string, number> = { new: 0, replied: 1, hidden: 2 };

export default async function CommentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; synced?: string }>;
}) {
  const { error, synced } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();

  const [comments, syncablePosts] = await Promise.all([
    listComments(organizationId),
    listSyncablePosts(organizationId),
  ]);

  const sortedComments = [...comments].sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));

  async function syncAction(formData: FormData) {
    "use server";
    await requireMembership(organizationId, ["owner", "admin"]);
    const postId = String(formData.get("postId") ?? "");
    let syncedCount = 0;
    try {
      const result = await syncCommentsForPost(organizationId, postId);
      syncedCount = result.syncedCount;
    } catch (err) {
      const message =
        err instanceof AppError
          ? err.message
          : "Impossible de vérifier les commentaires pour le moment — vérifiez qu'un compte social est bien connecté dans les paramètres.";
      redirect(`/dashboard/comments?error=${encodeURIComponent(message)}`);
    }
    redirect(`/dashboard/comments?synced=${syncedCount}`);
  }

  async function replyAction(formData: FormData) {
    "use server";
    await requireMembership(organizationId, ["owner", "admin"]);
    const commentId = String(formData.get("commentId") ?? "");
    const content = String(formData.get("content") ?? "");
    try {
      await replyToComment(organizationId, commentId, content);
    } catch (err) {
      const message = err instanceof AppError ? err.message : "Impossible d'envoyer la réponse pour le moment.";
      redirect(`/dashboard/comments?error=${encodeURIComponent(message)}`);
    }
    redirect("/dashboard/comments");
  }

  async function hideAction(formData: FormData) {
    "use server";
    await requireMembership(organizationId, ["owner", "admin"]);
    const commentId = String(formData.get("commentId") ?? "");
    try {
      await hideComment(organizationId, commentId);
    } catch (err) {
      const message = err instanceof AppError ? err.message : "Impossible de masquer ce commentaire pour le moment.";
      redirect(`/dashboard/comments?error=${encodeURIComponent(message)}`);
    }
    redirect("/dashboard/comments");
  }

  async function unhideAction(formData: FormData) {
    "use server";
    await requireMembership(organizationId, ["owner", "admin"]);
    const commentId = String(formData.get("commentId") ?? "");
    try {
      await unhideComment(organizationId, commentId);
    } catch (err) {
      const message = err instanceof AppError ? err.message : "Impossible de réafficher ce commentaire pour le moment.";
      redirect(`/dashboard/comments?error=${encodeURIComponent(message)}`);
    }
    redirect("/dashboard/comments");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Commentaires</h1>
        <p className="text-sm text-muted">Répondez aux commentaires laissés sur vos publications.</p>
      </div>

      {error && <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>}
      {synced !== undefined && !error && (
        <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-ink">
          {Number(synced) > 0
            ? `${synced} commentaire${Number(synced) > 1 ? "s" : ""} synchronisé${Number(synced) > 1 ? "s" : ""}.`
            : "Aucun nouveau commentaire pour cette publication."}
        </p>
      )}

      {syncablePosts.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-ink">Vérifier une publication</h2>
          <div className="flex flex-col gap-2">
            {syncablePosts.map((post) => (
              <form
                key={post.id}
                action={syncAction}
                className="flex items-center justify-between gap-2 rounded-brand border border-ink/10 bg-white px-4 py-2.5"
              >
                <input type="hidden" name="postId" value={post.id} />
                <p className="truncate text-sm text-muted">{post.content || "(publication sans texte)"}</p>
                <SubmitButton
                  pendingLabel="Vérification..."
                  className="shrink-0 rounded-full border border-ink/15 px-3 py-1.5 text-xs font-medium text-muted hover:bg-ink/5 disabled:opacity-60"
                >
                  Vérifier les commentaires
                </SubmitButton>
              </form>
            ))}
          </div>
        </div>
      )}

      {sortedComments.length === 0 ? (
        <p className="text-sm text-muted">
          Aucun commentaire pour l&apos;instant. Publiez sur vos réseaux sociaux puis vérifiez les commentaires
          ci-dessus.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {sortedComments.map((comment) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              organizationId={organizationId}
              canHide={commentHidingSupportedOnPlatform(comment.platform)}
              replyAction={replyAction}
              hideAction={hideAction}
              unhideAction={unhideAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}
