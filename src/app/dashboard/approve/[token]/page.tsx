import { notFound } from "next/navigation";
import { requireDashboardActor } from "@/application/channels/dashboard-actor";
import { SupabaseStepUpAdapter } from "@/infrastructure/channels/supabase-step-up-adapter";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

const REASONS: Record<string, string> = {
  not_found: "Ce lien est invalide.",
  forbidden: "Ce lien est destiné à un autre compte. Connectez-vous avec le compte concerné.",
  method_not_allowed: "Ce lien ne permet pas de valider cette action.",
  expired: "Ce lien a expiré. Refaites la demande dans la conversation.",
  not_pending: "Cette demande a déjà été traitée ou n'est plus valide.",
};

async function confirm(formData: FormData) {
  "use server";
  const actor = await requireDashboardActor();
  const token = String(formData.get("token") ?? "");
  const result = token.length >= 20 && token.length <= 200 ? await new SupabaseStepUpAdapter().approveWithDashboardLink({ linkToken: token, userId: actor.userId }) : null;
  const { redirect } = await import("next/navigation");
  redirect(`/dashboard/approve/${encodeURIComponent(token)}?r=${result?.ok ? "ok" : (result?.ok === false ? result.reason : "not_found")}`);
}

/**
 * Validation par lien (méthode `dashboard_link`). La page GET n'a AUCUN effet de
 * bord (les aperçus de liens ne valident rien) : la validation exige un clic
 * explicite (Server Action), dans la SESSION du membre concerné.
 */
export default async function ApprovePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ r?: string }> }) {
  const { token } = await params;
  const { r } = await searchParams;
  if (!token || token.length < 20 || token.length > 200) notFound();
  await requireDashboardActor();
  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-lg font-semibold">Valider une action sensible</h1>
      {r === "ok" ? (
        <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-800">✅ Validation enregistrée. Retournez dans la conversation et appuyez sur « Valider » pour exécuter l&apos;action.</p>
      ) : (
        <>
          {r && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{REASONS[r] ?? "Validation impossible."}</p>}
          <p className="text-sm text-slate-600">Confirmez que vous êtes bien à l&apos;origine de la demande en cours dans votre assistant. Cette validation expire rapidement et ne vaut que pour cette action.</p>
          <form action={confirm}><input type="hidden" name="token" value={token} /><button type="submit" className="adm-btn-primary w-full px-4 py-3">Je confirme que c&apos;est moi</button></form>
        </>
      )}
    </div>
  );
}
