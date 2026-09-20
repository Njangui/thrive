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

/**
 * Profil Zernio DÉDIÉ au numéro Groupes (provider_type='whatsapp_groups',
 * distinct du profil principal ci-dessus). Nécessaire car Zernio limite
 * un profil à un seul numéro WhatsApp (confirmé docs.zernio.com/
 * platforms/whatsapp/connection, "One WhatsApp number per profile") — le
 * numéro de messagerie (Coexistence) et le numéro dédié aux groupes
 * (Cloud API) doivent donc vivre sur deux profils séparés.
 */
async function getExistingGroupsProfileId(organizationId: string): Promise<string | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("provider_connections")
    .select("metadata")
    .eq("organization_id", organizationId)
    .eq("provider_name", "zernio")
    .eq("provider_type", "whatsapp_groups")
    .maybeSingle();
  if (error) throw new Error(`Lecture du profil Zernio (groupes) impossible: ${error.message}`);
  return (data?.metadata as { profileId?: string } | null)?.profileId ?? null;
}

/** Crée automatiquement le profil Zernio dédié aux Groupes WhatsApp, distinct du profil principal (voir getExistingGroupsProfileId ci-dessus). */
export async function ensureZernioGroupsProfile(organizationId: string, organizationName: string): Promise<string> {
  const existing = await getExistingGroupsProfileId(organizationId);
  if (existing) return existing;

  const client = new ZernioSocialClient(await getZernioApiKey(organizationId));
  const created = await client.createProfile({
    name: `${organizationName.trim().slice(0, 60) || `CRESYVA ${organizationId.slice(0, 8)}`} — Groupes WhatsApp`,
    description: `Numéro WhatsApp dédié aux groupes — ${organizationName}`,
    color: "#7c3aed",
  });
  const profileId = created.profile._id;

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("provider_connections").upsert(
    {
      organization_id: organizationId,
      provider_type: "whatsapp_groups",
      provider_name: "zernio",
      status: "disconnected",
      metadata: { profileId },
    },
    { onConflict: "organization_id,provider_type,provider_name" },
  );
  if (error) throw new Error(`Enregistrement du profil Zernio (groupes) impossible: ${error.message}`);
  return profileId;
}

/** Crée automatiquement le profil Zernio du commerçant à la première connexion. */
export async function ensureZernioProfile(organizationId: string, organizationName: string): Promise<string> {
  const existing = await getExistingProfileId(organizationId);
  if (existing) return existing;

  const client = new ZernioSocialClient(await getZernioApiKey(organizationId));
  const created = await client.createProfile({
    name: organizationName.trim().slice(0, 80) || `CRESYVA ${organizationId.slice(0, 8)}`,
    description: `Profil CRESYVA — ${organizationName}`,
    color: "#009979",
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

/**
 * Connexion du numéro DÉDIÉ aux Groupes WhatsApp — toujours en Cloud API
 * classique (onboarding="api"), jamais Coexistence : l'API Groupes ne
 * fonctionne pas sur un numéro en Coexistence (voir en-tête de
 * 0058_whatsapp_coexistence_dedicated_numbers.sql). Ce numéro peut être
 * celui du commerçant (chemin gratuit) ou un numéro assigné par un Super
 * Admin via /admin/numbers (chemin payant, voir
 * phone-number-rental-service.ts) — dans les deux cas, c'est ce même
 * parcours de connexion qui l'active côté Zernio.
 */
export async function getZernioWhatsAppGroupsConnectUrl(organizationId: string, organizationName: string): Promise<string> {
  const profileId = await ensureZernioGroupsProfile(organizationId, organizationName);
  const client = new ZernioSocialClient(await getZernioApiKey(organizationId));
  const redirectUrl = `${env.NEXT_PUBLIC_APP_URL}/dashboard/channels/callback`;
  const response = await client.getConnectUrl("whatsapp", profileId, redirectUrl, { onboarding: "api" });
  return response.authUrl;
}

/** Statut du numéro dédié aux groupes (distinct de getZernioAccounts, qui ne couvre que le profil principal). */
export async function getZernioWhatsAppGroupsAccount(organizationId: string): Promise<ZernioChannelAccount | null> {
  const profileId = await getExistingGroupsProfileId(organizationId);
  if (!profileId) return null;
  const client = new ZernioSocialClient(await getZernioApiKey(organizationId));
  const response = await client.listAccounts(profileId);
  const account = response.accounts.find((a) => a.platform === "whatsapp");
  return account ? { accountId: account._id, platform: "whatsapp", username: account.username ?? null, status: "connected" } : null;
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

  // WhatsApp a désormais DEUX profils Zernio valides pour une même
  // organisation (messagerie en Coexistence vs numéro dédié aux
  // groupes, voir ensureZernioGroupsProfile ci-dessus) — on détermine
  // lequel vient de répondre en comparant le profileId retourné par
  // Zernio aux deux profils connus, plutôt que de supposer qu'il n'y en
  // a toujours qu'un seul possible.
  const mainProfileId = await getExistingProfileId(organizationId);
  const groupsProfileId = platform === "whatsapp" ? await getExistingGroupsProfileId(organizationId) : null;

  let providerType: string;
  if (platform === "whatsapp" && groupsProfileId && groupsProfileId === profileId) {
    providerType = "whatsapp_groups";
  } else if (mainProfileId && mainProfileId === profileId) {
    providerType = platform === "whatsapp" ? "messaging" : "social";
  } else {
    throw new Error("Connexion Zernio invalide ou expirée. Relancez la connexion depuis Canaux.");
  }

  const supabase = getSupabaseServiceClient();
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
