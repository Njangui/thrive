import { SubmitButton } from "@/app/_components/submit-button";
import type { TelegramBotSummary } from "@/application/services/telegram-channel-service";
import type { TelegramDestination } from "@/application/services/telegram-destination-service";
import type { YouTubeAccountSummary } from "@/application/services/youtube-channel-service";

/**
 * Lot O — sections « Réseaux sociaux », « YouTube » et « Telegram » de la
 * page Canaux, réécrites pour le MULTI-COMPTES : chaque section liste TOUS
 * les comptes connectés, affiche la jauge « utilisés / limite » du plan et
 * permet d'en ajouter (ou d'en retirer) jusqu'à la limite.
 */
export interface Quota {
  used: number;
  limit: number; // -1 = illimité, 0 = non inclus
}

export interface SocialPlatformSection {
  platform: string;
  label: string;
  accounts: { accountId: string; username: string | null }[];
  quota: Quota;
}

type Action = (formData: FormData) => Promise<void>;

export interface MultiAccountSectionsProps {
  organizationId: string;
  social: SocialPlatformSection[];
  youtube: { accounts: YouTubeAccountSummary[]; quota: Quota };
  telegram: { bots: TelegramBotSummary[]; destinations: TelegramDestination[]; botQuota: Quota; channelQuota: Quota; groupQuota: Quota };
  actions: {
    connectSocial: Action;
    connectYouTube: Action;
    disconnectYouTube: Action;
    connectTelegram: Action;
    disconnectTelegram: Action;
    resyncTelegram: Action;
    addTelegramDestination: Action;
    removeTelegramDestination: Action;
  };
}

function formatQuota(quota: Quota): string {
  return `${quota.used} / ${quota.limit === -1 ? "∞" : quota.limit}`;
}

function isFull(quota: Quota): boolean {
  return quota.limit !== -1 && quota.used >= quota.limit;
}

function QuotaBadge({ quota }: { quota: Quota }) {
  if (quota.limit === 0) return <span className="adm-badge-neutral">Non inclus</span>;
  return <span className={isFull(quota) ? "adm-badge-neutral" : "adm-badge-success"}>{formatQuota(quota)}</span>;
}

const inputClass = "w-full rounded-xl border border-navy-900/10 bg-white px-3 py-2 text-sm";
const secondaryButton = "rounded-xl border border-navy-900/10 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";

export function MultiAccountSections({ organizationId, social, youtube, telegram, actions }: MultiAccountSectionsProps) {
  const org = <input type="hidden" name="organizationId" value={organizationId} />;
  const channels = telegram.destinations.filter((d) => d.kind === "channel");
  const groups = telegram.destinations.filter((d) => d.kind === "group");

  return (
    <>
      <section className="adm-card">
        <p className="adm-eyebrow">Réseaux sociaux</p>
        <h2 className="mt-1 adm-heading-2 text-lg">Vos comptes et pages</h2>
        <p className="mt-1 text-sm text-slate-500">Connectez plusieurs comptes par réseau, dans la limite de votre offre. Chaque compte peut publier et recevoir commentaires et messages.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {social.map((section) => (
            <div key={section.platform} className="flex flex-col gap-3 rounded-2xl border border-navy-900/10 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{section.label}</p>
                <QuotaBadge quota={section.quota} />
              </div>
              {section.accounts.length > 0 ? (
                <ul className="space-y-2">
                  {section.accounts.map((account) => (
                    <li key={account.accountId} className="flex items-center justify-between gap-2 rounded-xl bg-[#F8FAFC] px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">{account.username ? `@${account.username.replace(/^@/, "")}` : "Compte connecté"}</span>
                      <form action={actions.connectSocial}>
                        {org}
                        <input type="hidden" name="platform" value={section.platform} />
                        <input type="hidden" name="reconnectAccountId" value={account.accountId} />
                        <SubmitButton pendingLabel="Ouverture…" className="text-xs font-medium text-violet-700 hover:underline disabled:opacity-60">Reconnecter</SubmitButton>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">{section.quota.limit === 0 ? "Ce réseau n'est pas inclus dans votre offre." : "Aucun compte connecté."}</p>
              )}
              <form action={actions.connectSocial}>
                {org}
                <input type="hidden" name="platform" value={section.platform} />
                <SubmitButton pendingLabel="Ouverture…" disabled={isFull(section.quota)} className={`${secondaryButton} w-full`}>
                  {section.accounts.length > 0 ? "Connecter un autre compte" : `Connecter ${section.label}`}
                </SubmitButton>
              </form>
              {isFull(section.quota) && section.quota.limit > 0 ? <p className="text-[11px] text-slate-500">Limite atteinte — passez à l&apos;offre supérieure pour en connecter davantage.</p> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="adm-card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="adm-eyebrow">YouTube</p>
            <h2 className="mt-1 adm-heading-2 text-lg">Vos chaînes YouTube</h2>
          </div>
          <QuotaBadge quota={youtube.quota} />
        </div>
        {youtube.accounts.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {youtube.accounts.map((account) => (
              <li key={account.id} className="flex items-center justify-between gap-3 rounded-xl bg-[#F8FAFC] px-3 py-2 text-sm">
                <span className="min-w-0 truncate font-medium">{account.title ?? account.username ?? account.channelId}</span>
                <form action={actions.disconnectYouTube}>
                  {org}
                  <input type="hidden" name="accountId" value={account.id} />
                  <SubmitButton pendingLabel="…" className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60">Déconnecter</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-500">Aucune chaîne connectée.</p>
        )}
        <form action={actions.connectYouTube} className="mt-4">
          {org}
          <SubmitButton pendingLabel="Ouverture…" disabled={isFull(youtube.quota)} className="adm-btn-primary disabled:opacity-60">
            {youtube.accounts.length > 0 ? "Ajouter une autre chaîne" : "Connecter YouTube"}
          </SubmitButton>
        </form>
      </section>

      <section className="adm-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="adm-eyebrow">Telegram</p>
            <h2 className="mt-1 adm-heading-2 text-lg">Vos bots, canaux et groupes</h2>
            <p className="mt-1 text-sm text-slate-500">
              Créez un bot avec @BotFather, collez son jeton, puis ajoutez le bot comme <strong>administrateur</strong> de votre canal (ou membre de votre groupe) : il sera enregistré automatiquement.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="text-slate-500">Bots</span><QuotaBadge quota={telegram.botQuota} />
            <span className="text-slate-500">Canaux</span><QuotaBadge quota={telegram.channelQuota} />
            <span className="text-slate-500">Groupes</span><QuotaBadge quota={telegram.groupQuota} />
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Bots connectés</h3>
            {telegram.bots.length > 0 ? (
              <ul className="space-y-2">
                {telegram.bots.map((bot) => (
                  <li key={bot.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#F8FAFC] px-3 py-2 text-sm">
                    <span className="min-w-0 truncate font-medium">@{bot.botUsername}{bot.isPrimary ? " · principal" : ""}</span>
                    <span className="flex items-center gap-3">
                      <form action={actions.resyncTelegram}>
                        {org}
                        <input type="hidden" name="botId" value={bot.id} />
                        <SubmitButton pendingLabel="…" className="text-xs font-medium text-violet-700 hover:underline disabled:opacity-60">Actualiser</SubmitButton>
                      </form>
                      <form action={actions.disconnectTelegram}>
                        {org}
                        <input type="hidden" name="botId" value={bot.id} />
                        <SubmitButton pendingLabel="…" className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60">Déconnecter</SubmitButton>
                      </form>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Aucun bot connecté.</p>
            )}
            <form action={actions.connectTelegram} className="flex flex-col gap-2">
              {org}
              <input name="botToken" type="password" autoComplete="off" required placeholder="Jeton du bot (BotFather)" className={inputClass} disabled={isFull(telegram.botQuota)} />
              <SubmitButton pendingLabel="Connexion…" disabled={isFull(telegram.botQuota)} className="adm-btn-primary disabled:opacity-60">
                {telegram.bots.length > 0 ? "Ajouter un autre bot" : "Connecter mon bot"}
              </SubmitButton>
            </form>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Canaux et groupes enregistrés</h3>
            {telegram.destinations.length > 0 ? (
              <ul className="space-y-2">
                {[...channels, ...groups].map((destination) => (
                  <li key={destination.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#F8FAFC] px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{destination.title ?? destination.username ?? destination.chatId}</span>
                      <span className="block text-[11px] text-slate-500">
                        {destination.kind === "channel" ? "Canal" : "Groupe"} · @{destination.botUsername ?? "bot"}
                        {destination.status !== "active" ? ` · ${destination.status === "disabled" ? "désactivé" : "erreur"}` : ""}
                      </span>
                    </span>
                    <form action={actions.removeTelegramDestination}>
                      {org}
                      <input type="hidden" name="destinationId" value={destination.id} />
                      <SubmitButton pendingLabel="…" className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60">Retirer</SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Aucun canal ni groupe enregistré.</p>
            )}
            {telegram.bots.length > 0 ? (
              <form action={actions.addTelegramDestination} className="flex flex-col gap-2">
                {org}
                <select name="botId" className={inputClass} defaultValue={telegram.bots[0]!.id}>
                  {telegram.bots.map((bot) => (
                    <option key={bot.id} value={bot.id}>Bot @{bot.botUsername}</option>
                  ))}
                </select>
                <input name="chatRef" required placeholder="@moncanal, lien t.me ou identifiant -100…" className={inputClass} />
                <SubmitButton pendingLabel="Vérification…" className={secondaryButton}>Enregistrer ce canal / groupe</SubmitButton>
              </form>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}
