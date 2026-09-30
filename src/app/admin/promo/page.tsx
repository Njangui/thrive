import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import {
  daysLeft,
  effectiveEnd,
  getPromoPhase,
  getPromoTrial,
  launchPromoTrial,
  stopPromoTrial,
  PROMO_DURATION_DAYS,
} from "@/application/services/promo-trial-service";
import { AppError } from "@/lib/errors";
import { AdminBadge, AdminCard } from "../_components/ui";

async function launchAction() {
  "use server";
  const admin = await requirePlatformAdmin();
  try {
    await launchPromoTrial(admin.userId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Impossible de lancer l'essai Pro";
    redirect(`/admin/promo?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/dashboard", "layout");
  redirect("/admin/promo?success=" + encodeURIComponent("Essai Pro lancé pour tout le monde."));
}

async function stopAction() {
  "use server";
  const admin = await requirePlatformAdmin();
  try {
    await stopPromoTrial(admin.userId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Impossible d'arrêter l'essai Pro";
    redirect(`/admin/promo?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/dashboard", "layout");
  redirect("/admin/promo?success=" + encodeURIComponent("Essai Pro arrêté : tout le monde est revenu à son plan."));
}

const fmt = (d: Date | string) =>
  new Date(d).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Africa/Douala" });

export default async function AdminPromoPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const { error, success } = await searchParams;
  await requirePlatformAdmin();
  const promo = await getPromoTrial();
  const phase = getPromoPhase(promo);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-jakarta text-2xl font-bold tracking-tight">Essai Pro offert</h1>
        <p className="mt-1 text-sm text-slate-500">
          Donne le forfait Pro à toutes les entreprises pendant {PROMO_DURATION_DAYS} jours, comptes créés pendant la période compris.
          À la date de fin, chaque compte revient automatiquement à son vrai plan : aucune donnée n&apos;est modifiée, les abonnés Pro payants ne
          sont jamais touchés.
        </p>
      </div>

      {error && <p className="rounded-xl border border-danger-600/20 bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</p>}
      {success && <p className="rounded-xl border border-success-600/20 bg-success-50 px-4 py-3 text-sm text-success-700">{success}</p>}

      <AdminCard>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-jakarta text-lg font-semibold">Statut</h2>
          <AdminBadge tone={phase === "active" ? "success" : "neutral"}>
            {phase === "active" ? "En cours" : phase === "ended" ? "Terminé" : phase === "scheduled" ? "Programmé" : "Aucun essai"}
          </AdminBadge>
        </div>

        {promo && (
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-500">Début</dt><dd className="font-medium">{fmt(promo.startsAt)}</dd></div>
            <div><dt className="text-slate-500">Fin (heure de Douala)</dt><dd className="font-medium">{fmt(effectiveEnd(promo))}</dd></div>
            {phase === "active" && <div><dt className="text-slate-500">Jours restants</dt><dd className="font-medium">{daysLeft(promo)}</dd></div>}
            <div><dt className="text-slate-500">Rappel J-3</dt><dd className="font-medium">{promo.reminderSentAt ? `envoyé le ${fmt(promo.reminderSentAt)}` : "pas encore envoyé"}</dd></div>
            <div><dt className="text-slate-500">Message de fin</dt><dd className="font-medium">{promo.endNoticeSentAt ? `envoyé le ${fmt(promo.endNoticeSentAt)}` : "pas encore envoyé"}</dd></div>
            {promo.stoppedAt && <div><dt className="text-slate-500">Arrêté manuellement</dt><dd className="font-medium">{fmt(promo.stoppedAt)}</dd></div>}
          </dl>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          {phase !== "active" ? (
            <form action={launchAction}>
              <button type="submit" className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white">
                Lancer l&apos;essai Pro maintenant ({PROMO_DURATION_DAYS} jours)
              </button>
            </form>
          ) : (
            <form action={stopAction}>
              <button type="submit" className="rounded-xl border border-danger-600/30 bg-white px-4 py-2 text-sm font-medium text-danger-700">
                Arrêter l&apos;essai maintenant
              </button>
            </form>
          )}
        </div>
      </AdminCard>

      <AdminCard>
        <h2 className="font-jakarta text-lg font-semibold">Comment ça marche</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>Le plan Pro s&apos;applique à tous les comptes (gratuits, Starter et nouveaux inscrits) jusqu&apos;à la date de fin fixe.</li>
          <li>Notification aux entreprises non-Pro 3 jours avant la fin, puis le jour de la fin (envoyée par le cron « process-subscription-renewals » déjà planifié).</li>
          <li>Les crédits IA du plan Pro sont accordés pendant l&apos;essai et retirés à la fin ; les crédits déjà consommés restent comptés.</li>
          <li>Les données créées pendant l&apos;essai sont conservées ; ce qui dépasse les limites du plan réel n&apos;est plus modifiable jusqu&apos;au passage à un forfait.</li>
        </ul>
      </AdminCard>
    </div>
  );
}
