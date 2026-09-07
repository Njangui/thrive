import { redirect } from "next/navigation";
import { getCurrentUserOrganizations } from "@/application/services/auth-service";
import { getOnboardingStatus } from "@/application/services/onboarding-service";
import { OnboardingWizard } from "./onboarding-wizard";

/**
 * Lot I, Partie 2 : corrige la limite connue documentée dans
 * RAPPORT_LOT_E.md ("un utilisateur qui quitte le wizard après l'étape 1
 * sans terminer les étapes 2-6 était redirigé directement au dashboard
 * sans pouvoir reprendre"). Comportement désormais :
 *  - aucune organisation -> wizard depuis l'étape 1 (création), inchangé ;
 *  - organisation existante + onboarding déjà terminé -> dashboard,
 *    inchangé (c'est toujours un flow "première fois") ;
 *  - organisation existante + onboarding NON terminé -> wizard, repris à
 *    la dernière étape persistée (jamais à l'étape 1 : l'organisation
 *    existe déjà, la réafficher créerait un doublon si le formulaire de
 *    l'étape 1 était resoumis).
 */
export default async function OnboardingPage() {
  const orgs = await getCurrentUserOrganizations();
  const org = orgs[0];

  if (!org) {
    return (
      <main className="min-h-screen bg-paper px-5">
        <OnboardingWizard />
      </main>
    );
  }

  const status = await getOnboardingStatus(org.organizationId);
  if (status.completedAt) redirect("/dashboard");

  // Borné à [2, 6] : jamais l'étape 1 (l'organisation existe déjà — la
  // resoumettre créerait un doublon), jamais au-delà de la dernière étape
  // définie par le wizard.
  const resumeStep = Math.min(Math.max(status.step, 2), 6);

  return (
    <main className="min-h-screen bg-paper px-5">
      <OnboardingWizard initialStep={resumeStep} initialOrganizationId={org.organizationId} />
    </main>
  );
}
