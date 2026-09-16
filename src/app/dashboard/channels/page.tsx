import { redirect } from "next/navigation";
import { requireCurrentOrganization, requireMembership } from "@/application/services/auth-service";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { SubmitButton } from "@/app/_components/submit-button";
import { getZernioAccounts, getZernioConnectUrl } from "@/application/services/zernio-channel-service";
import { connectTelegramChannel, disconnectTelegramChannel, getTelegramChannelStatus } from "@/application/services/telegram-channel-service";
import { createYouTubeConnectUrl, getYouTubeConnection } from "@/application/services/youtube-channel-service";
import { AppError } from "@/lib/errors";

const SOCIAL_CHANNELS = [
  { id: "instagram", label: "Instagram", short: "IG", description: "Publiez vos photos, Reels et contenus produits.", mode: "managed" },
  { id: "facebook", label: "Facebook", short: "f", description: "Connectez votre Page Facebook et gérez vos publications.", mode: "managed" },
  { id: "linkedin", label: "LinkedIn", short: "in", description: "Publiez pour votre entreprise ou profil professionnel.", mode: "managed" },
  { id: "tiktok", label: "TikTok", short: "♪", description: "Diffusez vos vidéos et campagnes de contenu.", mode: "managed" },
  { id: "twitter", label: "X / Twitter", short: "X", description: "Publiez et suivez votre présence sur X.", mode: "managed" },
] as const;

function flash(kind: "success" | "error", message: string): never {
  redirect(`/dashboard/channels?${kind}=${encodeURIComponent(message)}`);
}

async function connectSocialAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const platform = String(formData.get("platform") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  const supabase = getSupabaseServiceClient();
  const { data: organization } = await supabase.from("organizations").select("name").eq("id", membership.organizationId).single();
  try {
    const url = await getZernioConnectUrl(organizationId, organization?.name ?? "Entreprise SME-OS", platform as never);
    redirect(url);
  } catch (error) {
    flash("error", error instanceof AppError ? error.message : error instanceof Error ? error.message : "Impossible de démarrer la connexion.");
  }
}

async function connectWhatsAppAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  const supabase = getSupabaseServiceClient();
  const { data: organization } = await supabase.from("organizations").select("name").eq("id", membership.organizationId).single();
  try {
    const url = await getZernioConnectUrl(organizationId, organization?.name ?? "Entreprise SME-OS", "whatsapp");
    redirect(url);
  } catch (error) { flash("error", error instanceof Error ? error.message : "Impossible de démarrer WhatsApp."); }
}

async function connectTelegramAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const botToken = String(formData.get("botToken") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  try {
    const result = await connectTelegramChannel(organizationId, membership.userId, botToken);
    flash("success", `Telegram connecté : @${result.botUsername}`);
  } catch (error) { flash("error", error instanceof Error ? error.message : "Connexion Telegram impossible."); }
}

async function disconnectTelegramAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  try { await disconnectTelegramChannel(organizationId, membership.userId); flash("success", "Telegram déconnecté."); }
  catch (error) { flash("error", error instanceof Error ? error.message : "Déconnexion Telegram impossible."); }
}

async function connectYouTubeAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin"]);
  try { redirect(createYouTubeConnectUrl(organizationId)); }
  catch (error) { flash("error", error instanceof Error ? error.message : "Connexion YouTube indisponible."); }
}

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const { success, error } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  const [accounts, telegram, youtube] = await Promise.all([
    getZernioAccounts(organizationId).catch(() => []),
    getTelegramChannelStatus(organizationId).catch(() => ({ connected: false, botUsername: null })),
    getYouTubeConnection(organizationId).catch(() => ({ connected: false, metadata: {}, credentialReference: null })),
  ]);
  const byPlatform = new Map(accounts.filter((a) => a.platform !== "youtube").map((a) => [a.platform, a]));
  const totalConnected = byPlatform.size + (youtube.connected ? 1 : 0) + (telegram.connected ? 1 : 0);

  return (
    <div className="space-y-7">
      <header className="relative overflow-hidden rounded-3xl bg-navy-900 p-6 text-white shadow-[0_20px_60px_-35px_rgba(14,17,48,.75)] sm:p-8">
        <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-violet-500/25 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="adm-eyebrow text-violet-300">Canaux</p><h1 className="mt-2 font-jakarta text-2xl font-extrabold tracking-tight sm:text-3xl">Tout connecter, sans complexité.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">Connectez vos canaux depuis SME-OS. Les détails techniques restent derrière l&apos;interface.</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">{totalConnected} canal{totalConnected > 1 ? "s" : ""} connecté{totalConnected > 1 ? "s" : ""}</div>
        </div>
      </header>

      {success ? <div className="adm-alert-success">{success}</div> : null}
      {error ? <div className="adm-alert-danger break-words">{error}</div> : null}

      <section className="adm-card border-violet-100 bg-violet-50/60">
        <p className="adm-eyebrow">Comment ça marche ?</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[["01", "Choisissez", "Le canal à connecter."], ["02", "Autorisez", "Le service affiche son propre parcours sécurisé."], ["03", "Travaillez", "Ensuite depuis SME-OS, sans configuration technique." ]].map(([n,t,d]) => <div key={n} className="rounded-2xl bg-white p-4 shadow-sm"><span className="text-xs font-extrabold text-violet-600">{n}</span><p className="mt-2 text-sm font-bold">{t}</p><p className="mt-1 text-xs leading-5 text-slate-500">{d}</p></div>)}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
        <div className="adm-card overflow-hidden p-0">
          <div className="border-b border-navy-900/[0.06] p-5 sm:p-6"><div className="flex items-center justify-between gap-4"><div><p className="adm-eyebrow">Messagerie</p><h2 className="mt-1 adm-heading-2 text-lg">WhatsApp Business</h2></div><span className={byPlatform.get("whatsapp") ? "adm-badge-success" : "adm-badge-neutral"}>{byPlatform.get("whatsapp") ? "Connecté" : "Non connecté"}</span></div><p className="mt-2 max-w-xl text-sm text-slate-500">Le parcours d&apos;autorisation est guidé. Une fois connecté, vos conversations arrivent dans votre boîte SME-OS.</p></div>
          <div className="grid gap-3 p-5 sm:grid-cols-3 sm:p-6">{[["01","Compte","Sélectionnez votre compte professionnel."],["02","Autorisation","Validez les accès demandés."],["03","Test","Revenez ici et envoyez votre premier message."]].map(([n,t,d])=><div key={n} className="rounded-2xl bg-[#F7F6FD] p-4"><span className="text-xs font-bold text-violet-600">{n}</span><p className="mt-2 text-sm font-semibold">{t}</p><p className="mt-1 text-xs leading-5 text-slate-500">{d}</p></div>)}</div>
          <div className="border-t border-navy-900/[0.06] p-5 sm:p-6"><form action={connectWhatsAppAction}><input type="hidden" name="organizationId" value={organizationId}/><SubmitButton pendingLabel="Ouverture…" className="adm-btn-primary w-full sm:w-auto">{byPlatform.get("whatsapp") ? "Reconnecter WhatsApp" : "Connecter WhatsApp"}</SubmitButton></form></div>
        </div>
        <div className="adm-card bg-gradient-to-br from-violet-50 via-white to-indigo-50"><p className="adm-eyebrow">Messagerie</p><h2 className="mt-1 adm-heading-2 text-lg">Une boîte pour vendre</h2><div className="mt-5 space-y-3">{[['●','WhatsApp','Demandes et suivi clients'],['◎','Instagram','Conversations sociales'],['◈','Facebook','Messenger et commentaires'],['✦','Assistant','Réponse automatique puis transfert humain']].map(([i,t,d])=><div key={t} className="flex items-center gap-3 rounded-2xl bg-white/80 p-3 shadow-sm"><span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-100 text-violet-700">{i}</span><div><p className="text-sm font-semibold">{t}</p><p className="text-xs text-slate-500">{d}</p></div></div>)}</div><a href="/dashboard/conversations" className="mt-5 inline-flex text-sm font-semibold text-violet-700 hover:underline">Ouvrir la boîte de réception →</a></div>
      </section>

      <section className="adm-card">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="adm-eyebrow">Réseaux sociaux</p><h2 className="mt-1 adm-heading-2 text-lg">Votre présence sociale</h2><p className="mt-1 text-sm text-slate-500">Les comptes gérés ici apparaissent dans vos publications et analytics.</p></div><a href="/dashboard/analytics" className="text-sm font-semibold text-violet-700 hover:underline">Voir les analytics →</a></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {SOCIAL_CHANNELS.map((channel) => { const account = byPlatform.get(channel.id); return <div key={channel.id} className="group flex min-h-[150px] flex-col rounded-2xl border border-navy-900/[0.07] bg-white p-4 transition hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-lg"><div className="flex items-start justify-between"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-navy-900 text-sm font-extrabold text-white">{channel.short}</span>{account ? <span className="adm-badge-success">Connecté</span> : <span className="adm-badge-neutral">Disponible</span>}</div><div className="mt-4"><p className="font-semibold">{channel.label}</p><p className="mt-1 text-xs leading-5 text-slate-500">{account?.username ? `@${account.username}` : channel.description}</p></div><form action={connectSocialAction} className="mt-auto pt-4"><input type="hidden" name="organizationId" value={organizationId}/><input type="hidden" name="platform" value={channel.id}/><SubmitButton pendingLabel="Connexion…" className="w-full rounded-xl border border-navy-900/10 bg-white px-3 py-2 text-xs font-semibold text-navy-900 transition hover:border-violet-300 hover:bg-violet-50">{account ? "Reconnecter" : "Connecter"}</SubmitButton></form></div>; })}

          <div className="group flex min-h-[150px] flex-col rounded-2xl border border-red-100 bg-gradient-to-br from-red-50 via-white to-white p-4 transition hover:-translate-y-0.5 hover:shadow-lg"><div className="flex items-start justify-between"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-red-600 text-sm font-extrabold text-white">▶</span>{youtube.connected ? <span className="adm-badge-success">Connecté</span> : <span className="adm-badge-neutral">Connexion directe</span>}</div><div className="mt-4"><p className="font-semibold">YouTube</p><p className="mt-1 text-xs leading-5 text-slate-500">{youtube.connected ? youtube.metadata.title ?? "Chaîne connectée" : "Connexion Google native, indépendante des autres canaux."}</p></div><form action={connectYouTubeAction} className="mt-auto pt-4"><input type="hidden" name="organizationId" value={organizationId}/><SubmitButton pendingLabel="Ouverture…" className="w-full rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-navy-900 hover:bg-red-50">{youtube.connected ? "Reconnecter YouTube" : "Connecter YouTube"}</SubmitButton></form></div>
        </div>
      </section>

      <section className="adm-card overflow-hidden">
        <div className="grid gap-6 lg:grid-cols-[1fr_.8fr]">
          <div><p className="adm-eyebrow">Telegram</p><h2 className="mt-1 adm-heading-2 text-lg">Votre bot, directement.</h2><p className="mt-2 text-sm leading-6 text-slate-500">Telegram fonctionne ici sans intermédiaire : créez votre bot avec BotFather, copiez son jeton puis collez-le ci-dessous. SME-OS configure automatiquement le webhook.</p><div className="mt-5 grid gap-3 sm:grid-cols-3">{[["01","Créer le bot","Ouvrez @BotFather puis /newbot."],["02","Copier le jeton","Copiez le token fourni par Telegram."],["03","Connecter","Collez-le ici et testez le bot."]].map(([n,t,d])=><div key={n} className="rounded-2xl bg-[#F7F6FD] p-4"><span className="text-xs font-bold text-violet-600">{n}</span><p className="mt-2 text-sm font-semibold">{t}</p><p className="mt-1 text-xs leading-5 text-slate-500">{d}</p></div>)}</div></div>
          <div className="rounded-2xl bg-navy-900 p-5 text-white"><p className="text-xs font-bold uppercase tracking-wider text-violet-300">Configuration</p>{telegram.connected ? <><p className="mt-2 text-sm text-white/70">Bot connecté : <strong className="text-white">@{telegram.botUsername}</strong></p><form action={disconnectTelegramAction} className="mt-5"><input type="hidden" name="organizationId" value={organizationId}/><SubmitButton pendingLabel="Déconnexion…" className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white hover:bg-white/15">Déconnecter</SubmitButton></form></> : <form action={connectTelegramAction} className="mt-4 space-y-3"><input type="hidden" name="organizationId" value={organizationId}/><label className="block text-xs font-semibold text-white/70">Jeton du bot</label><input name="botToken" type="password" autoComplete="off" placeholder="123456:ABC…" required className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white placeholder:text-white/30 outline-none"/><SubmitButton pendingLabel="Vérification…" className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-500">Connecter mon bot</SubmitButton><a className="block text-center text-xs text-white/45 hover:text-white" href="https://t.me/BotFather" target="_blank" rel="noreferrer">Ouvrir BotFather →</a></form>}</div>
        </div>
      </section>
    </div>
  );
}