/**
 * Pont C1 → C5 : fournit le `UsagePort` du Studio (débit « media ») avec le vrai registre
 * d'usage (P3) à la place de `jobLedgerUsagePort` (inscription provisoire sur `media_jobs`).
 * Le Studio ne traite comme refus qu'une EXCEPTION : un solde insuffisant doit donc lever.
 */
import type { UsageService } from "@/application/agents/contracts";
import type { UsagePort } from "@/domain/ports/usage-port";

export function createLedgerUsagePort(usage: UsageService): UsagePort {
  return {
    async charge(input) {
      const result = await usage.charge(input);
      if (result.status === "insufficient") throw new Error("Solde insuffisant");
      return { charged: result.status === "charged", alreadyCharged: result.status === "duplicate" };
    },
  };
}
