import { getSupabaseServiceClient } from "./server-client";
import { OrganizationSuspendedError } from "@/lib/errors";

/**
 * Garde « entreprise suspendue » (décision Q3 : tout bloquer). Posée aux points de passage de TOUS les envois
 * et appels IA (registre des providers) et dans `requireMembership` pour le tableau de bord : une
 * entreprise suspendue ne génère plus aucun coût (IA, messages WhatsApp/Telegram, publications).
 *
 * Lecture avec un cache de 5 s par entreprise : un enchaînement d'envois ne refait pas une requête à chaque
 * message, et une suspension prend effet en quelques secondes. Échec de lecture → on laisse passer (la
 * disponibilité du service ne dépend pas de cette garde) mais on le journalise.
 */
const TTL_MS = 5_000;
const cache = new Map<string, { suspended: boolean; at: number }>();

export function clearOrganizationGuardCache(): void {
  cache.clear();
}

export async function isOrganizationSuspended(organizationId: string): Promise<boolean> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.suspended;

  const { data, error } = await getSupabaseServiceClient().from("organizations").select("status").eq("id", organizationId).maybeSingle();
  if (error) {
    console.error(`isOrganizationSuspended(${organizationId}) lecture impossible:`, error.message);
    return false;
  }
  const suspended = data?.status === "suspended";
  cache.set(organizationId, { suspended, at: Date.now() });
  return suspended;
}

export async function assertOrganizationActive(organizationId: string): Promise<void> {
  if (!organizationId) return; // appels globaux (ex. alertes plateforme) : pas d'entreprise
  if (await isOrganizationSuspended(organizationId)) throw new OrganizationSuspendedError();
}
