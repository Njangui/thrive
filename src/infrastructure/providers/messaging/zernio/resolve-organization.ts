import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

/**
 * Un webhook Zernio (catégorie inbox) arrive avec un `account.id` (compte
 * WhatsApp/social connecté), jamais un organization_id directement.
 * CONFIRMÉ (docs.zernio.com/multi-tenant, table de routage) : pour les
 * events inbox (`message.received`, ...), la clé de tenant dans le payload
 * est `account.id` — on la mappe vers notre organization_id via
 * `provider_connections.metadata->>'accountId'` (mapping qu'on construit
 * nous-mêmes à la connexion du compte, section 36). Si aucun tenant ne
 * correspond, le webhook est ignoré (log + 200 pour éviter les retries
 * — Zernio retente jusqu'à 7 fois sur 51h, voir docs.zernio.com/webhooks)
 * plutôt que de planter.
 */
export async function resolveOrganizationIdByZernioAccount(accountId: string): Promise<string | null> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("provider_connections")
    .select("organization_id")
    .eq("provider_type", "messaging")
    .eq("provider_name", "zernio")
    .eq("status", "connected")
    .eq("metadata->>accountId", accountId)
    .maybeSingle();

  if (error) {
    console.error(`resolveOrganizationIdByZernioAccount(${accountId}) error:`, error.message);
    return null;
  }

  return data?.organization_id ?? null;
}
