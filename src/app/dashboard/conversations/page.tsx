import Link from "next/link";
import { requireCurrentOrganization } from "@/application/services/auth-service";
import { countConversationsByChannel, listConversationsForOrg } from "@/application/services/conversation-admin-service";
import { PlatformTabs } from "@/app/_components/platform-tabs";
import { SOCIAL_BRAND, type SocialPlatformKey } from "@/app/_components/brand-icons";

const STATUS_STYLES: Record<string, string> = { pending_human: "bg-danger-50 text-danger-700", human: "bg-amber-100 text-amber-800", ai: "bg-violet-50 text-violet-700", resolved: "bg-slate-100 text-slate-600" };
const STATUS_LABELS: Record<string, string> = { pending_human: "À traiter", human: "Pris en charge", ai: "IA active", resolved: "Clôturée" };

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<{ channel?: string }> }) {
  const { channel } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  const current = channel ? channel : null;
  const [conversations, channelCounts] = await Promise.all([
    listConversationsForOrg(organizationId, current),
    countConversationsByChannel(organizationId).catch(() => ({} as Record<string, number>)),
  ]);
  const totalCount = Object.values(channelCounts).reduce((sum, n) => sum + n, 0);
  // Un onglet par réseau réellement présent, plus l'onglet actif même s'il est vide (URL partagée) ;
  // ordre stable : réseaux connus dans l'ordre de la marque, puis le reste.
  const known = Object.keys(SOCIAL_BRAND);
  const keys = new Set(Object.keys(channelCounts));
  if (current) keys.add(current);
  const tabs = [...keys]
    .sort((a, b) => (known.indexOf(a) === -1 ? 99 : known.indexOf(a)) - (known.indexOf(b) === -1 ? 99 : known.indexOf(b)))
    .map((key) => ({ key, count: channelCounts[key] ?? 0 }));
  const currentLabel = current ? (SOCIAL_BRAND[current as SocialPlatformKey]?.label ?? current) : null;
  const pending = conversations.filter(c => c.handoffStatus === "pending_human").length;
  const ai = conversations.filter(c => c.handoffStatus === "ai").length;
  return <div className="space-y-6">
    <header className="relative overflow-hidden rounded-3xl bg-navy-900 p-6 text-white sm:p-8"><div className="absolute -right-20 -top-20 h-60 w-60 rounded-full bg-violet-500/25 blur-3xl"/><div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="adm-eyebrow text-violet-300">Centre de conversations</p><h1 className="mt-2 font-jakarta text-2xl font-extrabold sm:text-3xl">Inbox client</h1><p className="mt-2 max-w-2xl text-sm text-white/60">Toutes vos conversations réunies dans une interface claire, rapide et pensée pour le suivi commercial.</p></div><Link href="/dashboard/channels" className="rounded-xl bg-violet-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-violet-500">Gérer les canaux</Link></div></header>
    <PlatformTabs basePath="/dashboard/conversations" current={current} tabs={tabs} totalCount={totalCount} />
    <div className="grid gap-4 sm:grid-cols-3"><div className="adm-card"><p className="adm-label">Conversations</p><p className="mt-2 text-2xl font-extrabold">{conversations.length}</p></div><div className="adm-card"><p className="adm-label">À traiter</p><p className="mt-2 text-2xl font-extrabold text-danger-600">{pending}</p></div><div className="adm-card"><p className="adm-label">IA active</p><p className="mt-2 text-2xl font-extrabold text-violet-600">{ai}</p></div></div>
    <section className="adm-card overflow-hidden p-0"><div className="border-b border-navy-900/[0.06] bg-white p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="adm-heading-2 text-lg">{currentLabel ? `Messages ${currentLabel}` : "Messages récents"}</h2><p className="mt-1 text-xs text-slate-500">Les demandes en attente sont automatiquement remontées en tête.</p></div><div className="rounded-xl bg-[#F8FAFC] px-3 py-2 text-xs text-slate-500">50 dernières conversations</div></div></div>
      {conversations.length === 0 ? <div className="grid min-h-72 place-items-center p-8 text-center"><div><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-violet-50 text-2xl">✦</div><p className="mt-4 font-semibold">{currentLabel ? `Aucune conversation ${currentLabel}` : "Votre inbox est prête"}</p><p className="mt-1 text-sm text-slate-500">{currentLabel ? "Rien pour ce réseau pour le moment." : "Connectez WhatsApp ou un réseau social pour commencer à recevoir des conversations."}</p><Link href="/dashboard/channels" className="mt-4 inline-flex text-sm font-semibold text-violet-700">Connecter un canal →</Link></div></div> : <div className="divide-y divide-navy-900/[0.05]">{conversations.map(c => <Link key={c.id} href={`/dashboard/conversations/${c.id}`} className="flex items-center gap-4 p-4 transition hover:bg-violet-50/50 sm:p-5"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 font-bold text-white">{(c.contactName ?? c.contactPhone ?? "?").charAt(0).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><p className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold">{SOCIAL_BRAND[c.channel as SocialPlatformKey] ? (() => { const b = SOCIAL_BRAND[c.channel as SocialPlatformKey]; return <span title={b.label} className={`grid h-4 w-4 shrink-0 place-items-center rounded ${b.badgeClassName}`}><b.Icon className="h-2.5 w-2.5 text-white" aria-hidden /></span>; })() : null}<span className="truncate">{c.contactName ?? c.contactPhone ?? "Contact inconnu"}</span></p><span className={`w-fit rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLES[c.handoffStatus] ?? "bg-slate-100 text-slate-600"}`}>{STATUS_LABELS[c.handoffStatus] ?? c.handoffStatus}</span></div><p className="mt-1 truncate text-xs text-slate-500">{c.handoffReasonLabel ?? "Conversation active"}</p></div><span className="hidden text-xs text-slate-400 sm:block">{c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleDateString("fr-FR", { day:"2-digit", month:"short" }) : ""}</span><span className="text-slate-300">›</span></Link>)}</div>}
    </section>
  </div>;
}
