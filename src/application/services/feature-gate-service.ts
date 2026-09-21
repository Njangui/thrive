import { QuotaExceededError } from "@/lib/errors";
import { GATED_FEATURES, PLAN_LABELS, type GatedFeatureKey } from "@/application/config/feature-gates";
import { hasFeature } from "./entitlements-service";

/**
 * Lot O — garde serveur des fonctionnalités verrouillées par plan.
 * Utilisée par les pages (rendu d'un `UpgradeNotice` au lieu du contenu)
 * ET par les services/actions qui écrivent (jamais seulement l'UI : un
 * appel direct à l'action serveur d'un compte Discover doit échouer).
 */
export async function isGatedFeatureEnabled(organizationId: string, feature: GatedFeatureKey): Promise<boolean> {
  return hasFeature(organizationId, GATED_FEATURES[feature].entitlementKey);
}

export function buildUpgradeMessage(feature: GatedFeatureKey): string {
  const gate = GATED_FEATURES[feature];
  return `${gate.label} : disponible à partir de l'offre ${PLAN_LABELS[gate.minPlan]}.`;
}

/** Lève `QuotaExceededError` (message affichable tel quel) si la fonctionnalité n'est pas incluse. */
export async function assertGatedFeature(organizationId: string, feature: GatedFeatureKey): Promise<void> {
  if (!(await isGatedFeatureEnabled(organizationId, feature))) {
    throw new QuotaExceededError(buildUpgradeMessage(feature));
  }
}
