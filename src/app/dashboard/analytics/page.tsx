import { requireCurrentOrganization } from "@/application/services/auth-service";
import { getSocialPublishingProvider } from "@/infrastructure/providers/registry";
import { PlatformTabs } from "@/app/_components/platform-tabs";
import { SOCIAL_BRAND, type SocialPlatformKey } from "@/app/_components/brand-icons";

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", tiktok: "TikTok", twitter: "X", youtube: "YouTube", telegram: "Telegram", whatsapp: "WhatsApp", threads: "Threads",
};
function formatNumber(value: number) { return new Intl.NumberFormat("fr-FR", { notation: value > 9999 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value); }

export default async function SocialAnalyticsPage({ searchParams }: { searchParams: Promise<{ channel?: string }> }) {
  const { channel } = await searchParams;
  const current = channel ? channel : null;
  const { organizationId } = await requireCurrentOrganization();
  const provider = await getSocialPublishingProvider(organizationId).catch(() => null);
  const to = new Date(); const from = new Date(Date.now() - 29 * 86400000);
  const days = provider ? await provider.getDailyMetrics(from.toISOString().slice(0,10), to.toISOString().slice(0,10)).catch(() => []) : [];
  const platforms = new Map<string, number>(); days.forEach(d => Object.entries(d.platforms).forEach(([p,n]) => platforms.set(p,(platforms.get(p)??0)+n)));

  // Zernio ne ventile PAS portée/impressions/abonnés par réseau (daily-metrics = totaux tous réseaux) :
  // pour un onglet réseau, l'engagement vient de l'analytique PAR PUBLICATION (getAnalytics), filtrée sur la plateforme.
  const perPost = current && provider ? await provider.getAnalytics({ sortBy: "recent", limit: 100 }).catch(() => []) : [];
  const platformPosts = perPost.filter((entry) => entry.platform === current);
  const platformTotals = platformPosts.reduce(
    (acc, entry) => ({ views: acc.views + (entry.views ?? 0), likes: acc.likes + (entry.likes ?? 0), comments: acc.comments + (entry.comments ?? 0), shares: acc.shares + (entry.shares ?? 0), clicks: acc.clicks + (entry.clicks ?? 0) }),
    { views: 0, likes: 0, comments: 0, shares: 0, clicks: 0 },
  );

  const totals = days.reduce((acc, day) => { for (const key of Object.keys(acc)) acc[key as keyof typeof acc] += day.metrics[key as keyof typeof day.metrics] ?? 0; return acc; }, { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, views: 0, follows: 0 });
  const posts = days.reduce((n,d)=>n+d.postCount,0);
  const maxReach = Math.max(...days.map(d => d.metrics.reach), 1); const maxPosts = Math.max(...platforms.values(),1);

  const known = Object.keys(SOCIAL_BRAND);
  const tabKeys = new Set(platforms.keys()); if (current) tabKeys.add(current);
  const tabs = [...tabKeys].sort((a, b) => (known.indexOf(a) === -1 ? 99 : known.indexOf(a)) - (known.indexOf(b) === -1 ? 99 : known.indexOf(b))).map((key) => ({ key, count: platforms.get(key) ?? 0 }));
  const currentLabel = current ? (SOCIAL_BRAND[current as SocialPlatformKey]?.label ?? PLATFORM_LABELS[current] ?? current) : null;
  return <div className="space-y-7">
    <header className="relative overflow-hidden rounded-3xl bg-navy-900 p-6 text-white sm:p-8"><div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-violet-500/25 blur-3xl"/><div className="relative"><p className="adm-eyebrow text-violet-300">Performance sociale</p><div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="font-jakarta text-2xl font-extrabold sm:text-3xl">Analytics des réseaux</h1><p className="mt-2 text-sm text-white/60">Portée, impressions, engagement et activité des comptes connectés sur les 30 derniers jours.</p></div><span className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">30 derniers jours</span></div></div></header>
    <PlatformTabs basePath="/dashboard/analytics" current={current} tabs={tabs} totalCount={posts} />
    {current ? <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{[['Publications', platforms.get(current) ?? 0], ['Vues', platformTotals.views], ['Engagements', platformTotals.likes+platformTotals.comments+platformTotals.shares], ['Clics', platformTotals.clicks], ['Commentaires', platformTotals.comments]].map(([label,value])=><div key={String(label)} className="adm-card"><p className="adm-label">{label}</p><p className="mt-2 font-jakarta text-2xl font-extrabold">{formatNumber(Number(value))}</p><p className="mt-1 text-xs text-slate-500">{label === 'Publications' ? '30 derniers jours' : `${platformPosts.length} dernières publications ${currentLabel}`}</p></div>)}</section>
      <div className="adm-card text-sm leading-6 text-slate-600">Portée, impressions et nouveaux abonnés ne sont fournis que tous réseaux confondus : consultez l&apos;onglet « Tous » pour ces indicateurs. {platformPosts.length === 0 ? `Aucune statistique de publication ${currentLabel} disponible pour le moment (${currentLabel} ne fournit peut-être pas d’analytics de ce type).` : ''}</div>
    </> : <>
    {!provider ? <div className="adm-alert-warning">Connectez au moins un compte social dans <a href="/dashboard/channels" className="font-semibold underline">Canaux</a> pour afficher vos statistiques.</div> : null}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{[['Impressions', totals.impressions], ['Portée', totals.reach], ['Engagements', totals.likes+totals.comments+totals.shares+totals.saves], ['Clics', totals.clicks], ['Publications', posts]].map(([label,value])=><div key={String(label)} className="adm-card"><p className="adm-label">{label}</p><p className="mt-2 font-jakarta text-2xl font-extrabold">{formatNumber(Number(value))}</p><p className="mt-1 text-xs text-emerald-600">Données disponibles</p></div>)}</section>
    <section className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]"><div className="adm-card"><p className="adm-eyebrow">Audience</p><h2 className="mt-1 adm-heading-2 text-lg">Évolution de la portée</h2><div className="mt-6 flex h-56 items-end gap-1 overflow-hidden rounded-2xl bg-[#F8FAFC] p-4">{days.length ? days.map(d=><div key={d.date} title={`${d.date}: ${formatNumber(d.metrics.reach)}`} className="min-w-1 flex-1 rounded-t-md bg-violet-500/80 transition hover:bg-violet-600" style={{height:`${Math.max(4,(d.metrics.reach/maxReach)*100)}%`}}/>) : <div className="grid w-full place-items-center text-sm text-slate-400">Aucune donnée sociale disponible.</div>}</div></div>
      <div className="adm-card"><p className="adm-eyebrow">Mix</p><h2 className="mt-1 adm-heading-2 text-lg">Publications par réseau</h2><div className="mt-5 space-y-3">{[...platforms.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([p,n])=><div key={p}><div className="flex justify-between text-sm"><span className="font-medium">{PLATFORM_LABELS[p] ?? p}</span><span className="text-slate-500">{n}</span></div><div className="mt-1.5 h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-500" style={{width:`${Math.min(100, n/maxPosts*100)}%`}}/></div></div>)}</div></div></section>
    <section className="grid gap-5 lg:grid-cols-2"><div className="adm-card"><p className="adm-eyebrow">Engagement</p><h2 className="mt-1 adm-heading-2 text-lg">Interactions</h2><div className="mt-5 grid grid-cols-2 gap-3">{[['J’aime',totals.likes],['Commentaires',totals.comments],['Partages',totals.shares],['Enregistrements',totals.saves]].map(([l,v])=><div key={String(l)} className="rounded-2xl bg-[#F8FAFC] p-4"><p className="text-xs text-slate-500">{l}</p><p className="mt-2 font-jakarta text-xl font-bold">{formatNumber(Number(v))}</p></div>)}</div></div><div className="adm-card"><p className="adm-eyebrow">Conversion</p><h2 className="mt-1 adm-heading-2 text-lg">Trafic social</h2><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-2xl bg-violet-50 p-4"><p className="text-xs text-violet-700">Clics</p><p className="mt-2 text-xl font-bold">{formatNumber(totals.clicks)}</p></div><div className="rounded-2xl bg-emerald-50 p-4"><p className="text-xs text-emerald-700">Nouveaux abonnés</p><p className="mt-2 text-xl font-bold">{formatNumber(totals.follows)}</p></div><div className="col-span-2 rounded-2xl border border-navy-900/[0.06] p-4 text-xs leading-5 text-slate-500">Les métriques disponibles dépendent des API de chaque plateforme. Telegram, par exemple, ne fournit pas d’analytics de ce type.</div></div></div></section>
    </>}
  </div>;
}
