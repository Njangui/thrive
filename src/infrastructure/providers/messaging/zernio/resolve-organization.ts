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

  // Multi-numéros (migration 0063) : chaque numéro de MESSAGERIE est une ligne de `whatsapp_accounts`.
  // `provider_connections` ne reflète que le PREMIER numéro (voir persistZernioOAuthConnection) : sans
  // cette lecture, tout message reçu sur un 2ᵉ ou 3ᵉ numéro était ignoré (« aucun tenant résolu »).
  const { data: numberRow, error: numberError } = await supabase
    .from("whatsapp_accounts")
    .select("organization_id")
    .eq("account_id", accountId)
    .eq("status", "connected")
    .limit(1)
    .maybeSingle();
  if (numberError) {
    console.error(`resolveOrganizationIdByZernioAccount(${accountId}) whatsapp_accounts error:`, numberError.message);
  } else if (numberRow?.organization_id) {
    return numberRow.organization_id;
  }

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
 * Lot 5 (20/09/2026) — routage tenant pour les events `comment.received`
 * et `post.external.*`, PAR `profileId` — PAS par `account.id`, à la
 * différence de `resolveOrganizationIdByZernioAccount` ci-dessus.
 *
 * VÉRIFIÉ EN LISANT LE CODE (zernio-channel-service.ts) avant d'écrire
 * cette fonction, plutôt que de réutiliser par réflexe le même schéma
 * que le resolver `messaging` : la ligne `provider_connections` d'une
 * organisation pour `provider_type = 'social'` est UNIQUE
 * (`onConflict: "organization_id,provider_type,provider_name"`,
 * `persistZernioOAuthConnection`) et son `metadata.accountId` est
 * RÉÉCRIT à chaque nouvelle connexion (Facebook, puis Instagram, puis
 * LinkedIn...) — un tenant avec plusieurs comptes sociaux connectés n'a
 * donc, à un instant donné, QUE le dernier `accountId` connecté dans
 * cette ligne ; router par `account.id` webhook y résoudrait le mauvais
 * compte silencieusement dès qu'un deuxième compte social est connecté
 * (risque de commentaire attribué au mauvais post, pas juste un event
 * perdu). `metadata.profileId`, lui, est stable : posé une fois par
 * `ensureZernioProfile` et jamais réécrit avec une autre valeur (un seul
 * profil Zernio par organisation pour `provider_type = 'social'`).
 * `profileId` est CONFIRMÉ présent sur le bloc `account` de tout event
 * inbox (docs.zernio.com/webhooks/inbox : "Message payloads carry an
 * `account` block with `accountId` and `profileId`, so one endpoint can
 * serve many profiles") — voir `ZernioInboxWebhookAccount`/
 * `ZernioExternalPostWebhookAccount` (types.ts).
 *
 * Ne retombe JAMAIS sur un lookup par `account.id` en repli : un mauvais
 * match (compte social d'un AUTRE tenant) est pire qu'un event ignoré —
 * si `profileId` est absent du payload, l'appelant doit logger et
 * ignorer plutôt que deviner.
 */
export async function resolveOrganizationIdBySocialProfile(profileId: string): Promise<string | null> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("provider_connections")
    .select("organization_id")
    .eq("provider_type", "social")
    .eq("provider_name", "zernio")
    .eq("status", "connected")
    .eq("metadata->>profileId", profileId)
    .maybeSingle();

  if (error) {
    console.error(`resolveOrganizationIdBySocialProfile(${profileId}) error:`, error.message);
    return null;
  }
  if (data?.organization_id) return data.organization_id;

  // Lot O : profils additionnels (un compte TikTok par profil Zernio).
  const { data: extra, error: extraError } = await supabase
    .from("zernio_social_profiles")
    .select("organization_id")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (extraError) {
    console.error(`resolveOrganizationIdBySocialProfile(${profileId}) extra error:`, extraError.message);
    return null;
  }
  return extra?.organization_id ?? null;
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

/**
 * Numéro DÉDIÉ aux groupes WhatsApp : ligne `provider_connections` de type `whatsapp_groups` (Cloud API,
 * profil Zernio à part — voir zernio-channel-service.ts::ensureZernioGroupsProfile). C'est un compte
 * Zernio DIFFÉRENT de la messagerie : `resolveOrganizationIdByZernioAccount` (type `messaging`) ne le
 * reconnaît volontairement pas. Sans ce résolveur, les événements de ce numéro étaient rejetés
 * (« aucun tenant résolu ») et l'activation d'un groupe — déclenchée par le premier message reçu — n'avait
 * jamais lieu : aucune diffusion vers un groupe ne pouvait partir.
 */
export async function resolveOrganizationIdByWhatsAppGroupsAccount(accountId: string): Promise<string | null> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("provider_connections")
    .select("organization_id")
    .eq("provider_type", "whatsapp_groups")
    .eq("provider_name", "zernio")
    .eq("status", "connected")
    .eq("metadata->>accountId", accountId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`resolveOrganizationIdByWhatsAppGroupsAccount(${accountId}) error:`, error.message);
    return null;
  }

  return data?.organization_id ?? null;
}
