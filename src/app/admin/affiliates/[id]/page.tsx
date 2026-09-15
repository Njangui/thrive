import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { getAffiliateDetail, suspendAffiliate, reactivateAffiliate } from "@/application/services/affiliate-admin-service";
import { AppError, NotFoundError } from "@/lib/errors";
import { AdminCard, AdminSectionHeader, AdminBadge } from "../../_components/ui";

async function suspendAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const affiliateId = String(formData.get("affiliateId") ?? "");
  const reason = String(formData.get("reason") ?? "") || undefined;
  try {
    await suspendAffiliate(affiliateId, admin.userId, reason);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la suspension.";
    redirect(`/admin/affiliates/${affiliateId}?error=${encodeURIComponent(message)}`);
  }
  redirect(`/admin/affiliates/${affiliateId}?success=` + encodeURIComponent("Affilié suspendu."));
}

async function reactivateAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  const affiliateId = String(formData.get("affiliateId") ?? "");
  try {
    await reactivateAffiliate(affiliateId, admin.userId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la réactivation.";
    redirect(`/admin/affiliates/${affiliateId}?error=${encodeURIComponent(message)}`);
  }
  redirect(`/admin/affiliates/${affiliateId}?success=` + encodeURIComponent("Affilié réactivé."));
}

export default async function AdminAffiliateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  await requirePlatformAdmin();
  const { id } = await params;
  const { success, error } = await searchParams;

  let detail;
  try {
    detail = await getAffiliateDetail(id);
  } catch (err) {
    if (err instanceof NotFoundError) {
      redirect("/admin/affiliates?error=" + encodeURIComponent("Affilié introuvable."));
    }
    throw err;
  }

  return (
    <div className="flex flex-col gap-5">
      <AdminSectionHeader title={detail.displayName} description={detail.contactEmail} />

      {success && <AdminCard className="border-success-200 bg-success-50 text-sm text-success-700">{success}</AdminCard>}
      {error && <AdminCard className="border-danger-200 bg-danger-50 text-sm text-danger-700">{error}</AdminCard>}

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminCard>
          <p className="adm-label">Statut</p>
          <p className="mt-1"><AdminBadge tone={detail.status === "active" ? "success" : "neutral"}>{detail.status}</AdminBadge></p>
        </AdminCard>
        <AdminCard>
          <p className="adm-label">Solde disponible</p>
          <p className="adm-value mt-1">{detail.availableBalanceFcfa} FCFA</p>
        </AdminCard>
        <AdminCard>
          <p className="adm-label">Téléphone</p>
          <p className="mt-1">{detail.phone ?? "—"}</p>
        </AdminCard>
        <AdminCard>
          <p className="adm-label">Conversions totales</p>
          <p className="adm-value mt-1">{detail.totalConversions}</p>
        </AdminCard>
      </div>

      {detail.promotionChannels && (
        <AdminCard>
          <p className="adm-label">Canaux de promotion déclarés</p>
          <p className="mt-1 text-sm">{detail.promotionChannels}</p>
        </AdminCard>
      )}

      <AdminCard>
        <p className="adm-label">Méthode de paiement</p>
        <pre className="mt-1 whitespace-pre-wrap text-xs">{JSON.stringify(detail.payoutMethod, null, 2)}</pre>
      </AdminCard>

      <div className="flex gap-3">
        {detail.status === "active" && (
          <form action={suspendAction} className="flex items-center gap-2">
            <input type="hidden" name="affiliateId" value={detail.id} />
            <input name="reason" placeholder="Raison (optionnel)" className="adm-input" />
            <button type="submit" className="adm-btn-danger">
              Suspendre
            </button>
          </form>
        )}
        {detail.status === "suspended" && (
          <form action={reactivateAction}>
            <input type="hidden" name="affiliateId" value={detail.id} />
            <button type="submit" className="adm-btn-primary">
              Réactiver
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
