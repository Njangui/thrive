"use server";

import { requireMembership } from "@/application/services/auth-service";
import { checkDomainAvailability, type DomainAvailabilityResult } from "@/application/services/domain-service";
import { AppError } from "@/lib/errors";

/**
 * Server Action appelée directement (pas via <form>) depuis
 * domain-search-field.tsx, même pattern que push-actions.ts (Lot I) :
 * Client Component -> import direct d'une fonction "use server" ->
 * useTransition.
 */

export interface DomainSearchActionResult {
  ok: boolean;
  error?: string;
  results?: DomainAvailabilityResult[];
}

export async function checkDomainAvailabilityAction(
  organizationId: string,
  nameWithoutTld: string,
): Promise<DomainSearchActionResult> {
  try {
    await requireMembership(organizationId, ["owner", "admin"]);
    const results = await checkDomainAvailability(nameWithoutTld);
    return { ok: true, results };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof AppError ? error.message : "Erreur lors de la vérification de disponibilité.",
    };
  }
}
