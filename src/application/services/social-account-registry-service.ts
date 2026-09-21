import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { resolveCredential } from "@/infrastructure/providers/secrets-resolver";
import { ZernioSocialClient } from "@/infrastructure/providers/social/zernio/client";
import { ValidationError } from "@/lib/errors";

/**
 * Lot O — registre durable des comptes sociaux Zernio (Facebook, Instagram,
 * LinkedIn, TikTok…) et des comptes YouTube d'une organisation.
 *
 * Avant ce lot, `provider_connections` ne gardait QUE le dernier compte
 * social connecté (ligne unique par organisation, `metadata.accountId`
 * réécrit à chaque connexion). Ce registre porte :
 *  - les quotas cumulés (`facebook_pages`, `instagram_accounts`, …) ;
 *  - le routage des webhooks par compte (`account.id` → organisation) ;
 *  - la validation d'appartenance d'un compte ciblé par une publication
 *    (la clé API Zernio est partagée par toute la plateforme : sans cette
 *    vérification, un tenant pourrait cibler le compte d'un autre) ;
 *  - les réglages de réponse automatique par compte.
 */

export type SocialAccountStatus = "connected" | "disconnected" | "error";

export interface SocialAccountRecord {
  id: string;
  organizationId: string;
  platform: string;
  accountId: string;
  profileId: string;
  username: string | null;
  status: SocialAccountStatus;
  autoReplyComments: boolean;
  autoReplyMessages: boolean;
}

interface SocialAccountRow {
  id: string;
  organization_id: string;
  platform: string;
  account_id: string;
  profile_id: string;
  username: string | null;
  status: SocialAccountStatus;
  auto_reply_comments: boolean;
  auto_reply_messages: boolean;
}

const SELECT_COLUMNS = "id, organization_id, platform, account_id, profile_id, username, status, auto_reply_comments, auto_reply_messages";

function toRecord(row: SocialAccountRow): SocialAccountRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    platform: row.platform,
    accountId: row.account_id,
    profileId: row.profile_id,
    username: row.username,
    status: row.status,
    autoReplyComments: row.auto_reply_comments,
    autoReplyMessages: row.auto_reply_messages,
  };
}

export async function listOrganizationSocialAccounts(
  organizationId: string,
  options: { platform?: string; connectedOnly?: boolean } = {},
): Promise<SocialAccountRecord[]> {
  const supabase = getSupabaseServiceClient();
  let query = supabase.from("social_accounts").select(SELECT_COLUMNS).eq("organization_id", organizationId).order("created_at", { ascending: true });
  if (options.platform) query = query.eq("platform", options.platform);
  if (options.connectedOnly ?? true) query = query.eq("status", "connected");
  const { data, error } = await query;
  if (error) throw new Error(`Lecture des comptes sociaux impossible: ${error.message}`);
  return ((data ?? []) as SocialAccountRow[]).map(toRecord);
}

export async function getSocialAccountByAccountId(accountId: string): Promise<SocialAccountRecord | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("social_accounts").select(SELECT_COLUMNS).eq("account_id", accountId).maybeSingle();
  if (error) {
    console.error(`getSocialAccountByAccountId(${accountId}) error:`, error.message);
    return null;
  }
  return data ? toRecord(data as SocialAccountRow) : null;
}

/** Routage tenant d'un webhook inbox par `account.id` — jamais de repli par devinette. */
export async function resolveOrganizationIdBySocialAccount(accountId: string): Promise<string | null> {
  const account = await getSocialAccountByAccountId(accountId);
  return account && account.status === "connected" ? account.organizationId : null;
}

/**
 * Enregistre (ou reconnecte) un compte. Refuse d'écraser un compte déjà
 * rattaché à UNE AUTRE organisation (unicité globale de `account_id`).
 */
export async function upsertSocialAccount(input: {
  organizationId: string;
  platform: string;
  accountId: string;
  profileId: string;
  username?: string | null;
}): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const existing = await getSocialAccountByAccountId(input.accountId);
  if (existing && existing.organizationId !== input.organizationId) {
    throw new ValidationError("Ce compte est déjà rattaché à une autre organisation.");
  }
  const { error } = await supabase.from("social_accounts").upsert(
    {
      organization_id: input.organizationId,
      platform: input.platform,
      account_id: input.accountId,
      profile_id: input.profileId,
      username: input.username ?? null,
      status: "connected",
    },
    { onConflict: "account_id" },
  );
  if (error) throw new Error(`Enregistrement du compte ${input.platform} impossible: ${error.message}`);
}

export async function setSocialAccountStatus(accountId: string, status: SocialAccountStatus): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("social_accounts").update({ status }).eq("account_id", accountId);
  if (error) console.error(`setSocialAccountStatus(${accountId}) error:`, error.message);
}

export async function updateSocialAccountAutoReply(
  organizationId: string,
  accountId: string,
  settings: { autoReplyComments?: boolean; autoReplyMessages?: boolean },
): Promise<void> {
  const patch: Record<string, boolean> = {};
  if (settings.autoReplyComments !== undefined) patch.auto_reply_comments = settings.autoReplyComments;
  if (settings.autoReplyMessages !== undefined) patch.auto_reply_messages = settings.autoReplyMessages;
  if (Object.keys(patch).length === 0) return;
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("social_accounts").update(patch).eq("organization_id", organizationId).eq("account_id", accountId);
  if (error) throw new Error(`Mise à jour du compte impossible: ${error.message}`);
}

/**
 * Profils Zernio « sociaux » d'une organisation : le profil principal
 * (provider_connections) + les profils additionnels créés pour les
 * plateformes limitées à un compte par profil (TikTok).
 */
export async function listOrganizationZernioProfileIds(organizationId: string): Promise<string[]> {
  const supabase = getSupabaseServiceClient();
  const [connections, extras] = await Promise.all([
    supabase
      .from("provider_connections")
      .select("metadata")
      .eq("organization_id", organizationId)
      .eq("provider_name", "zernio")
      .eq("provider_type", "social"),
    supabase.from("zernio_social_profiles").select("profile_id").eq("organization_id", organizationId),
  ]);
  if (connections.error) throw new Error(`Lecture du profil Zernio impossible: ${connections.error.message}`);
  if (extras.error) throw new Error(`Lecture des profils Zernio impossible: ${extras.error.message}`);
  const ids = new Set<string>();
  for (const row of connections.data ?? []) {
    const profileId = (row.metadata as { profileId?: string } | null)?.profileId;
    if (profileId) ids.add(profileId);
  }
  for (const row of extras.data ?? []) ids.add(row.profile_id as string);
  return [...ids];
}

/**
 * Réaligne le registre local sur Zernio pour tous les profils sociaux de
 * l'organisation : ajoute les comptes manquants (organisations créées
 * avant le registre), marque `disconnected` ceux qui n'existent plus.
 */
export async function syncSocialAccountsFromZernio(organizationId: string): Promise<SocialAccountRecord[]> {
  const profileIds = await listOrganizationZernioProfileIds(organizationId);
  if (profileIds.length === 0) return [];
  const client = new ZernioSocialClient(await resolveCredential(organizationId, "social", "zernio"));
  const supabase = getSupabaseServiceClient();

  for (const profileId of profileIds) {
    const response = await client.listAccounts(profileId);
    const remote = response.accounts.filter((account) => account.platform !== "whatsapp");
    const remoteIds = new Set(remote.map((account) => account._id));

    for (const account of remote) {
      try {
        await upsertSocialAccount({
          organizationId,
          platform: account.platform,
          accountId: account._id,
          profileId,
          username: account.username ?? null,
        });
      } catch (error) {
        console.warn(`syncSocialAccountsFromZernio: compte ${account._id} ignoré:`, error);
      }
    }

    const { data: local } = await supabase
      .from("social_accounts")
      .select("account_id")
      .eq("organization_id", organizationId)
      .eq("profile_id", profileId)
      .eq("status", "connected");
    const stale = (local ?? []).map((row) => row.account_id as string).filter((id) => !remoteIds.has(id));
    if (stale.length > 0) {
      await supabase.from("social_accounts").update({ status: "disconnected" }).eq("organization_id", organizationId).in("account_id", stale);
    }
  }
  return listOrganizationSocialAccounts(organizationId);
}

/**
 * Sécurité multi-tenant : chaque compte ciblé par une publication doit
 * appartenir à l'organisation et être connecté. YouTube (connexion
 * directe) est vérifié dans `youtube_accounts`, les autres réseaux dans
 * `social_accounts` (avec une resynchronisation Zernio en cas d'absence
 * pour les organisations antérieures au registre).
 */
export async function assertTargetsBelongToOrganization(
  organizationId: string,
  targets: { platform: string; accountId: string }[],
): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const youtubeIds = [...new Set(targets.filter((t) => t.platform === "youtube").map((t) => t.accountId))];
  if (youtubeIds.length > 0) {
    const { data, error } = await supabase
      .from("youtube_accounts")
      .select("channel_id")
      .eq("organization_id", organizationId)
      .eq("status", "connected")
      .in("channel_id", youtubeIds);
    if (error) throw new Error(`Vérification des chaînes YouTube impossible: ${error.message}`);
    const owned = new Set((data ?? []).map((row) => row.channel_id as string));
    const missing = youtubeIds.filter((id) => !owned.has(id));
    if (missing.length > 0) throw new ValidationError("Une chaîne YouTube ciblée n'appartient pas à votre organisation ou n'est plus connectée.");
  }

  const socialIds = [...new Set(targets.filter((t) => t.platform !== "youtube").map((t) => t.accountId))];
  if (socialIds.length === 0) return;

  const readOwned = async () => {
    const { data, error } = await supabase
      .from("social_accounts")
      .select("account_id")
      .eq("organization_id", organizationId)
      .eq("status", "connected")
      .in("account_id", socialIds);
    if (error) throw new Error(`Vérification des comptes sociaux impossible: ${error.message}`);
    return new Set((data ?? []).map((row) => row.account_id as string));
  };

  let owned = await readOwned();
  if (socialIds.some((id) => !owned.has(id))) {
    await syncSocialAccountsFromZernio(organizationId).catch((error) => console.warn("assertTargetsBelongToOrganization: synchronisation Zernio impossible:", error));
    owned = await readOwned();
  }
  if (socialIds.some((id) => !owned.has(id))) {
    throw new ValidationError("Un compte ciblé n'appartient pas à votre organisation ou n'est plus connecté.");
  }
}
