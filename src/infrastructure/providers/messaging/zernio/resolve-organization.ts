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

/**
 * Lot 3 (audit master prompt §44) — routage pour "account.connected"/
 * "account.disconnected" spécifiquement. Contrairement au resolver
 * ci-dessus, ne filtre PAS sur `status = 'connected'` : un event
 * "account.disconnected" a, par définition, de bonnes chances d'arriver
 * une fois que status vaut déjà 'error' (webhook rejoué) ou juste avant
 * qu'on l'y fasse passer — le filtrer sur 'connected' le rendrait
 * irrésolvable. Idem pour un "account.connected" de RECONNEXION, qui doit
 * rester routable alors que la ligne est encore en 'error' au moment où
 * l'event arrive. Cherche sur `provider_type` messaging OU social (un
 * compte Zernio peut avoir les deux, voir secrets-resolver.ts) — les deux
 * doivent forcément appartenir à la même organisation (unicité de
 * accountId côté Zernio), donc une seule suffit pour résoudre le tenant.
 */
export async function resolveOrganizationIdByZernioAccountAnyStatus(accountId: string): Promise<string | null> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("provider_connections")
    .select("organization_id")
    .eq("provider_name", "zernio")
    .eq("metadata->>accountId", accountId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`resolveOrganizationIdByZernioAccountAnyStatus(${accountId}) error:`, error.message);
    return null;
  }

  return data?.organization_id ?? null;
}

/**
 * Lot M, Partie 2 — routage tenant pour les webhooks `post.*`.
 *
 * Contrairement aux events inbox, un post peut cibler PLUSIEURS comptes
 * (plateformes) à la fois — `account.id` seul n'est donc pas une clé de
 * routage tenant fiable au niveau racine du payload post, et
 * `getSocialPublishingProvider()` (registry.ts) ne stocke d'ailleurs
 * aujourd'hui aucun `profileId`/`accountId` distinctif pour la connexion
 * `provider_type = 'social'` d'une organisation (contrairement à la
 * connexion `messaging`, qui elle stocke `metadata.profileId` — voir
 * registry.ts). Plutôt que de deviner un champ non confirmé au niveau du
 * webhook (`profileId` ou autre) pour combler ce manque, on route via NOS
 * PROPRES données : `social_posts.provider_post_id`, déjà scopé par
 * organisation et déjà nécessaire de toute façon pour retrouver la ligne
 * à mettre à jour (voir marketing-service.ts::handlePostStatusWebhook).
 * Un `provider_post_id` Zernio est unique par construction (id Mongo-style
 * généré côté Zernio), donc cette clé est fiable même sans passer par
 * account.id/profileId.
 */
export async function resolveOrganizationIdByProviderPostId(providerPostId: string): Promise<string | null> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("social_posts")
    .select("organization_id")
    .eq("provider_post_id", providerPostId)
    .maybeSingle();

  if (error) {
    console.error(`resolveOrganizationIdByProviderPostId(${providerPostId}) error:`, error.message);
    return null;
  }

  return data?.organization_id ?? null;
}
