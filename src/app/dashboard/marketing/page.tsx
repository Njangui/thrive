import Link from "next/link";
import { requireCurrentOrganization } from "@/application/services/auth-service";
import { listCampaigns, getTopPublications } from "@/application/services/marketing-service";
import { Icon } from "../_components/icons";

const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  active: "Active",
  completed: "Terminée",
  cancelled: "Annulée",
};

const CAMPAIGN_STATUS_STYLES: Record<string, string> = {
  draft: "bg-ink/10 text-ink",
  active: "bg-success-light text-success",
  completed: "bg-primary-light text-primary-dark",
  cancelled: "bg-ink/10 text-muted",
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

export default async function MarketingPage() {
  const { organizationId } = await requireCurrentOrganization();
  const [campaigns, topPublications] = await Promise.all([
    listCampaigns(organizationId),
    getTopPublications(organizationId, 10),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Marketing</h1>
          <p className="mt-1 text-sm text-muted">
            Publiez vos produits sur vos réseaux sociaux connectés et suivez leurs performances.
          </p>
        </div>
        <Link
          href="/dashboard/marketing/new"
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-dark"
        >
          <Icon name="plus" className="h-4 w-4" />
          Nouvelle campagne
        </Link>
      </div>

      <section className="rounded-2xl border border-ink/5 bg-white p-5 shadow-sm">
        <h2 className="font-display text-base font-semibold text-ink">Campagnes</h2>

        {campaigns.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Aucune campagne pour l&apos;instant. Créez-en une pour publier vos produits sur vos réseaux sociaux.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            {campaigns.map((c) => (
              <Link
                key={c.id}
                href={`/dashboard/marketing/${c.id}`}
                className="flex items-center justify-between rounded-xl border border-ink/10 px-4 py-3 text-sm hover:bg-surface"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{c.name}</p>
                  <p className="text-xs text-muted">
                    {c.totalPosts} publication{c.totalPosts > 1 ? "s" : ""} ·{" "}
                    {new Date(c.createdAt).toLocaleDateString("fr-FR")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {c.counts.published > 0 && (
                    <span className="rounded-full bg-success-light px-2 py-0.5 text-xs text-success">
                      {c.counts.published} publiée{c.counts.published > 1 ? "s" : ""}
                    </span>
                  )}
                  {c.counts.scheduled > 0 && (
                    <span className="rounded-full bg-primary-light px-2 py-0.5 text-xs text-primary-dark">
                      {c.counts.scheduled} programmée{c.counts.scheduled > 1 ? "s" : ""}
                    </span>
                  )}
                  {(c.counts.failed > 0 || c.counts.partial > 0) && (
                    <span className="rounded-full bg-danger-light px-2 py-0.5 text-xs text-danger">
                      {c.counts.failed + c.counts.partial} échec(s)
                    </span>
                  )}
                  <span className={`rounded-full px-2 py-0.5 text-xs ${CAMPAIGN_STATUS_STYLES[c.status] ?? "bg-ink/10 text-ink"}`}>
                    {CAMPAIGN_STATUS_LABELS[c.status] ?? c.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-ink/5 bg-white p-5 shadow-sm">
        <h2 className="font-display text-base font-semibold text-ink">Top publications</h2>
        <p className="text-xs text-muted">Classées par engagement (mentions J&apos;aime + commentaires + partages + clics).</p>

        {topPublications.error ? (
          <p className="mt-3 rounded-xl border border-warning/30 bg-warning-light px-4 py-3 text-sm text-warning">
            {topPublications.error}
          </p>
        ) : topPublications.entries.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Aucune publication avec des statistiques pour l&apos;instant.</p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-2 py-2">Publication</th>
                <th className="px-2 py-2">Plateforme</th>
                <th className="px-2 py-2 text-right">Vues</th>
                <th className="px-2 py-2 text-right">J&apos;aime</th>
                <th className="px-2 py-2 text-right">Commentaires</th>
                <th className="px-2 py-2 text-right">Partages</th>
              </tr>
            </thead>
            <tbody>
              {topPublications.entries.map((entry) => (
                <tr key={entry.providerPostId} className="border-b border-ink/5 last:border-0">
                  <td className="px-2 py-2">
                    <p className="font-medium text-ink">{entry.productName ?? entry.contentPreview ?? "Publication"}</p>
                    {entry.campaignName && <p className="text-xs text-muted">{entry.campaignName}</p>}
                  </td>
                  <td className="px-2 py-2 text-muted">{PLATFORM_LABELS[entry.platform] ?? entry.platform}</td>
                  <td className="px-2 py-2 text-right text-muted">{entry.views.toLocaleString("fr-FR")}</td>
                  <td className="px-2 py-2 text-right text-muted">{entry.likes.toLocaleString("fr-FR")}</td>
                  <td className="px-2 py-2 text-right text-muted">{entry.comments.toLocaleString("fr-FR")}</td>
                  <td className="px-2 py-2 text-right text-muted">{entry.shares.toLocaleString("fr-FR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
