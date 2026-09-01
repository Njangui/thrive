import { redirect } from "next/navigation";
import Link from "next/link";
import { requireCurrentOrganization, requireMembership } from "@/application/services/auth-service";
import { getCampaignDetail, cancelCampaignPost } from "@/application/services/marketing-service";
import { AppError, NotFoundError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";

const POST_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  scheduled: "Programmée",
  published: "Publiée",
  failed: "Échouée",
  partial: "Partielle",
  cancelled: "Annulée",
  paused: "En pause",
};

const POST_STATUS_STYLES: Record<string, string> = {
  draft: "bg-ink/10 text-ink",
  scheduled: "bg-primary-light text-primary-dark",
  published: "bg-success-light text-success",
  failed: "bg-danger-light text-danger",
  partial: "bg-warning-light text-warning",
  cancelled: "bg-ink/10 text-muted",
  paused: "bg-warning-light text-warning",
};

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  threads: "Threads",
  x: "X (Twitter)",
  reddit: "Reddit",
  bluesky: "Bluesky",
};

async function cancelPostAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const campaignId = String(formData.get("campaignId") ?? "");
  const postId = String(formData.get("postId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  let errorMessage: string | null = null;
  try {
    await cancelCampaignPost(organizationId, postId);
  } catch (error) {
    errorMessage = error instanceof AppError ? error.message : "Erreur lors de l'annulation de la publication.";
  }

  if (errorMessage) {
    redirect(`/dashboard/marketing/${campaignId}?error=${encodeURIComponent(errorMessage)}`);
  }
  redirect(`/dashboard/marketing/${campaignId}?success=${encodeURIComponent("Publication annulée.")}`);
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  const { error, success } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();

  let campaign;
  try {
    campaign = await getCampaignDetail(organizationId, id);
  } catch (err) {
    if (err instanceof NotFoundError) {
      redirect("/dashboard/marketing");
    }
    throw err;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{campaign.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {campaign.totalPosts} publication{campaign.totalPosts > 1 ? "s" : ""} · Créée le{" "}
            {new Date(campaign.createdAt).toLocaleDateString("fr-FR")}
          </p>
        </div>
        <Link href="/dashboard/marketing" className="text-sm font-medium text-primary hover:underline">
          Retour
        </Link>
      </div>

      {error && (
        <p className="rounded-xl border border-danger/30 bg-danger-light px-4 py-3 text-sm text-danger">{error}</p>
      )}
      {success && (
        <p className="rounded-xl border border-success/30 bg-success-light px-4 py-3 text-sm text-success">
          {success}
        </p>
      )}

      <section className="flex flex-col gap-3 rounded-2xl border border-ink/5 bg-white p-5 shadow-sm">
        {campaign.posts.length === 0 ? (
          <p className="text-sm text-muted">Aucune publication dans cette campagne.</p>
        ) : (
          campaign.posts.map((post) => (
            <div key={post.id} className="rounded-xl border border-ink/10 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{post.productName ?? "Produit supprimé"}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted">{post.content}</p>
                  {post.scheduledFor && (
                    <p className="mt-1 text-xs text-muted">
                      Programmée pour le {new Date(post.scheduledFor).toLocaleString("fr-FR")}
                      {post.timezone ? ` (${post.timezone})` : ""}
                    </p>
                  )}
                  {post.errorMessage && <p className="mt-1 text-xs text-danger">{post.errorMessage}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${POST_STATUS_STYLES[post.status] ?? "bg-ink/10 text-ink"}`}
                  >
                    {POST_STATUS_LABELS[post.status] ?? post.status}
                  </span>
                  {(post.status === "draft" || post.status === "scheduled") && (
                    <form action={cancelPostAction}>
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="campaignId" value={campaign.id} />
                      <input type="hidden" name="postId" value={post.id} />
                      <SubmitButton
                        pendingLabel="..."
                        className="text-xs font-medium text-danger hover:underline disabled:opacity-60"
                      >
                        Annuler
                      </SubmitButton>
                    </form>
                  )}
                </div>
              </div>

              {post.targets.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-ink/5 pt-3">
                  {post.targets.map((t, i) => (
                    <span
                      key={`${t.platform}-${t.accountId}-${i}`}
                      className="rounded-full border border-ink/10 px-2.5 py-1 text-xs text-muted"
                      title={t.errorMessage ?? undefined}
                    >
                      {PLATFORM_LABELS[t.platform] ?? t.platform}
                      {" · "}
                      {t.status === "published" ? (
                        t.platformPostUrl ? (
                          <a href={t.platformPostUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                            voir la publication
                          </a>
                        ) : (
                          "publiée"
                        )
                      ) : t.status === "failed" ? (
                        <span className="text-danger">échec</span>
                      ) : (
                        "en attente"
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
