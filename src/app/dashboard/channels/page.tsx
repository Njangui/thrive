import { redirect } from "next/navigation";
import { requireCurrentOrganization, requireMembership } from "@/application/services/auth-service";
import { connectTelegramChannel, disconnectTelegramChannel, getTelegramChannelStatus } from "@/application/services/telegram-channel-service";
import { AppError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";

/**
 * Canal client Telegram — self-service, INDÉPENDANT de Zernio (WhatsApp).
 * Contrairement à WhatsApp (numéro provisionné par l'équipe SME-OS, voir
 * /admin/numbers), un bot Telegram se crée en quelques secondes via
 * @BotFather : le tenant colle simplement son jeton ici.
 */

function flashRedirect(kind: "success" | "error", message: string): never {
  redirect(`/dashboard/channels?${kind}=${encodeURIComponent(message)}`);
}

async function connectAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  const botToken = String(formData.get("botToken") ?? "");

  try {
    const { botUsername } = await connectTelegramChannel(organizationId, membership.userId, botToken);
    flashRedirect("success", `Bot @${botUsername} connecté avec succès.`);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la connexion.";
    flashRedirect("error", message);
  }
}

async function disconnectAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);

  try {
    await disconnectTelegramChannel(organizationId, membership.userId);
    flashRedirect("success", "Canal Telegram déconnecté.");
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la déconnexion.";
    flashRedirect("error", message);
  }
}

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  const telegramStatus = await getTelegramChannelStatus(organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Canaux</h1>
        <p className="mt-1 text-sm text-muted">Connectez les canaux par lesquels vos clients peuvent vous écrire.</p>
      </div>

      {success && <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">{success}</p>}
      {error && <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>}

      <div className="rounded-brand border border-ink/10 bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold">WhatsApp</h2>
            <p className="text-sm text-muted">Géré par l&apos;équipe SME-OS lors de votre inscription.</p>
          </div>
        </div>
      </div>

      <div className="rounded-brand border border-ink/10 bg-white p-6">
        <h2 className="font-display text-lg font-semibold">Telegram</h2>
        <p className="mt-1 text-sm text-muted">
          Connectez votre propre bot Telegram (créé via{" "}
          <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-leaf hover:underline">
            @BotFather
          </a>
          ) pour que vos clients puissent aussi vous écrire depuis Telegram — indépendant de votre canal WhatsApp.
        </p>

        {telegramStatus.connected ? (
          <div className="mt-4 flex items-center justify-between rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3">
            <p className="text-sm">
              ✅ Connecté : <span className="font-medium">@{telegramStatus.botUsername}</span>
            </p>
            <form action={disconnectAction}>
              <input type="hidden" name="organizationId" value={organizationId} />
              <SubmitButton pendingLabel="..." className="text-xs font-medium text-clay hover:underline" disabled={false}>
                Déconnecter
              </SubmitButton>
            </form>
          </div>
        ) : (
          <form action={connectAction} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="organizationId" value={organizationId} />
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium uppercase text-muted" htmlFor="botToken">
                Jeton du bot
              </label>
              <input
                id="botToken"
                name="botToken"
                required
                placeholder="123456789:AAExempleDeJetonBotFather"
                className="w-full rounded-brand border border-ink/15 px-3 py-2 text-sm font-mono"
              />
            </div>
            <SubmitButton pendingLabel="Connexion..." className="rounded-brand bg-leaf px-4 py-2 text-sm font-medium text-white">
              Connecter
            </SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
