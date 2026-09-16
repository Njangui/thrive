import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { resolveCredential } from "@/infrastructure/providers/secrets-resolver";
import { ZernioSocialClient } from "@/infrastructure/providers/social/zernio/client";
import { env } from "@/lib/env";

export type ZernioPlatform =
  | "facebook" | "instagram" | "linkedin" | "twitter" | "tiktok" | "youtube"
  | "threads" | "reddit" | "pinterest" | "bluesky" | "googlebusiness" | "telegram"
  | "snapchat" | "discord" | "whatsapp";

export interface ZernioChannelAccount {
  accountId: string;
  platform: string;
  username: string | null;
  status: "connected" | "disconnected" | "unknown";
}

async function getZernioApiKey(organizationId: string) {
  return resolveCredential(organizationId, "social", "zernio");
}

async function getExistingProfileId(organizationId: string): Promise<string | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("provider_connections")
    .select("metadata")
    .eq("organization_id", organizationId)
    .eq("provider_name", "zernio")
    .in("provider_type", ["social", "messaging"]);
  if (error) throw new Error(`Lecture du profil Zernio impossible: ${error.message}`);
  for (const row of data ?? []) {
    const profileId = (row.metadata as { profileId?: string } | null)?.profileId;
    if (profileId) return profileId;
  }
  return null;
}

/** Crée automatiquement le profil Zernio du commerçant à la première connexion. */
export async function ensureZernioProfile(organizationId: string, organizationName: string): Promise<string> {
  const existing = await getExistingProfileId(organizationId);
  if (existing) return existing;

  const client = new ZernioSocialClient(await getZernioApiKey(organizationId));
  const created = await client.createProfile({
    name: organizationName.trim().slice(0, 80) || `SME-OS ${organizationId.slice(0, 8)}`,
    description: `Profil SME-OS — ${organizationName}`,
    color: "#6D28D9",
  });
  const profileId = created.profile._id;

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("provider_connections").upsert(
    {
      organization_id: organizationId,
      provider_type: "social",
      provider_name: "zernio",
      status: "disconnected",
      metadata: { profileId },
    },
    { onConflict: "organization_id,provider_type,provider_name" },
  );
  if (error) throw new Error(`Enregistrement du profil Zernio impossible: ${error.message}`);
  return profileId;
}

export async function getZernioAccounts(organizationId: string): Promise<ZernioChannelAccount[]> {
  const profileId = await getExistingProfileId(organizationId);
  if (!profileId) return [];
  const client = new ZernioSocialClient(await getZernioApiKey(organizationId));
  const response = await client.listAccounts(profileId);
  return response.accounts.map((account) => ({
    accountId: account._id,
    platform: account.platform,
    username: account.username ?? null,
    status: "connected",
  }));
}

export async function getZernioConnectUrl(
  organizationId: string,
  organizationName: string,
  platform: ZernioPlatform,
): Promise<string> {
  const profileId = await ensureZernioProfile(organizationId, organizationName);
  const client = new ZernioSocialClient(await getZernioApiKey(organizationId));
  const redirectUrl = `${env.NEXT_PUBLIC_APP_URL}/dashboard/channels/callback`;
  const response = await client.getConnectUrl(platform, profileId, redirectUrl);
  return response.authUrl;
}

export async function getZernioTelegramCode(organizationId: string, organizationName: string) {
  const profileId = await ensureZernioProfile(organizationId, organizationName);
  const client = new ZernioSocialClient(await getZernioApiKey(organizationId));
  return client.getTelegramConnectStatus(profileId);
}

export async function completeZernioTelegramConnection(organizationId: string, code: string) {
  const client = new ZernioSocialClient(await getZernioApiKey(organizationId));
  const result = await client.completeTelegramConnect(code);
  if (result.status !== "connected" || !result.account) return result;

  const profileId = await getExistingProfileId(organizationId);
  const supabase = getSupabaseServiceClient();
  await supabase.from("provider_connections").upsert(
    {
      organization_id: organizationId,
      provider_type: "social",
      provider_name: "zernio",
      status: "connected",
      metadata: { profileId, accountId: result.account._id, platform: "telegram", username: result.account.username },
    },
    { onConflict: "organization_id,provider_type,provider_name" },
  );
  return result;
}

export async function persistZernioOAuthConnection(
  organizationId: string,
  platform: string,
  profileId: string,
  accountId: string,
  username?: string,
) {
  const allowed = new Set(["facebook", "instagram", "linkedin", "twitter", "tiktok", "youtube", "threads", "reddit", "pinterest", "bluesky", "googlebusiness", "telegram", "snapchat", "discord", "whatsapp"]);
  if (!allowed.has(platform)) throw new Error("Plateforme Zernio non autorisée.");
  const expectedProfileId = await getExistingProfileId(organizationId);
  if (!expectedProfileId || expectedProfileId !== profileId) throw new Error("Connexion Zernio invalide ou expirée. Relancez la connexion depuis Canaux.");
  const supabase = getSupabaseServiceClient();
  const providerType = platform === "whatsapp" ? "messaging" : "social";
  const { data: current } = await supabase
    .from("provider_connections")
    .select("metadata")
    .eq("organization_id", organizationId)
    .eq("provider_type", providerType)
    .eq("provider_name", "zernio")
    .maybeSingle();
  const previous = (current?.metadata ?? {}) as Record<string, unknown>;
  const { error } = await supabase.from("provider_connections").upsert(
    {
      organization_id: organizationId,
      provider_type: providerType,
      provider_name: "zernio",
      status: "connected",
      metadata: { ...previous, profileId, accountId, platform, username: username ?? null },
    },
    { onConflict: "organization_id,provider_type,provider_name" },
  );
  if (error) throw new Error(`Connexion ${platform} enregistrée mais impossible à finaliser: ${error.message}`);
}
