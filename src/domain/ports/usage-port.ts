/**
 * UsagePort — débit du registre d'usage.
 *
 * PROVISOIRE : reflète l'esquisse de contrat de C1 (`usage.charge`, idempotent).
 * Quand C1 livre `src/application/agents/contracts.ts`, ce fichier est remplacé par
 * l'import du contrat ; les appelants (studio) ne changent pas.
 */
export type UsageKind = "ai" | "media" | "message" | "channel";

export interface UsageChargeInput {
  tenantId: string;
  actorId: string;
  kind: UsageKind;
  /** Unités neutres. Pour `media` : milli-USD de coût fournisseur (voir 0184). */
  units: number;
  /** Référence d'idempotence : un même `ref` ne peut être débité qu'une fois. */
  ref: string;
}

export interface UsagePort {
  charge(input: UsageChargeInput): Promise<{ charged: boolean; alreadyCharged: boolean }>;
}
