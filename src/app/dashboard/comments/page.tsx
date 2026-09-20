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
 * Page /dashboard/comments — Lot I, Partie 3, complétée Lot 5 (20/09/2026).
 * Périmètre du cahier : lecture + réponse aux commentaires, plus masquage
 * (capacité confirmée en bonus, voir social-comment-service.ts).
 *
 * Lot 5 : les commentaires arrivent maintenant en temps réel (webhook
 * `comment.received`, voir app/api/webhooks/zernio/route.ts et
 * social-post-tracking-service.ts), pour une publication faite via
 * CRESYVA COMME pour une publication faite directement sur la
 * plateforme (avec un délai de ~1h la toute première fois qu'un post
 * externe est détecté — voir social-post-tracking-service.ts). Le bouton
 * "Vérifier une publication" ci-dessous (pull manuel,
 * social-comment-service.ts::syncCommentsForPost) reste affiché comme
 * filet de rattrapage — jamais retiré, jamais présenté comme le seul
 * chemin — voir docs/ZERNIO_INTEGRATION.md pour le détail du verdict.
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
        <h1 className="font-jakarta text-2xl font-bold tracking-tight">Commentaires</h1>
        <p className="text-sm text-slate-500">
          Répondez aux commentaires laissés sur vos publications — ils arrivent ici automatiquement, que la
          publication vienne de CRESYVA ou directement de vos réseaux.
        </p>
      </div>

      {error && <p className="adm-alert-danger">{error}</p>}
      {synced !== undefined && !error && (
        <p className="rounded-xl border border-success-600/20 bg-success-50 px-4 py-3 text-sm text-navy-900">
          {Number(synced) > 0
            ? `${synced} commentaire${Number(synced) > 1 ? "s" : ""} synchronisé${Number(synced) > 1 ? "s" : ""}.`
            : "Aucun nouveau commentaire pour cette publication."}
        </p>
      )}

      {syncablePosts.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-navy-900">Forcer une vérification</h2>
          <p className="text-xs text-slate-500">
            Facultatif — les nouveaux commentaires arrivent déjà automatiquement. Utile juste après avoir publié un
            post directement sur vos réseaux (jusqu&apos;à ~1h avant sa prise en compte automatique).
          </p>
          <div className="flex flex-col gap-2">
            {syncablePosts.map((post) => (
              <form
                key={post.id}
                action={syncAction}
                className="flex items-center justify-between gap-2 rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)] px-4 py-2.5"
              >
                <input type="hidden" name="postId" value={post.id} />
                <p className="truncate text-sm text-slate-500">{post.content || "(publication sans texte)"}</p>
                <SubmitButton
                  pendingLabel="Vérification..."
                  className="shrink-0 rounded-full border border-navy-900/10 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-navy-900/5 disabled:opacity-60"
                >
                  Vérifier les commentaires
                </SubmitButton>
              </form>
            ))}
          </div>
        </div>
      )}

      {sortedComments.length === 0 ? (
        <p className="text-sm text-slate-500">
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
