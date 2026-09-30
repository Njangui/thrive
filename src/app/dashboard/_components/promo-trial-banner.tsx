import Link from "next/link";
import { getOrganizationRealPlanKey } from "@/application/services/plans-repository";
import { daysLeft, effectiveEnd, getActivePromo } from "@/application/services/promo-trial-service";

/**
 * Bandeau « Essai Pro offert » — affiché à toutes les entreprises non-Pro
 * tant que l'essai est en cours. Rien pour les abonnés Pro payants (rien
 * ne change pour eux) ni une fois l'essai terminé.
 */
export async function PromoTrialBanner({ organizationId }: { organizationId: string }) {
  const promo = await getActivePromo();
  if (!promo) return null;
  if ((await getOrganizationRealPlanKey(organizationId)) === "pro") return null;

  const left = daysLeft(promo);
  const end = effectiveEnd(promo).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Douala" });

  return (
    <div role="status" className="border-b border-violet-600/20 bg-violet-50 px-4 py-2.5 text-sm text-violet-900 sm:px-6">
      <span className="font-semibold">Essai Pro offert</span> — toutes les fonctionnalités Pro sont débloquées jusqu&apos;au {end}
      {left > 0 ? ` (${left} jour${left > 1 ? "s" : ""} restant${left > 1 ? "s" : ""})` : ""}. Ensuite, votre compte revient automatiquement à votre offre actuelle.{" "}
      <Link href="/dashboard/subscription" className="font-medium underline underline-offset-2">Voir les forfaits</Link>
    </div>
  );
}
