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
  draft: "bg-ink/10 text-muted",
  scheduled: "bg-ink/10 text-ink",
  published: "bg-leaf/10 text-leaf",
  partial: "bg-amber-500/10 text-amber-600",
  failed: "bg-clay/10 text-clay",
  cancelled: "bg-ink/10 text-muted",
  paused: "bg-ink/10 text-muted",
};

const TARGET_STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  published: "Publié",
  failed: "Échoué",
};

const TARGET_STATUS_STYLES: Record<string, string> = {
  pending: "bg-ink/10 text-muted",
  published: "bg-leaf/10 text-leaf",
  failed: "bg-clay/10 text-clay",
};

export default async function MarketingPage() {
  const { organizationId } = await requireCurrentOrganization();
  const posts = await listRecentPosts(organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Publications</h1>
        <p className="mt-1 text-sm text-muted">
          Statut réel de vos publications sociales, plateforme par plateforme — mis à jour automatiquement dès
          que Zernio confirme une diffusion.
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-brand border border-ink/10 bg-white p-4">
        {posts.length === 0 ? (
          <p className="text-sm text-muted">Aucune publication pour l&apos;instant.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-ink/5">
            {posts.map((post) => (
              <li key={post.id} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-ink line-clamp-2">{post.content}</p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                      POST_STATUS_STYLES[post.status] ?? "bg-ink/10 text-ink"
                    }`}
                  >
                    {POST_STATUS_LABELS[post.status] ?? post.status}
                  </span>
                </div>

                <p className="text-xs text-muted">
                  {post.scheduledFor
                    ? `Programmée pour le ${new Date(post.scheduledFor).toLocaleString("fr-FR")}`
                    : `Créée le ${new Date(post.createdAt).toLocaleString("fr-FR")}`}
                </p>

                {post.errorMessage && (
                  <p className="rounded-brand border border-clay/30 bg-clay/5 px-3 py-2 text-xs text-clay">
                    {post.errorMessage}
                  </p>
                )}

                {post.targets.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {post.targets.map((target) => (
                      <span
                        key={target.platform}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
                          TARGET_STATUS_STYLES[target.status] ?? "bg-ink/10 text-ink"
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
