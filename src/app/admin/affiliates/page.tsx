import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { listAffiliates, approveAffiliate, rejectAffiliate } from "@/application/services/affiliate-admin-service";
import type { AffiliateStatus } from "@/domain/entities/affiliate";
import { AppError } from "@/lib/errors";
import { AdminCard, AdminSectionHeader, AdminBadge, AdminTableCard, AdminEmptyState } from "../_components/ui";
import { AffiliatesSubNav } from "./_components/sub-nav";

const STATUS_BADGE: Record<AffiliateStatus, { tone: "success" | "warning" | "danger" | "neutral"; label: string }> = {
  pending: { tone: "warning", label: "En attente" },
  active: { tone: "success", label: "Actif" },
  rejected: { tone: "danger", label: "Refusé" },
  suspended: { tone: "neutral", label: "Suspendu" },
};

async function approveAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const affiliateId = String(formData.get("affiliateId") ?? "");
  try {
    await approveAffiliate(affiliateId, admin.userId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'approbation.";
    redirect(`/admin/affiliates?error=${encodeURIComponent(message)}`);
  }
  redirect("/admin/affiliates?success=" + encodeURIComponent("Affilié approuvé."));
}

async function rejectAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const affiliateId = String(formData.get("affiliateId") ?? "");
  const reason = String(formData.get("reason") ?? "Non conforme au programme");
  try {
    await rejectAffiliate(affiliateId, admin.userId, reason);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors du refus.";
    redirect(`/admin/affiliates?error=${encodeURIComponent(message)}`);
  }
  redirect("/admin/affiliates?success=" + encodeURIComponent("Candidature refusée."));
}

export default async function AdminAffiliatesPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string; status?: AffiliateStatus }>;
}) {
  await requirePlatformAdmin();
  const { success, error, status } = await searchParams;
  const affiliates = await listAffiliates(status ? { status } : undefined);

  return (
    <div className="flex flex-col gap-5">
      <AdminSectionHeader title="Affiliation" description="Candidatures, affiliés actifs et performance du programme." />
      <AffiliatesSubNav active="affiliates" />

      {success && <AdminCard className="border-success-200 bg-success-50 text-sm text-success-700">{success}</AdminCard>}
      {error && <AdminCard className="border-danger-200 bg-danger-50 text-sm text-danger-700">{error}</AdminCard>}

      <div className="flex gap-2 text-sm">
        {(["pending", "active", "suspended", "rejected"] as AffiliateStatus[]).map((s) => (
          <Link
            key={s}
            href={`/admin/affiliates?status=${s}`}
            className={`adm-badge ${status === s ? "adm-badge-violet" : "adm-badge-neutral"}`}
          >
            {STATUS_BADGE[s].label}
          </Link>
        ))}
        <Link href="/admin/affiliates" className="adm-badge adm-badge-neutral">
          Tous
        </Link>
      </div>

      <AdminTableCard title={`${affiliates.length} affilié(s)`}>
        {affiliates.length === 0 ? (
          <AdminEmptyState>Aucun affilié pour ce filtre.</AdminEmptyState>
        ) : (
          <table className="adm-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Email</th>
                <th>Statut</th>
                <th>Candidature</th>
                <th>Conversions</th>
                <th>Solde dispo.</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {affiliates.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/admin/affiliates/${a.id}`} className="font-medium text-violet-600 hover:underline">
                      {a.displayName}
                    </Link>
                  </td>
                  <td>{a.contactEmail}</td>
                  <td>
                    <AdminBadge tone={STATUS_BADGE[a.status].tone}>{STATUS_BADGE[a.status].label}</AdminBadge>
                  </td>
                  <td>{new Date(a.appliedAt).toLocaleDateString("fr-FR")}</td>
                  <td>{a.totalConversions}</td>
                  <td>{a.availableBalanceFcfa} FCFA</td>
                  <td className="text-right">
                    {a.status === "pending" && (
                      <div className="flex justify-end gap-2">
                        <form action={approveAction}>
                          <input type="hidden" name="affiliateId" value={a.id} />
                          <button type="submit" className="text-xs font-medium text-success-600 hover:underline">
                            Approuver
                          </button>
                        </form>
                        <form action={rejectAction}>
                          <input type="hidden" name="affiliateId" value={a.id} />
                          <button type="submit" className="text-xs font-medium text-danger-600 hover:underline">
                            Refuser
                          </button>
                        </form>
                      </div>
                    )}
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
