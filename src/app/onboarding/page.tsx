import { redirect } from "next/navigation";
import { getCurrentUserOrganizations } from "@/application/services/auth-service";
import { OnboardingWizard } from "./onboarding-wizard";

export default async function OnboardingPage() {
  // Si l'utilisateur a déjà une entreprise, pas besoin de repasser par
  // l'onboarding (section 31 : c'est un flow "première fois" uniquement).
  // Limite connue (documentée dans RAPPORT_LOT_E.md) : un utilisateur qui
  // quitte le wizard après l'étape 1 (organisation déjà créée) sans
  // terminer les étapes 2-6 sera redirigé directement au dashboard s'il
  // revient sur /onboarding, sans pouvoir reprendre où il s'était arrêté —
  // acceptable pour un flow "première fois", aucune étape après la 1 n'est
  // requise pour qu'un tenant fonctionne.
  const orgs = await getCurrentUserOrganizations();
  if (orgs.length > 0) redirect("/dashboard");

  return (
    <main className="min-h-screen bg-paper px-5">
      <OnboardingWizard />
    </main>
  );
}
