import { requireCurrentOrganization } from "@/application/services/auth-service";
import { listRecentPosts } from "@/application/services/marketing-service";

/**
 * Lot M, Partie 2 — écran des publications sociales.
 *
 * Ce projet n'avait jamais eu d'écran pour `social_posts` (Lot H a
 * construit `createCampaignFromProducts` côté service uniquement,
 * jamais de route/page — recherché dans tout `src/app`, confirmé absent).
 * Le périmètre de CE lot est la synchronisation des RÉSULTATS, pas le
 * constructeur de campagne (sélection de produits/comptes/planification),
 * qui reste une fonctionnalité à part entière hors du cahier "Groupes
 * WhatsApp + synchronisation des publications" — voir RAPPORT_LOT_M.md.
 * Cette page est donc volontairement une liste en lecture — mais une
 * liste RÉELLE, branchée sur les vraies données, pas un stub : c'est elle
 * qui affiche le statut réel par plateforme (publié/échoué/en attente)
 * une fois connu via `handlePostStatusWebhook`, critère d'acceptation
 * explicite de ce lot.
 */

const POST_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  scheduled: "Programmée",
  published: "Publiée",
  partial: "Partiellement publiée",
  failed: "Échouée",
  cancelled: "Annulée",
  paused: "En pause",
};

const POST_STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  scheduled: "bg-slate-100 text-navy-900",
  published: "bg-success-50 text-success-700",
  partial: "bg-amber-500/10 text-amber-600",
  failed: "bg-danger-50 text-danger-700",
  cancelled: "bg-slate-100 text-slate-600",
  paused: "bg-slate-100 text-slate-600",
};

const TARGET_STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  published: "Publié",
  failed: "Échoué",
};

const TARGET_STATUS_STYLES: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  published: "bg-success-50 text-success-700",
  failed: "bg-danger-50 text-danger-700",
};

export default async function MarketingPage() {
  const { organizationId } = await requireCurrentOrganization();
  const posts = await listRecentPosts(organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
        <p className="adm-eyebrow">Marketing social</p>
        <h1 className="mt-1 font-jakarta text-2xl font-bold tracking-tight">Publications</h1>
        <p className="mt-1 text-sm text-slate-500">
          Statut réel de vos publications sociales, plateforme par plateforme — mis à jour automatiquement après confirmation de diffusion.
        </p>
        </div>
        <a href="/dashboard/analytics" className="adm-btn-secondary w-fit">Voir les analytics</a>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)] p-4">
        {posts.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune publication pour l&apos;instant.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-navy-900/5">
            {posts.map((post) => (
              <li key={post.id} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-navy-900 line-clamp-2">{post.content}</p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                      POST_STATUS_STYLES[post.status] ?? "bg-slate-100 text-navy-900"
                    }`}
                  >
                    {POST_STATUS_LABELS[post.status] ?? post.status}
                  </span>
                </div>

                <p className="text-xs text-slate-500">
                  {post.scheduledFor
                    ? `Programmée pour le ${new Date(post.scheduledFor).toLocaleString("fr-FR")}`
                    : `Créée le ${new Date(post.createdAt).toLocaleString("fr-FR")}`}
                </p>

                {post.errorMessage && (
                  <p className="rounded-xl border border-danger-600/20 bg-danger-50 px-3 py-2 text-xs text-danger-600">
                    {post.errorMessage}
                  </p>
                )}

                {post.targets.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {post.targets.map((target) => (
                      <span
                        key={target.platform}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
                          TARGET_STATUS_STYLES[target.status] ?? "bg-slate-100 text-navy-900"
                        }`}
                        title={target.errorMessage ?? undefined}
                      >
                        <span className="font-medium capitalize">{target.platform}</span>
                        <span>·</span>
                        <span>{TARGET_STATUS_LABELS[target.status] ?? target.status}</span>
                        {target.platformPostUrl && (
                          <a
                            href={target.platformPostUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                          >
                            Voir
                          </a>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
