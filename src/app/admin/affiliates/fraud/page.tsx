import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { listFraudFlags, reviewFraudFlag } from "@/application/services/affiliate-admin-service";
import { AppError } from "@/lib/errors";
import { AdminCard, AdminSectionHeader, AdminBadge, AdminTableCard, AdminEmptyState } from "../../_components/ui";
import { AffiliatesSubNav } from "../_components/sub-nav";

const FLAG_TYPE_LABELS: Record<string, string> = {
  self_referral: "Auto-référencement",
  click_velocity: "Vélocité de clics anormale",
  ip_reuse_across_affiliates: "Réutilisation d'IP entre affiliés",
  cookie_tampered: "Cookie altéré",
  duplicate_organization_owner: "Propriétaire déjà référé ailleurs",
};

async function reviewAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const flagId = String(formData.get("flagId") ?? "");
  const outcome = String(formData.get("outcome") ?? "reviewed") as "reviewed" | "dismissed";
  try {
    await reviewFraudFlag(flagId, admin.userId, outcome);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors du traitement.";
    redirect(`/admin/affiliates/fraud?error=${encodeURIComponent(message)}`);
  }
  redirect("/admin/affiliates/fraud");
}

export default async function AdminFraudPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requirePlatformAdmin();
  const { error } = await searchParams;
  const flags = await listFraudFlags("open");

  return (
    <div className="flex flex-col gap-5">
      <AdminSectionHeader title="Affiliation" description="Signalements anti-fraude en attente de revue." />
      <AffiliatesSubNav active="fraud" />

      {error && <AdminCard className="border-danger-200 bg-danger-50 text-sm text-danger-700">{error}</AdminCard>}

      <AdminTableCard title={`${flags.length} signalement(s) ouvert(s)`}>
        {flags.length === 0 ? (
          <AdminEmptyState>Aucun signalement en attente — tout est clair.</AdminEmptyState>
        ) : (
          <table className="adm-table">
            <thead>
              <tr>
                <th>Affilié</th>
                <th>Type</th>
                <th>Sévérité</th>
                <th>Détails</th>
                <th>Date</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.id}>
                  <td>{f.affiliateDisplayName ?? "—"}</td>
                  <td>{FLAG_TYPE_LABELS[f.flagType] ?? f.flagType}</td>
                  <td>
                    <AdminBadge tone={f.severity === "high" ? "danger" : f.severity === "medium" ? "warning" : "neutral"}>
                      {f.severity}
                    </AdminBadge>
                  </td>
                  <td className="max-w-xs truncate text-xs text-ink/60">{JSON.stringify(f.details)}</td>
                  <td>{new Date(f.createdAt).toLocaleDateString("fr-FR")}</td>
                  <td className="text-right">
                    <div className="flex justify-end gap-2">
                      <form action={reviewAction}>
                        <input type="hidden" name="flagId" value={f.id} />
                        <input type="hidden" name="outcome" value="dismissed" />
                        <button type="submit" className="text-xs font-medium text-ink/60 hover:underline">
                          Ignorer
                        </button>
                      </form>
                      <form action={reviewAction}>
                        <input type="hidden" name="flagId" value={f.id} />
                        <input type="hidden" name="outcome" value="reviewed" />
                        <button type="submit" className="text-xs font-medium text-violet-600 hover:underline">
                          Marquer examiné
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </AdminTableCard>
    </div>
  );
}
