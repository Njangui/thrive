import { redirect } from "next/navigation";
import { requireCurrentOrganization, requireMembership, getCurrentUserEmail } from "@/application/services/auth-service";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { SubmitButton } from "@/app/_components/submit-button";
import { getZernioAccounts, getZernioConnectUrl, getZernioWhatsAppConnectUrl, getZernioWhatsAppAccounts, getZernioWhatsAppGroupsConnectUrl, getZernioWhatsAppGroupsAccount } from "@/application/services/zernio-channel-service";
import { connectTelegramChannel, disconnectTelegramChannel, getTelegramChannelStatus } from "@/application/services/telegram-channel-service";
import { createYouTubeConnectUrl, getYouTubeConnection } from "@/application/services/youtube-channel-service";
import {
  requestDedicatedNumber,
  getOrganizationDedicatedNumberStatus,
  getDedicatedNumberMonthlyPriceFcfa,
  initiateDedicatedNumberPayment,
} from "@/application/services/phone-number-rental-service";
import { AppError } from "@/lib/errors";
import { SOCIAL_BRAND } from "@/app/_components/brand-icons";
import { canUseFeature } from "@/application/services/entitlements-service";

// Les vraies icônes/couleurs de marque (Instagram, Facebook, LinkedIn,
// TikTok, X) vivent dans `SOCIAL_BRAND` (`brand-icons.tsx`, source unique
// partagée avec les autres écrans qui affichent ces réseaux) — ce tableau
// ne garde que ce qui est spécifique à cette page (description, mode).
const SOCIAL_CHANNELS = [
  { id: "instagram", label: "Instagram", description: "Publiez vos photos, Reels et contenus produits.", mode: "managed" },
  { id: "facebook", label: "Facebook", description: "Connectez votre Page Facebook et gérez vos publications.", mode: "managed" },
  { id: "linkedin", label: "LinkedIn", description: "Publiez pour votre entreprise ou profil professionnel.", mode: "managed" },
  { id: "tiktok", label: "TikTok", description: "Diffusez vos vidéos et campagnes de contenu.", mode: "managed" },
  ] as const;

function flash(kind: "success" | "error", message: string): never {
  redirect(`/dashboard/channels?${kind}=${encodeURIComponent(message)}`);
}

// IMPORTANT : redirect() (et flash(), qui appelle redirect()) ne doit JAMAIS
// être appelé à l'intérieur d'un try dont le catch ci-dessous pourrait
// l'intercepter. Next.js implémente redirect() en levant une exception
// spéciale (digest "NEXT_REDIRECT") pour que son propre runtime effectue
// la redirection ; si on l'appelle dans un try, c'est notre catch qui
// l'attrape à la place et la traite comme une vraie erreur — d'où le
// message d'erreur littéral "NEXT_REDIRECT" affiché à l'utilisateur.
// Pattern correct (voir aussi dashboard/site/page.tsx et
// dashboard/services/new/page.tsx) : tout calcul/appel réseau reste dans
// le try ; seul le résultat est capturé dans une variable ; le
// redirect()/flash() de succès n'intervient qu'après le try/catch.

async function connectSocialAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const platform = String(formData.get("platform") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  const platformEntitlement: Record<string, string> = { facebook: "facebook_pages", instagram: "instagram_accounts", linkedin: "linkedin_pages", tiktok: "tiktok_accounts" };
  const entitlementKey = platformEntitlement[platform];
  if (entitlementKey) {
    const entitlement = await canUseFeature(organizationId, entitlementKey, 1);
    if (!entitlement.allowed) flash("error", `Le canal ${platform} n'est pas inclus dans votre offre ou sa limite est atteinte.`);
  }
  const supabase = getSupabaseServiceClient();
  const { data: organization } = await supabase.from("organizations").select("name").eq("id", membership.organizationId).single();
  let url: string;
  try {
    url = await getZernioConnectUrl(organizationId, organization?.name ?? "Entreprise CRESYVA", platform as never);
  } catch (error) {
    flash("error", error instanceof AppError ? error.message : error instanceof Error ? error.message : "Impossible de démarrer la connexion.");
  }
  redirect(url);
}

async function connectWhatsAppAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  const whatsappEntitlement = await canUseFeature(organizationId, "whatsapp", 1);
  if (!whatsappEntitlement.allowed) {
    flash("error", "WhatsApp n'est pas inclus dans votre offre. Passez à Starter ou Pro pour connecter un numéro.");
  }
  const supabase = getSupabaseServiceClient();
  const { data: organization } = await supabase.from("organizations").select("name").eq("id", membership.organizationId).single();
  let url: string;
  try {
    url = await getZernioWhatsAppConnectUrl(organizationId, organization?.name ?? "Entreprise CRESYVA");
  } catch (error) {
    flash("error", error instanceof Error ? error.message : "Impossible de démarrer WhatsApp.");
  }
  redirect(url);
}

/** Numéro DÉDIÉ aux Groupes WhatsApp (Cloud API, jamais Coexistence) — chemin gratuit (le commerçant connecte son propre numéro). */
async function connectWhatsAppGroupsAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  const groupEntitlement = await canUseFeature(organizationId, "whatsapp_groups", 1);
  if (!groupEntitlement.allowed) {
    flash("error", "Les Groupes WhatsApp ne sont pas inclus dans votre offre. Passez à Starter ou Pro.");
  }
  const supabase = getSupabaseServiceClient();
  const { data: organization } = await supabase.from("organizations").select("name").eq("id", membership.organizationId).single();
  let url: string;
  try {
    url = await getZernioWhatsAppGroupsConnectUrl(organizationId, organization?.name ?? "Entreprise CRESYVA");
  } catch (error) {
    flash("error", error instanceof Error ? error.message : "Connexion du numéro dédié impossible.");
  }
  redirect(url);
}

/** Chemin payant — le commerçant demande à CRESYVA de lui fournir un numéro dédié (traité ensuite depuis /admin/numbers). */
async function requestDedicatedNumberAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  try {
    await requestDedicatedNumber(organizationId, membership.userId);
  } catch (error) {
    flash("error", error instanceof AppError ? error.message : "Impossible d'envoyer la demande.");
  }
  flash("success", "Demande envoyée — l'équipe CRESYVA va vous assigner un numéro sous peu.");
}

/** Paiement (premier mois ou renouvellement) du loyer du numéro dédié. */
async function payDedicatedNumberAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const phoneNumberId = String(formData.get("phoneNumberId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  const email = await getCurrentUserEmail();
  if (!email) {
    flash("error", "Email de session introuvable — reconnectez-vous.");
  }
  let url: string;
  try {
    const result = await initiateDedicatedNumberPayment(organizationId, phoneNumberId, membership.userId, email as string);
    if (!result.paymentUrl) throw new Error("URL de paiement manquante dans la réponse NotchPay.");
    url = result.paymentUrl;
  } catch (error) {
    flash("error", error instanceof AppError ? error.message : "Erreur lors de l'initiation du paiement.");
  }
  redirect(url);
}

async function connectTelegramAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const botToken = String(formData.get("botToken") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  const telegramEntitlement = await canUseFeature(organizationId, "telegram_bots", 1);
  if (!telegramEntitlement.allowed) flash("error", "La connexion Telegram n'est pas incluse dans votre offre.");
  let botUsername: string;
  try {
    const result = await connectTelegramChannel(organizationId, membership.userId, botToken);
    botUsername = result.botUsername;
  } catch (error) {
    flash("error", error instanceof Error ? error.message : "Connexion Telegram impossible.");
  }
  flash("success", `Telegram connecté : @${botUsername}`);
}

async function disconnectTelegramAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  try {
    await disconnectTelegramChannel(organizationId, membership.userId);
  } catch (error) {
    flash("error", error instanceof Error ? error.message : "Déconnexion Telegram impossible.");
  }
  flash("success", "Telegram déconnecté.");
}

async function connectYouTubeAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin"]);
  const youtubeEntitlement = await canUseFeature(organizationId, "youtube_accounts", 1);
  if (!youtubeEntitlement.allowed) flash("error", "YouTube n'est pas inclus dans votre offre ou sa limite est atteinte.");
  let url: string;
  try {
    url = createYouTubeConnectUrl(organizationId);
  } catch (error) {
    flash("error", error instanceof Error ? error.message : "Connexion YouTube indisponible.");
  }
  redirect(url);
}

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const { success, error } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  const [accounts, whatsappAccounts, telegram, youtube, whatsappGroupsAccount, dedicatedNumber, dedicatedNumberPriceFcfa] = await Promise.all([
    getZernioAccounts(organizationId).catch(() => []),
    getZernioWhatsAppAccounts(organizationId).catch(() => []),
    getTelegramChannelStatus(organizationId).catch(() => ({ connected: false, botUsername: null })),
    getYouTubeConnection(organizationId).catch(() => ({ connected: false, metadata: {} as { channelId?: string; title?: string; username?: string }, credentialReference: null })),
    getZernioWhatsAppGroupsAccount(organizationId).catch(() => null),
    getOrganizationDedicatedNumberStatus(organizationId).catch(() => ({ pendingRequestId: null, assignedNumber: null })),
    getDedicatedNumberMonthlyPriceFcfa().catch(() => null),
  ]);
  const whatsappEntitlement = await canUseFeature(organizationId, "whatsapp", 1).catch(() => ({ allowed: false, limit: 0, used: whatsappAccounts.length, remaining: 0 }));
  const byPlatform = new Map(accounts.filter((a) => a.platform !== "youtube" && a.platform !== "whatsapp").map((a) => [a.platform, a]));
  const totalConnected = byPlatform.size + whatsappAccounts.length + (youtube.connected ? 1 : 0) + (telegram.connected ? 1 : 0);

  return (
    <div className="space-y-7">
      <header className="relative overflow-hidden rounded-3xl bg-navy-900 p-6 text-white shadow-[0_20px_60px_-35px_rgba(14,17,48,.75)] sm:p-8">
        <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-violet-500/25 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="adm-eyebrow text-violet-300">Canaux</p><h1 className="mt-2 font-jakarta text-2xl font-extrabold tracking-tight sm:text-3xl">Tout connecter, sans complexité.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">Connectez vos canaux depuis CRESYVA. Les détails techniques restent derrière l&apos;interface.</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">{totalConnected} canal{totalConnected > 1 ? "s" : ""} connecté{totalConnected > 1 ? "s" : ""}</div>
        </div>
      </header>

      {success ? <div className="adm-alert-success">{success}</div> : null}
      {error ? <div className="adm-alert-danger break-words">{error}</div> : null}

      <section className="adm-card border-violet-100 bg-violet-50/60">
        <p className="adm-eyebrow">Comment ça marche ?</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[["01", "Choisissez", "Le canal à connecter."], ["02", "Autorisez", "Le service affiche son propre parcours sécurisé."], ["03", "Travaillez", "Ensuite depuis CRESYVA, sans configuration technique." ]].map(([n,t,d]) => <div key={n} className="rounded-2xl bg-white p-4 shadow-sm"><span className="text-xs font-extrabold text-violet-600">{n}</span><p className="mt-2 text-sm font-bold">{t}</p><p className="mt-1 text-xs leading-5 text-slate-500">{d}</p></div>)}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
        <div className="adm-card overflow-hidden p-0">
          <div className="border-b border-navy-900/[0.06] p-5 sm:p-6"><div className="flex items-center justify-between gap-4"><div><p className="adm-eyebrow">Messagerie</p><h2 className="mt-1 adm-heading-2 text-lg">WhatsApp Business</h2></div><span className={whatsappAccounts.length ? "adm-badge-success" : "adm-badge-neutral"}>{whatsappAccounts.length ? `${whatsappAccounts.length} numéro${whatsappAccounts.length > 1 ? "s" : ""}` : "Non connecté"}</span></div><p className="mt-2 max-w-xl text-sm text-slate-500">Chaque numéro de messagerie WhatsApp utilise son propre profil Cloud API/Zernio. Pour un numéro déjà utilisé dans WhatsApp Business, CRESYVA utilise la <strong>coexistence</strong> : vous gardez l&apos;application sur le téléphone et les conversations remontent aussi dans CRESYVA.</p></div>
          <div className="space-y-3 p-5 sm:p-6">{whatsappAccounts.length ? whatsappAccounts.map((account, index) => <div key={account.accountId} className="flex items-center justify-between gap-4 rounded-2xl bg-[#F8FAFC] p-4"><div className="min-w-0"><p className="text-sm font-semibold">{account.phoneNumber || account.username || `Numéro WhatsApp ${index + 1}`}</p><p className="mt-1 text-xs text-slate-500">{account.isPrimary ? "Numéro principal" : `Numéro ${index + 1}`} · {account.status === "connected" ? "Connecté" : "Connexion à vérifier"}</p></div><span className={account.status === "connected" ? "adm-badge-success" : "adm-badge-neutral"}>{account.status === "connected" ? "Actif" : "À vérifier"}</span></div>) : <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">Aucun numéro WhatsApp de messagerie n&apos;est encore connecté.</div>}</div>
          <div className="border-t border-navy-900/[0.06] p-5 sm:p-6"><form action={connectWhatsAppAction}><input type="hidden" name="organizationId" value={organizationId}/><SubmitButton pendingLabel="Ouverture…" disabled={!whatsappEntitlement.allowed} className="adm-btn-primary w-full sm:w-auto">{whatsappAccounts.length ? "Ajouter un numéro WhatsApp" : "Connecter mon WhatsApp"}</SubmitButton></form><p className="mt-2 text-xs text-slate-500">{whatsappEntitlement.limit === -1 ? "Numéros selon les capacités de votre offre." : `${whatsappAccounts.length}/${whatsappEntitlement.limit} numéro${whatsappEntitlement.limit > 1 ? "s" : ""} utilisé${whatsappEntitlement.limit > 1 ? "s" : ""}.`}</p></div>
        </div>
        <div className="adm-card bg-gradient-to-br from-violet-50 via-white to-indigo-50"><p className="adm-eyebrow">Messagerie</p><h2 className="mt-1 adm-heading-2 text-lg">Une boîte pour vendre</h2><div className="mt-5 space-y-3">{[['●','WhatsApp','Demandes et suivi clients'],['◎','Instagram','Conversations sociales'],['◈','Facebook','Messenger et commentaires'],['✦','Assistant','Réponse automatique puis transfert humain']].map(([i,t,d])=><div key={t} className="flex items-center gap-3 rounded-2xl bg-white/80 p-3 shadow-sm"><span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-100 text-violet-700">{i}</span><div><p className="text-sm font-semibold">{t}</p><p className="text-xs text-slate-500">{d}</p></div></div>)}</div><a href="/dashboard/conversations" className="mt-5 inline-flex text-sm font-semibold text-violet-700 hover:underline">Ouvrir la boîte de réception →</a></div>
      </section>

      <section className="adm-card overflow-hidden p-0">
        <div className="border-b border-navy-900/[0.06] p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4"><div><p className="adm-eyebrow">Groupes</p><h2 className="mt-1 adm-heading-2 text-lg">WhatsApp Groupes</h2></div><span className={whatsappGroupsAccount ? "adm-badge-success" : "adm-badge-neutral"}>{whatsappGroupsAccount ? "Connecté" : "Non connecté"}</span></div>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Diffuser dans des groupes WhatsApp demande un <strong>second numéro, différent de celui de votre messagerie</strong> ci-dessus. Ce second numéro est connecté en <strong>Cloud API uniquement</strong> avec Meta/Zernio : ne choisissez pas « Connecter un compte WhatsApp Business existant » pour ce numéro, car le mode coexistence ne permet pas l&apos;API Groupes. Le numéro dédié ne sert qu&apos;aux Groupes.
          </p>
        </div>

        {whatsappGroupsAccount ? (
          <div className="p-5 sm:p-6">
            <p className="text-sm text-slate-600">Numéro dédié connecté{whatsappGroupsAccount.username ? ` : ${whatsappGroupsAccount.username}` : ""}.</p>
            <a href="/dashboard/groups" className="mt-3 inline-flex text-sm font-semibold text-violet-700 hover:underline">Gérer mes Groupes WhatsApp →</a>
          </div>
        ) : (
          <div className="grid gap-0 sm:grid-cols-2">
            <div className="border-t border-navy-900/[0.06] p-5 sm:border-r sm:p-6">
              <p className="text-sm font-semibold">J&apos;ai déjà un numéro à dédier</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Gratuit — utilisez une carte SIM ou un numéro que vous n&apos;utilisez pas déjà sur l&apos;app WhatsApp.</p>
              <form action={connectWhatsAppGroupsAction} className="mt-4"><input type="hidden" name="organizationId" value={organizationId}/><SubmitButton pendingLabel="Ouverture…" className="adm-btn-primary w-full sm:w-auto">Connecter mon numéro dédié</SubmitButton></form>
            </div>
            <div className="border-t border-navy-900/[0.06] p-5 sm:p-6">
              <p className="text-sm font-semibold">Je veux que CRESYVA m&apos;en fournisse un</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Abonnement mensuel{dedicatedNumberPriceFcfa ? ` de ${dedicatedNumberPriceFcfa.toLocaleString("fr-FR")} FCFA` : ""}, séparé de votre forfait. Le numéro est repris si l&apos;abonnement n&apos;est pas renouvelé.</p>
              {dedicatedNumber.assignedNumber ? (
                <div className="mt-4 rounded-2xl bg-[#F7F6FD] p-4">
                  <p className="text-sm font-semibold">{dedicatedNumber.assignedNumber.phoneE164}</p>
                  <p className="mt-1 text-xs text-slate-500">{dedicatedNumber.assignedNumber.currentPeriodEnd ? `Échéance : ${new Date(dedicatedNumber.assignedNumber.currentPeriodEnd).toLocaleDateString("fr-FR")}` : "Échéance non définie."}</p>
                  <form action={payDedicatedNumberAction} className="mt-3"><input type="hidden" name="organizationId" value={organizationId}/><input type="hidden" name="phoneNumberId" value={dedicatedNumber.assignedNumber.id}/><SubmitButton pendingLabel="Ouverture…" className="w-full rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500">Payer / renouveler</SubmitButton></form>
                  <p className="mt-3 text-xs text-slate-500">Une fois payé, connectez ce numéro avec le bouton &laquo;&nbsp;Connecter mon numéro dédié&nbsp;&raquo; ci-contre.</p>
                </div>
              ) : dedicatedNumber.pendingRequestId ? (
                <p className="mt-4 text-sm text-violet-700">Demande envoyée — en attente de traitement par l&apos;équipe CRESYVA.</p>
              ) : (
                <form action={requestDedicatedNumberAction} className="mt-4"><input type="hidden" name="organizationId" value={organizationId}/><SubmitButton pendingLabel="Envoi…" className="w-full rounded-xl border border-navy-900/10 bg-white px-4 py-2 text-sm font-semibold text-navy-900 hover:border-violet-300 hover:bg-violet-50 sm:w-auto">Demander un numéro à CRESYVA</SubmitButton></form>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="adm-card">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="adm-eyebrow">Réseaux sociaux</p><h2 className="mt-1 adm-heading-2 text-lg">Votre présence sociale</h2><p className="mt-1 text-sm text-slate-500">Les comptes gérés ici apparaissent dans vos publications et analytics.</p></div><a href="/dashboard/analytics" className="text-sm font-semibold text-violet-700 hover:underline">Voir les analytics →</a></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {SOCIAL_CHANNELS.map((channel) => { const account = byPlatform.get(channel.id); const brand = SOCIAL_BRAND[channel.id]; const Icon = brand.Icon; return <div key={channel.id} className="group flex min-h-[150px] flex-col rounded-2xl border border-navy-900/[0.07] bg-white p-4 transition hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-lg"><div className="flex items-start justify-between"><span className={`grid h-11 w-11 place-items-center rounded-2xl text-white ${brand.badgeClassName}`}><Icon className="h-5 w-5" /></span>{account ? <span className="adm-badge-success">Connecté</span> : <span className="adm-badge-neutral">Disponible</span>}</div><div className="mt-4"><p className="font-semibold">{channel.label}</p><p className="mt-1 text-xs leading-5 text-slate-500">{account?.username ? `@${account.username}` : channel.description}</p></div><form action={connectSocialAction} className="mt-auto pt-4"><input type="hidden" name="organizationId" value={organizationId}/><input type="hidden" name="platform" value={channel.id}/><SubmitButton pendingLabel="Connexion…" className="w-full rounded-xl border border-navy-900/10 bg-white px-3 py-2 text-xs font-semibold text-navy-900 transition hover:border-violet-300 hover:bg-violet-50">{account ? "Reconnecter" : "Connecter"}</SubmitButton></form></div>; })}

          <div className="group flex min-h-[150px] flex-col rounded-2xl border border-red-100 bg-gradient-to-br from-red-50 via-white to-white p-4 transition hover:-translate-y-0.5 hover:shadow-lg"><div className="flex items-start justify-between"><span className={`grid h-11 w-11 place-items-center rounded-2xl text-white ${SOCIAL_BRAND.youtube.badgeClassName}`}><SOCIAL_BRAND.youtube.Icon className="h-5 w-5" /></span>{youtube.connected ? <span className="adm-badge-success">Connecté</span> : <span className="adm-badge-neutral">Connexion directe</span>}</div><div className="mt-4"><p className="font-semibold">YouTube</p><p className="mt-1 text-xs leading-5 text-slate-500">{youtube.connected ? youtube.metadata.title ?? "Chaîne connectée" : "Connexion Google native, indépendante des autres canaux."}</p></div><form action={connectYouTubeAction} className="mt-auto pt-4"><input type="hidden" name="organizationId" value={organizationId}/><SubmitButton pendingLabel="Ouverture…" className="w-full rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-navy-900 hover:bg-red-50">{youtube.connected ? "Reconnecter YouTube" : "Connecter YouTube"}</SubmitButton></form></div>
        </div>
      </section>

      <section className="adm-card overflow-hidden">
        <div className="grid gap-6 lg:grid-cols-[1fr_.8fr]">
          <div><p className="adm-eyebrow">Telegram</p><h2 className="mt-1 adm-heading-2 text-lg">Votre bot, directement.</h2><p className="mt-2 text-sm leading-6 text-slate-500">Telegram fonctionne ici sans intermédiaire : créez votre bot avec BotFather, copiez son jeton puis collez-le ci-dessous. CRESYVA configure automatiquement le webhook.</p><div className="mt-5 grid gap-3 sm:grid-cols-3">{[["01","Créer le bot","Ouvrez @BotFather puis /newbot."],["02","Copier le jeton","Copiez le token fourni par Telegram."],["03","Connecter","Collez-le ici et testez le bot."]].map(([n,t,d])=><div key={n} className="rounded-2xl bg-[#F8FAFC] p-4"><span className="text-xs font-bold text-violet-600">{n}</span><p className="mt-2 text-sm font-semibold">{t}</p><p className="mt-1 text-xs leading-5 text-slate-500">{d}</p></div>)}</div></div>
          <div className="rounded-2xl bg-navy-900 p-5 text-white"><p className="text-xs font-bold uppercase tracking-wider text-violet-300">Configuration</p>{telegram.connected ? <><p className="mt-2 text-sm text-white/70">Bot connecté : <strong className="text-white">@{telegram.botUsername}</strong></p><form action={disconnectTelegramAction} className="mt-5"><input type="hidden" name="organizationId" value={organizationId}/><SubmitButton pendingLabel="Déconnexion…" className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white hover:bg-white/15">Déconnecter</SubmitButton></form></> : <form action={connectTelegramAction} className="mt-4 space-y-3"><input type="hidden" name="organizationId" value={organizationId}/><label className="block text-xs font-semibold text-white/70">Jeton du bot</label><input name="botToken" type="password" autoComplete="off" placeholder="123456:ABC…" required className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white placeholder:text-white/30 outline-none"/><SubmitButton pendingLabel="Vérification…" className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-500">Connecter mon bot</SubmitButton><a className="block text-center text-xs text-white/45 hover:text-white" href="https://t.me/BotFather" target="_blank" rel="noreferrer">Ouvrir BotFather →</a></form>}</div>
        </div>
      </section>
    </div>
  );
}