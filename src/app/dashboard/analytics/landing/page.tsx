import Link from "next/link";
import { requireCurrentOrganization } from "@/application/services/auth-service";
import { getLandingAnalytics } from "@/application/services/landing-analytics-service";

export const dynamic = "force-dynamic";

const PERIODS = [7, 30, 90] as const;

function formatNumber(value: number): string {
  return new Intl.NumberFormat("fr-FR").format(value);
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["fr"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function prettifyId(id: string): string {
  return id.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="adm-card">
      <p className="adm-eyebrow">{label}</p>
      <p className="mt-2 font-jakarta text-3xl font-extrabold text-navy-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function RankedCard({
  eyebrow,
  title,
  rows,
  empty,
}: {
  eyebrow: string;
  title: string;
  rows: Array<{ label: string; value: number; detail?: string }>;
  empty: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="adm-card">
      <p className="adm-eyebrow">{eyebrow}</p>
      <h2 className="mt-1 adm-heading-2 text-lg">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => (
            <li key={row.label}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-navy-900">{row.label}</span>
                <span className="shrink-0 text-slate-500">
                  {formatNumber(row.value)}
                  {row.detail ? ` · ${row.detail}` : ""}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-violet-500" style={{ width: `${(row.value / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function LandingAnalyticsPage({
  searchParams,
}: {
  searchParams?: Promise<{ days?: string }> | { days?: string };
}) {
  const { organizationId } = await requireCurrentOrganization();
  const params = await searchParams;
  const requested = Number(params?.days);
  const days = (PERIODS as readonly number[]).includes(requested) ? requested : 30;

  const { summary, productNames, videoTitles } = await getLandingAnalytics(organizationId, days);
  const { totals, daily } = summary;
  const maxPageViews = Math.max(1, ...daily.map((d) => d.pageViews));
  const isEmpty = totals.pageViews === 0 && totals.ctaClicks === 0 && totals.videoPlays === 0;

  return (
    <div className="space-y-7">
      <header className="relative overflow-hidden rounded-3xl bg-navy-900 p-6 text-white sm:p-8">
        <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-violet-500/25 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-violet-200">Analytics vitrine</p>
            <h1 className="mt-2 font-jakarta text-2xl font-extrabold sm:text-3xl">Performance de votre landing page</h1>
            <p className="mt-2 max-w-xl text-sm text-slate-300">
              Visiteurs, provenance, pages, boutons et vidéos de votre vitrine publique. Mesure sans cookie : un visiteur est compté une fois par jour.
            </p>
          </div>
          <nav className="flex gap-1 rounded-xl bg-white/10 p-1 text-sm" aria-label="Période">
            {PERIODS.map((period) => (
              <Link
                key={period}
                href={`/dashboard/analytics/landing?days=${period}`}
                className={`rounded-lg px-3 py-1.5 font-medium ${period === days ? "bg-white text-navy-900" : "text-slate-200 hover:bg-white/10"}`}
              >
                {period} j
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {isEmpty ? (
        <div className="adm-alert-warning">
          Aucune visite enregistrée sur cette période. La mesure détaillée (visiteurs, provenance, appareils) démarre avec cette version : les
          visites à venir apparaîtront ici. Partagez le lien de votre vitrine — avec <code>?utm_source=facebook</code> (ou whatsapp, tiktok,
          instagram…) à la fin de l&apos;adresse pour savoir d&apos;où viennent vos clients.
        </div>
      ) : null}

      {summary.truncated ? (
        <div className="adm-alert-warning">Trafic très élevé : seuls les 20 000 événements les plus récents de la période sont analysés.</div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Visiteurs" value={formatNumber(totals.visitors)} hint="Uniques par jour, cumulés sur la période" />
        <KpiCard label="Pages vues" value={formatNumber(totals.pageViews)} hint={totals.pagesPerVisit ? `${totals.pagesPerVisit} pages par visite` : undefined} />
        <KpiCard label="Nouveaux prospects" value={formatNumber(totals.leads)} hint={`Conversion : ${formatPercent(totals.conversionRate)}`} />
        <KpiCard label="Commandes" value={formatNumber(totals.orders)} />
        <KpiCard label="Clics sur vos boutons" value={formatNumber(totals.ctaClicks)} />
        <KpiCard label="Vidéos lues" value={formatNumber(totals.videoPlays)} hint="Première lecture par affichage de page" />
      </section>

      <section className="adm-card">
        <p className="adm-eyebrow">Tendance</p>
        <h2 className="mt-1 adm-heading-2 text-lg">Pages vues et visiteurs par jour</h2>
        <div className="mt-5 flex h-40 items-end gap-px" role="img" aria-label="Pages vues et visiteurs par jour">
          {daily.map((day) => (
            <div
              key={day.date}
              className="flex h-full flex-1 flex-col justify-end"
              title={`${day.date} : ${day.pageViews} pages vues, ${day.visitors} visiteurs`}
            >
              <div className="flex w-full flex-col justify-end rounded-t bg-violet-200" style={{ height: `${(day.pageViews / maxPageViews) * 100}%` }}>
                <div
                  className="w-full rounded-t bg-violet-600"
                  style={{ height: `${day.pageViews ? (Math.min(day.visitors, day.pageViews) / day.pageViews) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-xs text-slate-500">
          <span>{daily[0]?.date}</span>
          <span>
            <span className="mr-3 inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm bg-violet-200" /> Pages vues</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm bg-violet-600" /> Part des visiteurs</span>
          </span>
          <span>{daily.at(-1)?.date}</span>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <RankedCard
          eyebrow="Provenance"
          title="D'où viennent vos visiteurs"
          rows={summary.sources.map((s) => ({ label: s.label, value: s.count }))}
          empty="Pas encore de données de provenance."
        />
        <RankedCard
          eyebrow="Pages"
          title="Pages les plus vues"
          rows={summary.topPages.map((p) => ({ label: p.path === "/" ? "Page d'accueil" : p.path, value: p.views }))}
          empty="Aucune page vue."
        />
        <RankedCard
          eyebrow="Appareils"
          title="Mobile, tablette, ordinateur"
          rows={summary.devices.map((d) => ({ label: d.label, value: d.count }))}
          empty="Pas encore de données."
        />
        <RankedCard
          eyebrow="Géographie"
          title="Pays des visiteurs"
          rows={summary.countries.map((c) => ({ label: countryName(c.label), value: c.count }))}
          empty="Pays non disponible."
        />
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        <RankedCard
          eyebrow="Boutons"
          title="Appels à l'action cliqués"
          rows={summary.ctas.map((c) => ({ label: prettifyId(c.id), value: c.clicks }))}
          empty="Aucun clic sur vos boutons."
        />
        <RankedCard
          eyebrow="Catalogue"
          title="Produits les plus consultés"
          rows={summary.products.map((p) => ({
            label: productNames[p.id] ?? "Produit supprimé",
            value: p.views,
            detail: p.clicks ? `${p.clicks} clic${p.clicks > 1 ? "s" : ""}` : undefined,
          }))}
          empty="Aucun produit consulté."
        />
        <RankedCard
          eyebrow="Vidéos"
          title="Vidéos les plus lues"
          rows={summary.videos.map((v) => ({ label: videoTitles[v.id] ?? "Vidéo supprimée", value: v.plays }))}
          empty="Aucune vidéo lue."
        />
      </section>
    </div>
  );
}
