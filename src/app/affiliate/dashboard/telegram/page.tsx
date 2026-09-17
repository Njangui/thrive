import { redirect } from "next/navigation";
import { requireAffiliate } from "@/application/services/affiliate-auth-service";
import { createAffiliateTelegramLinkToken, getAffiliateTelegramLinkStatus } from "@/application/services/affiliate-service";
import { AppError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";

async function generateLinkAction() {
  "use server";
  const affiliate = await requireAffiliate();
  try {
    const { deepLink } = await createAffiliateTelegramLinkToken(affiliate.id);
    redirect(`/affiliate/dashboard/telegram?deepLink=${encodeURIComponent(deepLink)}`);
  } catch (error) {
    if (error instanceof AppError) {
      redirect(`/affiliate/dashboard/telegram?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
}

export default async function AffiliateTelegramPage({
  searchParams,
}: {
  searchParams: Promise<{ deepLink?: string; error?: string }>;
}) {
  const { deepLink, error } = await searchParams;

  let affiliate;
  try {
    affiliate = await requireAffiliate();
  } catch (err) {
    if (err instanceof AppError) redirect("/affiliate/apply");
    throw err;
  }

  const status = await getAffiliateTelegramLinkStatus(affiliate.id);

  return (
    <div className="mx-auto max-w-xl flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Telegram</h1>
        <p className="mt-1 text-sm text-muted">
          Recevez vos notifications de commission en temps réel et consultez vos statistiques via le bot Telegram
          CRESYVA — indépendant de tout canal client, réservé aux affiliés.
        </p>
      </div>

      {error && <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>}

      <div className="rounded-brand border border-ink/10 bg-white p-6">
        {status.linked ? (
          <p className="text-sm">
            ✅ Connecté en tant que <span className="font-medium">@{status.username}</span>.
          </p>
        ) : deepLink ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Ouvrez ce lien puis appuyez sur &laquo; Démarrer &raquo; dans Telegram pour connecter votre compte (valable 15 minutes) :
            </p>
            <a href={deepLink} target="_blank" rel="noreferrer" className="w-fit rounded-brand bg-leaf px-4 py-2 text-sm font-medium text-white">
              Ouvrir Telegram
            </a>
          </div>
        ) : (
          <form action={generateLinkAction}>
            <SubmitButton pendingLabel="Génération..." className="rounded-brand bg-leaf px-4 py-2 text-sm font-medium text-white">
              Connecter Telegram
            </SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
