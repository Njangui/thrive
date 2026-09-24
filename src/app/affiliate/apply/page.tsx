import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";
import { getCurrentAffiliate } from "@/application/services/affiliate-auth-service";
import { applyForAffiliate } from "@/application/services/affiliate-service";
import { AppError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";

const STATUS_LABELS: Record<string, string> = {
  pending: "En cours d'examen",
  active: "Actif",
  rejected: "Refusée",
  suspended: "Suspendu",
};

async function applyAction(formData: FormData) {
  "use server";
  try {
    await applyForAffiliate({
      displayName: String(formData.get("displayName") ?? ""),
      contactEmail: String(formData.get("contactEmail") ?? ""),
      phone: String(formData.get("phone") ?? "") || undefined,
      promotionChannels: String(formData.get("promotionChannels") ?? "") || undefined,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'envoi de la candidature.";
    redirect(`/affiliate/apply?error=${encodeURIComponent(message)}`);
  }
  redirect("/affiliate/apply?success=1");
}

export default async function AffiliateApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;

  const sessionClient = await getSupabaseServerSessionClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    redirect("/login?next=/affiliate/apply");
  }

  const affiliate = await getCurrentAffiliate();

  if (affiliate) {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="font-display text-2xl font-bold">Votre candidature</h1>
        <div className="mt-4 rounded-brand border border-ink/10 bg-white p-6">
          <p className="text-sm text-muted">Statut actuel</p>
          <p className="mt-1 text-lg font-medium">{STATUS_LABELS[affiliate.status] ?? affiliate.status}</p>

          {affiliate.status === "active" && (
            <Link
              href="/affiliate/dashboard"
              className="mt-4 inline-block rounded-brand bg-leaf px-4 py-2 text-sm font-medium text-white"
            >
              Accéder à mon tableau de bord
            </Link>
          )}
          {affiliate.status === "pending" && (
            <p className="mt-2 text-sm text-muted">Nous examinons votre candidature — vous recevrez une réponse rapidement.</p>
          )}
          {affiliate.status === "rejected" && (
            <p className="mt-2 text-sm text-clay">Votre candidature n&apos;a pas été retenue.</p>
          )}
          {affiliate.status === "suspended" && (
            <p className="mt-2 text-sm text-clay">Votre compte affilié est actuellement suspendu.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="font-display text-2xl font-bold">Devenir affilié tokoo </h1>
      <p className="mt-1 text-sm text-muted">
        Recommandez tokoo  et touchez une commission sur chaque nouveau client que vous apportez.
      </p>

      {success && (
        <p className="mt-4 rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">
          Candidature envoyée ! Nous revenons vers vous rapidement.
        </p>
      )}
      {error && <p className="mt-4 rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>}

      <form action={applyAction} className="mt-6 flex flex-col gap-4 rounded-brand border border-ink/10 bg-white p-6">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-muted" htmlFor="displayName">
            Nom affiché
          </label>
          <input id="displayName" name="displayName" required className="w-full rounded-brand border border-ink/15 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-muted" htmlFor="contactEmail">
            Email de contact
          </label>
          <input
            id="contactEmail"
            name="contactEmail"
            type="email"
            required
            defaultValue={user.email ?? ""}
            className="w-full rounded-brand border border-ink/15 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-muted" htmlFor="phone">
            Téléphone (optionnel)
          </label>
          <input id="phone" name="phone" className="w-full rounded-brand border border-ink/15 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-muted" htmlFor="promotionChannels">
            Comment comptez-vous promouvoir tokoo  ?
          </label>
          <textarea
            id="promotionChannels"
            name="promotionChannels"
            rows={3}
            placeholder="ex : Instagram, YouTube, bouche-à-oreille auprès d'autres commerçants..."
            className="w-full rounded-brand border border-ink/15 px-3 py-2 text-sm"
          />
        </div>
        <SubmitButton pendingLabel="Envoi...">Envoyer ma candidature</SubmitButton>
      </form>
    </div>
  );
}
