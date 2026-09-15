import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { getAffiliateProgramSettings, updateAffiliateProgramSettings } from "@/application/services/affiliate-admin-service";
import { AppError } from "@/lib/errors";
import { AdminCard, AdminSectionHeader } from "../../_components/ui";
import { AffiliatesSubNav } from "../_components/sub-nav";
import { SubmitButton } from "@/app/_components/submit-button";

async function updateSettingsAction(formData: FormData) {
  "use server";
  const admin = await requirePlatformAdmin();
  try {
    await updateAffiliateProgramSettings(
      {
        commissionRateBps: Number(formData.get("commissionRateBps")),
        recurringMonths: Number(formData.get("recurringMonths")),
        cookieWindowDays: Number(formData.get("cookieWindowDays")),
        holdPeriodDays: Number(formData.get("holdPeriodDays")),
        minPayoutFcfa: Number(formData.get("minPayoutFcfa")),
      },
      admin.userId,
    );
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'enregistrement.";
    redirect(`/admin/affiliates/settings?error=${encodeURIComponent(message)}`);
  }
  redirect("/admin/affiliates/settings?success=" + encodeURIComponent("Réglages enregistrés."));
}

export default async function AdminAffiliateSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  await requirePlatformAdmin();
  const { success, error } = await searchParams;
  const settings = await getAffiliateProgramSettings();

  return (
    <div className="flex flex-col gap-5">
      <AdminSectionHeader title="Affiliation" description="Réglages globaux du programme (taux fixe, sans palier)." />
      <AffiliatesSubNav active="settings" />

      {success && <AdminCard className="border-success-200 bg-success-50 text-sm text-success-700">{success}</AdminCard>}
      {error && <AdminCard className="border-danger-200 bg-danger-50 text-sm text-danger-700">{error}</AdminCard>}

      <AdminCard>
        <form action={updateSettingsAction} className="flex flex-col gap-4 max-w-md">
          <div>
            <label className="adm-label" htmlFor="commissionRateBps">
              Taux de commission (points de base — 2000 = 20%)
            </label>
            <input
              id="commissionRateBps"
              name="commissionRateBps"
              type="number"
              min={0}
              max={10000}
              defaultValue={settings.commissionRateBps}
              className="adm-input mt-1"
            />
          </div>
          <div>
            <label className="adm-label" htmlFor="recurringMonths">
              Renouvellements commissionnés après le 1er paiement (0 = aucun, -1 = à vie)
            </label>
            <input
              id="recurringMonths"
              name="recurringMonths"
              type="number"
              min={-1}
              defaultValue={settings.recurringMonths}
              className="adm-input mt-1"
            />
          </div>
          <div>
            <label className="adm-label" htmlFor="cookieWindowDays">
              Fenêtre d&apos;attribution du cookie (jours)
            </label>
            <input
              id="cookieWindowDays"
              name="cookieWindowDays"
              type="number"
              min={1}
              defaultValue={settings.cookieWindowDays}
              className="adm-input mt-1"
            />
          </div>
          <div>
            <label className="adm-label" htmlFor="holdPeriodDays">
              Période de rétention avant paiement (jours)
            </label>
            <input
              id="holdPeriodDays"
              name="holdPeriodDays"
              type="number"
              min={0}
              defaultValue={settings.holdPeriodDays}
              className="adm-input mt-1"
            />
          </div>
          <div>
            <label className="adm-label" htmlFor="minPayoutFcfa">
              Seuil minimum de demande de paiement (FCFA)
            </label>
            <input
              id="minPayoutFcfa"
              name="minPayoutFcfa"
              type="number"
              min={0}
              defaultValue={settings.minPayoutFcfa}
              className="adm-input mt-1"
            />
          </div>
          <SubmitButton pendingLabel="Enregistrement..." className="adm-btn-primary w-fit">
            Enregistrer
          </SubmitButton>
        </form>
      </AdminCard>
    </div>
  );
}
