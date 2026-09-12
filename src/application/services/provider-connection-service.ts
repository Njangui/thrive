import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { notifyOrgAdmins } from "./notification-service";

/**
 * Lot 3 (audit master prompt §32/§44) — reflète un changement de statut
 * de compte Zernio (`account.connected`/`account.disconnected`) dans
 * `provider_connections`. Met à jour TOUTES les lignes de cette
 * organisation pour ce compte (un compte Zernio peut être à la fois
 * `provider_type='messaging'` et `'social'` — voir
 * secrets-resolver.ts::resolveCredential) : les deux doivent refléter le
 * même statut, l'événement Zernio ne précise pas laquelle des deux
 * utilisations est concernée.
 *
 * `status: 'error'` (pas 'disconnected') pour une déconnexion détectée
 * côté fournisseur — distingue "jamais connecté" (disconnected, valeur
 * par défaut) de "était connecté, ne l'est plus" (error), cohérent avec
 * la contrainte déjà en place (0005_providers_and_ai.sql).
 */
export async function handleAccountStatusChanged(
  organizationId: string,
  accountId: string,
  status: "connected" | "error",
): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { error } = await supabase
    .from("provider_connections")
    .update({ status })
    .eq("organization_id", organizationId)
    .eq("provider_name", "zernio")
    .eq("metadata->>accountId", accountId);

  if (error) {
    throw new Error(`handleAccountStatusChanged(${accountId}): échec mise à jour provider_connections: ${error.message}`);
  }

  if (status === "error") {
    // Correspond littéralement à "connexion canal perdue" (section 32).
    await notifyOrgAdmins({
      organizationId,
      title: "Connexion perdue.",
      body: "Votre connexion WhatsApp/réseaux sociaux a été déconnectée côté fournisseur. Reconnectez-la depuis Paramètres pour continuer à recevoir vos messages.",
      relatedEntityType: "provider_connection",
      relatedEntityId: accountId,
    });
  }
}
