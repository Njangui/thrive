import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCurrentOrganization, requireMembership, getCurrentUserEmail } from "@/application/services/auth-service";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { SubmitButton } from "@/app/_components/submit-button";
import { getZernioAccounts, getZernioConnectUrl, getZernioWhatsAppConnectUrl, getZernioWhatsAppAccounts, getZernioWhatsAppGroupsConnectUrl, getZernioWhatsAppGroupsAccount } from "@/application/services/zernio-channel-service";
import { connectTelegramChannel, getTelegramChannelStatus, disconnectTelegramBot, resyncTelegramBotWebhook } from "@/application/services/telegram-channel-service";
import { createYouTubeConnectUrl, disconnectYouTubeAccount, getYouTubeConnection, listYouTubeAccounts } from "@/application/services/youtube-channel-service";
import { listOrganizationSocialAccounts, syncSocialAccountsFromZernio } from "@/application/services/social-account-registry-service";
import { addTelegramDestination, listTelegramDestinations, removeTelegramDestination } from "@/application/services/telegram-destination-service";
import { MultiAccountSections, type Quota, type SocialPlatformSection } from "./multi-account-sections";
import {
  requestDedicatedNumber,
  getOrganizationDedicatedNumberStatus,
  getDedicatedNumberMonthlyPriceFcfa,
  initiateDedicatedNumberPayment,
} from "@/application/services/phone-number-rental-service";
import { AppError } from "@/lib/errors";
import { canUseFeature } from "@/application/services/entitlements-service";

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
  const reconnectAccountId = String(formData.get("reconnectAccountId") ?? "") || undefined;
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  // Lot O : plafond cumulatif vérifié dans getZernioConnectUrl (une reconnexion ne consomme pas de quota).
  const supabase = getSupabaseServiceClient();
  const { data: organization } = await supabase.from("organizations").select("name").eq("id", membership.organizationId).single();
  let url: string;
  try {
    url = await getZernioConnectUrl(organizationId, organization?.name ?? "Entreprise tokoo ", platform as never, reconnectAccountId ? { reconnectAccountId } : undefined);
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
    url = await getZernioWhatsAppConnectUrl(organizationId, organization?.name ?? "Entreprise tokoo ");
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
    url = await getZernioWhatsAppGroupsConnectUrl(organizationId, organization?.name ?? "Entreprise tokoo ");
  } catch (error) {
    flash("error", error instanceof Error ? error.message : "Connexion du numéro dédié impossible.");
  }
  redirect(url);
}

/** Chemin payant — le commerçant demande à tokoo  de lui fournir un numéro dédié (traité ensuite depuis /admin/numbers). */
async function requestDedicatedNumberAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  try {
    await requestDedicatedNumber(organizationId, membership.userId);
  } catch (error) {
    flash("error", error instanceof AppError ? error.message : "Impossible d'envoyer la demande.");
  }
  flash("success", "Demande envoyée — l'équipe tokoo  va vous assigner un numéro sous peu.");
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
    if (!result.paymentUrl) throw new Error("URL de paiement manquante dans la réponse du prestataire de paiement.");
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
  const botId = String(formData.get("botId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  try {
    await disconnectTelegramBot(organizationId, membership.userId, botId);
  } catch (error) {
    flash("error", error instanceof Error ? error.message : "Déconnexion Telegram impossible.");
  }
  flash("success", "Bot Telegram déconnecté.");
}

async function resyncTelegramAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const botId = String(formData.get("botId") ?? "");
  await requireMembership(organizationId, ["owner", "admin"]);
  try {
    await resyncTelegramBotWebhook(organizationId, botId);
  } catch (error) {
    flash("error", error instanceof Error ? error.message : "Actualisation du bot impossible.");
  }
  flash("success", "Bot actualisé : les canaux et groupes où il est ajouté seront enregistrés automatiquement.");
}

async function addTelegramDestinationAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin"]);
  let title: string | null = null;
  try {
    const result = await addTelegramDestination(organizationId, String(formData.get("botId") ?? ""), String(formData.get("chatRef") ?? ""));
    title = result.title;
  } catch (error) {
    flash("error", error instanceof AppError ? error.message : error instanceof Error ? error.message : "Enregistrement impossible.");
  }
  flash("success", `Destination Telegram enregistrée${title ? ` : ${title}` : ""}.`);
}

async function removeTelegramDestinationAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin"]);
  try {
    await removeTelegramDestination(organizationId, String(formData.get("destinationId") ?? ""));
  } catch (error) {
    flash("error", error instanceof AppError ? error.message : "Suppression impossible.");
  }
  flash("success", "Destination Telegram retirée.");
}

async function disconnectYouTubeAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin"]);
  try {
    await disconnectYouTubeAccount(organizationId, String(formData.get("accountId") ?? ""));
  } catch (error) {
    flash("error", error instanceof AppError ? error.message : "Déconnexion YouTube impossible.");
  }
  flash("success", "Chaîne YouTube déconnectée.");
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

const SOCIAL_SECTIONS = [
  { platform: "facebook", label: "Facebook", quotaKey: "facebook_pages" },
  { platform: "instagram", label: "Instagram", quotaKey: "instagram_accounts" },
  { platform: "linkedin", label: "LinkedIn", quotaKey: "linkedin_pages" },
  { platform: "tiktok", label: "TikTok", quotaKey: "tiktok_accounts" },
] as const;

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const { success, error } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  const [accounts, whatsappAccounts, telegram, youtube, whatsappGroupsAccount, dedicatedNumber, dedicatedNumberPriceFcfa] = await Promise.all([
    getZernioAccounts(organizationId).catch(() => []),
    getZernioWhatsAppAccounts(organizationId).catch(() => []),
    getTelegramChannelStatus(organizationId).catch(() => ({ connected: false, botUsername: null, bots: [] })),
    getYouTubeConnection(organizationId).catch(() => ({ connected: false, metadata: {} as { channelId?: string; title?: string; username?: string }, credentialReference: null })),
    getZernioWhatsAppGroupsAccount(organizationId).catch(() => null),
    getOrganizationDedicatedNumberStatus(organizationId).catch(() => ({ pendingRequestId: null, assignedNumber: null })),
    getDedicatedNumberMonthlyPriceFcfa().catch(() => null),
  ]);
  const whatsappEntitlement = await canUseFeature(organizationId, "whatsapp", 1).catch(() => ({ allowed: false, limit: 0, used: whatsappAccounts.length, remaining: 0 }));
  // Lot O — multi-comptes : registre réaligné sur Zernio, chaînes YouTube, bots et destinations Telegram, jauges du plan.
  const quotaOf = async (key: string): Promise<Quota> => {
    const result = await canUseFeature(organizationId, key, 0).catch(() => ({ used: 0, limit: 0 }));
    return { used: result.used, limit: result.limit };
  };
  const [socialAccounts, youtubeAccounts, telegramDestinations, botQuota, channelQuota, groupQuota, youtubeQuota, ...socialQuotas] = await Promise.all([
    syncSocialAccountsFromZernio(organizationId).catch(() => listOrganizationSocialAccounts(organizationId).catch(() => [])),
    listYouTubeAccounts(organizationId).catch(() => []),
    listTelegramDestinations(organizationId).catch(() => []),
    quotaOf("telegram_bots"),
    quotaOf("telegram_channels"),
    quotaOf("telegram_groups"),
    quotaOf("youtube_accounts"),
    ...SOCIAL_SECTIONS.map((section) => quotaOf(section.quotaKey)),
  ]);
  const socialSections: SocialPlatformSection[] = SOCIAL_SECTIONS.map((section, index) => ({
    platform: section.platform,
    label: section.label,
    quota: socialQuotas[index]!,
    accounts: socialAccounts.filter((account) => account.platform === section.platform).map((account) => ({ accountId: account.accountId, username: account.username })),
  }));
  const totalConnected = socialAccounts.length + whatsappAccounts.length + youtubeAccounts.length + telegram.bots.length;
  void accounts;
  void youtube;

  return (
    <div className="space-y-7">
      <header className="relative overflow-hidden rounded-3xl bg-navy-900 p-6 text-white shadow-[0_20px_60px_-35px_rgba(14,17,48,.75)] sm:p-8">
        <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-violet-500/25 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="adm-eyebrow text-violet-300">Canaux</p><h1 className="mt-2 font-jakarta text-2xl font-extrabold tracking-tight sm:text-3xl">Tout connecter, sans complexité.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">Connectez vos canaux depuis tokoo . Les détails techniques restent derrière l&apos;interface.</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">{totalConnected} canal{totalConnected > 1 ? "s" : ""} connecté{totalConnected > 1 ? "s" : ""}</div>
        </div>
      </header>

      {success ? <div className="adm-alert-success">{success}</div> : null}
      {error ? <div className="adm-alert-danger break-words">{error}</div> : null}

      <section className="adm-card border-violet-100 bg-violet-50/60">
        <p className="adm-eyebrow">Comment ça marche ?</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[["01", "Choisissez", "Le canal à connecter."], ["02", "Autorisez", "Le service affiche son propre parcours sécurisé."], ["03", "Travaillez", "Ensuite depuis tokoo , sans configuration technique." ]].map(([n,t,d]) => <div key={n} className="rounded-2xl bg-white p-4 shadow-xs"><span className="text-xs font-extrabold text-violet-600">{n}</span><p className="mt-2 text-sm font-bold">{t}</p><p className="mt-1 text-xs leading-5 text-slate-500">{d}</p></div>)}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
        <div className="adm-card overflow-hidden p-0">
          <div className="border-b border-navy-900/[0.06] p-5 sm:p-6"><div className="flex items-center justify-between gap-4"><div><p className="adm-eyebrow">Messagerie</p><h2 className="mt-1 adm-heading-2 text-lg">WhatsApp Business</h2></div><span className={whatsappAccounts.length ? "adm-badge-success" : "adm-badge-neutral"}>{whatsappAccounts.length ? `${whatsappAccounts.length} numéro${whatsappAccounts.length > 1 ? "s" : ""}` : "Non connecté"}</span></div><p className="mt-2 max-w-xl text-sm text-slate-500">Chaque numéro de messagerie WhatsApp utilise son propre profil Cloud API/Zernio. Pour un numéro déjà utilisé dans WhatsApp Business, tokoo  utilise la <strong>coexistence</strong> : vous gardez l&apos;application sur le téléphone et les conversations remontent aussi dans tokoo .</p></div>
          <div className="space-y-3 p-5 sm:p-6">{whatsappAccounts.length ? whatsappAccounts.map((account, index) => <div key={account.accountId} className="flex items-center justify-between gap-4 rounded-2xl bg-[#F8FAFC] p-4"><div className="min-w-0"><p className="text-sm font-semibold">{account.phoneNumber || account.username || `Numéro WhatsApp ${index + 1}`}</p><p className="mt-1 text-xs text-slate-500">{account.isPrimary ? "Numéro principal" : `Numéro ${index + 1}`} · {account.status === "connected" ? "Connecté" : "Connexion à vérifier"}</p></div><span className={account.status === "connected" ? "adm-badge-success" : "adm-badge-neutral"}>{account.status === "connected" ? "Actif" : "À vérifier"}</span></div>) : <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">Aucun numéro WhatsApp de messagerie n&apos;est encore connecté.</div>}</div>
          <div className="border-t border-navy-900/[0.06] p-5 sm:p-6"><form action={connectWhatsAppAction}><input type="hidden" name="organizationId" value={organizationId}/><SubmitButton pendingLabel="Ouverture…" disabled={!whatsappEntitlement.allowed} className="adm-btn-primary w-full sm:w-auto">{whatsappAccounts.length ? "Ajouter un numéro WhatsApp" : "Connecter mon WhatsApp"}</SubmitButton></form><p className="mt-2 text-xs text-slate-500">{whatsappEntitlement.limit === -1 ? "Numéros selon les capacités de votre offre." : `${whatsappAccounts.length}/${whatsappEntitlement.limit} numéro${whatsappEntitlement.limit > 1 ? "s" : ""} utilisé${whatsappEntitlement.limit > 1 ? "s" : ""}.`}</p></div>
        </div>
        <div className="adm-card bg-gradient-to-br from-violet-50 via-white to-indigo-50"><p className="adm-eyebrow">Messagerie</p><h2 className="mt-1 adm-heading-2 text-lg">Une boîte pour vendre</h2><div className="mt-5 space-y-3">{[['●','WhatsApp','Demandes et suivi clients'],['◎','Instagram','Conversations sociales'],['◈','Facebook','Messenger et commentaires'],['✦','Assistant','Réponse automatique puis transfert humain']].map(([i,t,d])=><div key={t} className="flex items-center gap-3 rounded-2xl bg-white/80 p-3 shadow-xs"><span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-100 text-violet-700">{i}</span><div><p className="text-sm font-semibold">{t}</p><p className="text-xs text-slate-500">{d}</p></div></div>)}</div><Link href="/dashboard/conversations" className="mt-5 inline-flex text-sm font-semibold text-violet-700 hover:underline">Ouvrir la boîte de réception →</Link></div>
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
              <p className="text-sm font-semibold">Je veux que tokoo  m&apos;en fournisse un</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Abonnement mensuel{dedicatedNumberPriceFcfa ? ` de ${dedicatedNumberPriceFcfa.toLocaleString("fr-FR")} FCFA` : ""}, séparé de votre forfait. Le numéro est repris si l&apos;abonnement n&apos;est pas renouvelé.</p>
              {dedicatedNumber.assignedNumber ? (
                <div className="mt-4 rounded-2xl bg-[#F7F6FD] p-4">
                  <p className="text-sm font-semibold">{dedicatedNumber.assignedNumber.phoneE164}</p>
                  <p className="mt-1 text-xs text-slate-500">{dedicatedNumber.assignedNumber.currentPeriodEnd ? `Échéance : ${new Date(dedicatedNumber.assignedNumber.currentPeriodEnd).toLocaleDateString("fr-FR")}` : "Échéance non définie."}</p>
                  <form action={payDedicatedNumberAction} className="mt-3"><input type="hidden" name="organizationId" value={organizationId}/><input type="hidden" name="phoneNumberId" value={dedicatedNumber.assignedNumber.id}/><SubmitButton pendingLabel="Ouverture…" className="w-full rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500">Payer / renouveler</SubmitButton></form>
                  <p className="mt-3 text-xs text-slate-500">Une fois payé, connectez ce numéro avec le bouton &laquo;&nbsp;Connecter mon numéro dédié&nbsp;&raquo; ci-contre.</p>
                </div>
              ) : dedicatedNumber.pendingRequestId ? (
                <p className="mt-4 text-sm text-violet-700">Demande envoyée — en attente de traitement par l&apos;équipe tokoo .</p>
              ) : (
                <form action={requestDedicatedNumberAction} className="mt-4"><input type="hidden" name="organizationId" value={organizationId}/><SubmitButton pendingLabel="Envoi…" className="w-full rounded-xl border border-navy-900/10 bg-white px-4 py-2 text-sm font-semibold text-navy-900 hover:border-violet-300 hover:bg-violet-50 sm:w-auto">Demander un numéro à tokoo </SubmitButton></form>
              )}
            </div>
          </div>
        )}
      </section>

      <MultiAccountSections
        organizationId={organizationId}
        social={socialSections}
        youtube={{ accounts: youtubeAccounts, quota: youtubeQuota }}
        telegram={{ bots: telegram.bots, destinations: telegramDestinations, botQuota, channelQuota, groupQuota }}
        actions={{
          connectSocial: connectSocialAction,
          connectYouTube: connectYouTubeAction,
          disconnectYouTube: disconnectYouTubeAction,
          connectTelegram: connectTelegramAction,
          disconnectTelegram: disconnectTelegramAction,
          resyncTelegram: resyncTelegramAction,
          addTelegramDestination: addTelegramDestinationAction,
          removeTelegramDestination: removeTelegramDestinationAction,
        }}
      />
    </div>
  );
}