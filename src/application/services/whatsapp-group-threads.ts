import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

/**
 * Distinction MESSAGERIE WhatsApp / GROUPES WhatsApp — le point de contact entre les deux.
 *
 * Deux produits différents partagent le même canal « whatsapp » et la même boîte Zernio :
 *  - la MESSAGERIE : conversations 1:1 avec des clients (numéros de `whatsapp_accounts`),
 *    réponses automatiques, CRM, diffusions vers des contacts ;
 *  - les GROUPES : diffusion de produits dans des groupes (`whatsapp_groups`, numéro DÉDIÉ,
 *    `provider_type = 'whatsapp_groups'`). Côté Zernio, la conversation d'un groupe a pour
 *    identifiant l'identifiant du groupe lui-même (docs/ZERNIO_INTEGRATION.md).
 *
 * Un fil de groupe ne doit JAMAIS être traité comme un client : ni contact CRM, ni réponse
 * automatique (l'IA répondrait à tout le groupe), ni alerte « message sans réponse », ni
 * destinataire d'une diffusion vers des contacts. Ces fonctions sont le test commun.
 *
 * Volontairement isolé (aucune autre dépendance que le client Supabase) pour rester importable
 * depuis le webhook et les diffusions sans tirer whatsapp-group-service.ts.
 */

/** `true` si `threadId` est l'identifiant d'un groupe WhatsApp (connecté ou non) de cette organisation. */
export async function isWhatsAppGroupThread(organizationId: string, threadId: string): Promise<boolean> {
  if (!organizationId || !threadId) return false;
  try {
    const { data, error } = await getSupabaseServiceClient()
      .from("whatsapp_groups")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("external_id", threadId)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn(`isWhatsAppGroupThread(${organizationId}): lecture whatsapp_groups impossible:`, error.message);
      return false;
    }
    return Boolean(data);
  } catch (err) {
    console.warn(`isWhatsAppGroupThread(${organizationId}): erreur inattendue:`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** Identifiants de tous les groupes WhatsApp de l'organisation (ensemble vide en cas d'erreur de lecture). */
export async function listWhatsAppGroupThreadIds(organizationId: string): Promise<Set<string>> {
  if (!organizationId) return new Set();
  try {
    const { data, error } = await getSupabaseServiceClient().from("whatsapp_groups").select("external_id").eq("organization_id", organizationId);
    if (error) {
      console.warn(`listWhatsAppGroupThreadIds(${organizationId}): lecture whatsapp_groups impossible:`, error.message);
      return new Set();
    }
    return new Set((data ?? []).map((row) => row.external_id as string));
  } catch (err) {
    console.warn(`listWhatsAppGroupThreadIds(${organizationId}): erreur inattendue:`, err instanceof Error ? err.message : String(err));
    return new Set();
  }
}
