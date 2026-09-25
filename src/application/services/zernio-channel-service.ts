import {
  getSocialAccountByAccountId,
  listOrganizationSocialAccounts,
  listOrganizationZernioProfileIds,
  syncSocialAccountsFromZernio,
  upsertSocialAccount,
} from "./social-account-registry-service";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { resolveCredential } from "@/infrastructure/providers/secrets-resolver";
import { ZernioSocialClient } from "@/infrastructure/providers/social/zernio/client";
import { env } from "@/lib/env";
import { canUseFeature } from "./entitlements-service";
import { QuotaExceededError } from "@/lib/errors";

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

/** Liste des numéros WhatsApp de messagerie 1:1 de l'organisation. */
export interface WhatsAppMessagingAccount extends ZernioChannelAccount {
  profileId: string;
  phoneNumber: string | null;
  isPrimary: boolean;
}

export async function getZernioWhatsAppAccounts(organizationId: string): Promise<WhatsAppMessagingAccount[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("whatsapp_accounts")
    .select("profile_id, account_id, phone_number, username, status, is_primary")
    .eq("organization_id", organizationId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Lecture des numéros WhatsApp impossible: ${error.message}`);
  return (data ?? []).map((row: { profile_id: string; account_id: string; phone_number: string | null; username: string | null; status: string; is_primary: boolean }) => ({
    accountId: row.account_id,
    platform: "whatsapp",
    username: row.username ?? null,
    status: row.status === "connected" ? "connected" : row.status === "error" ? "unknown" : "disconnected",
    profileId: row.profile_id,
    phoneNumber: row.phone_number ?? null,
    isPrimary: Boolean(row.is_primary),
  }));
}

/** Crée un profil Zernio dédié à un nouveau numéro WhatsApp de messagerie. */
async function ensureZernioWhatsAppMessagingProfile(organizationId: string, organizationName: string): Promise<string> {
  const accounts = await getZernioWhatsAppAccounts(organizationId);
  const legacy = await getExistingProfileId(organizationId);
  if (!accounts.length && legacy) return legacy;

  const client = new ZernioSocialClient(await getZernioApiKey(organizationId));
  const created = await client.createProfile({
    name: `${organizationName.trim().slice(0, 55) || "Entreprise Flexco"} — WhatsApp ${accounts.length + 1}`,
    description: `Numéro WhatsApp de messagerie ${accounts.length + 1} — ${organizationName}`,
    color: "#009979",
  });
  return created.profile._id;
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
    name: `${organizationName.trim().slice(0, 60) || `Flexco ${organizationId.slice(0, 8)}`} — Groupes WhatsApp`,
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
    name: organizationName.trim().slice(0, 80) || `Flexco ${organizationId.slice(0, 8)}`,
    description: `Profil Flexco — ${organizationName}`,
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
  // Lot O : profil principal + profils additionnels (un compte TikTok par profil).
  const profileIds = await listOrganizationZernioProfileIds(organizationId);
  const client = new ZernioSocialClient(await getZernioApiKey(organizationId));
  const socialAccounts: ZernioChannelAccount[] = [];
  for (const profileId of profileIds) {
    const response = await client.listAccounts(profileId);
    for (const account of response.accounts) {
      if (account.platform === "whatsapp") continue;
      socialAccounts.push({ accountId: account._id, platform: account.platform, username: account.username ?? null, status: "connected" as const });
    }
  }
  const whatsappAccounts = await getZernioWhatsAppAccounts(organizationId);
  return [...socialAccounts, ...whatsappAccounts];
}

/** Clés de plan cumulatives (table `social_accounts`) des réseaux à comptes multiples. */
export const SOCIAL_ACCOUNT_QUOTA_KEY: Record<string, string> = {
  facebook: "facebook_pages",
  instagram: "instagram_accounts",
  linkedin: "linkedin_pages",
  tiktok: "tiktok_accounts",
};

/**
 * Lot O — profil Zernio à utiliser pour connecter un compte `platform`.
 * Zernio limite certaines plateformes à UN compte par profil (TikTok :
 * « one account per profile », docs.zernio.com) : on réutilise le premier
 * profil de l'organisation qui n'a pas encore de compte de cette plateforme,
 * sinon on en crée un nouveau (enregistré dans `zernio_social_profiles`
 * pour le routage des webhooks). Une reconnexion réutilise le profil du
 * compte concerné.
 */
export async function pickProfileForPlatform(
  organizationId: string,
  organizationName: string,
  platform: string,
  reconnectAccountId?: string,
): Promise<string> {
  const mainProfileId = await ensureZernioProfile(organizationId, organizationName);
  // Réaligne le registre local (organisations antérieures au registre) — best effort.
  await syncSocialAccountsFromZernio(organizationId).catch((error) => console.warn("pickProfileForPlatform: synchronisation impossible:", error));

  if (reconnectAccountId) {
    const account = await getSocialAccountByAccountId(reconnectAccountId);
    if (account && account.organizationId === organizationId) return account.profileId;
  }

  const knownProfileIds = await listOrganizationZernioProfileIds(organizationId);
  const profileIds = knownProfileIds.includes(mainProfileId) ? knownProfileIds : [mainProfileId, ...knownProfileIds];
  const usedProfileIds = new Set((await listOrganizationSocialAccounts(organizationId, { platform })).map((account) => account.profileId));
  const free = profileIds.find((profileId) => !usedProfileIds.has(profileId));
  if (free) return free;

  const client = new ZernioSocialClient(await getZernioApiKey(organizationId));
  const created = await client.createProfile({
    name: `${organizationName.trim() || "Flexco"} · ${platform} ${profileIds.length + 1}`.slice(0, 80),
    description: `Profil additionnel Flexco — ${platform}`,
    color: "#009979",
  });
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("zernio_social_profiles").insert({ organization_id: organizationId, profile_id: created.profile._id, label: platform });
  if (error) throw new Error(`Enregistrement du profil additionnel Zernio impossible: ${error.message}`);
  return created.profile._id;
}

export async function getZernioConnectUrl(
  organizationId: string,
  organizationName: string,
  platform: ZernioPlatform,
  options?: { onboarding?: "api" | "business_app"; reconnectAccountId?: string },
): Promise<string> {
  // Plafond cumulatif vérifié AVANT d'ouvrir l'OAuth (une reconnexion ne consomme pas de quota).
  const quotaKey = SOCIAL_ACCOUNT_QUOTA_KEY[platform];
  if (quotaKey && !options?.reconnectAccountId) {
    const entitlement = await canUseFeature(organizationId, quotaKey, 1);
    if (!entitlement.allowed) {
      throw new QuotaExceededError(
        entitlement.limit === 0
          ? `${platform} n'est pas inclus dans votre offre.`
          : `La limite de ${platform} de votre offre est atteinte (${entitlement.limit}).`,
      );
    }
  }
  const profileId = await pickProfileForPlatform(organizationId, organizationName, platform, options?.reconnectAccountId);
  const client = new ZernioSocialClient(await getZernioApiKey(organizationId));
  const redirectUrl = `${env.NEXT_PUBLIC_APP_URL}/dashboard/channels/callback`;
  const response = await client.getConnectUrl(platform, profileId, redirectUrl, options?.onboarding ? { onboarding: options.onboarding } : undefined);
  return response.authUrl;
}

/** Connexion d'un nouveau numéro WhatsApp de messagerie 1:1 en Coexistence. */
export async function getZernioWhatsAppConnectUrl(organizationId: string, organizationName: string): Promise<string> {
  const entitlement = await canUseFeature(organizationId, "whatsapp", 1);
  if (!entitlement.allowed) throw new QuotaExceededError(`La limite de numéros WhatsApp de votre offre est atteinte (${entitlement.limit}).`);
  const profileId = await ensureZernioWhatsAppMessagingProfile(organizationId, organizationName);
  const client = new ZernioSocialClient(await getZernioApiKey(organizationId));
  const redirectUrl = `${env.NEXT_PUBLIC_APP_URL}/dashboard/channels/callback`;
  const response = await client.getConnectUrl("whatsapp", profileId, redirectUrl, { onboarding: "business_app" });
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
  } else if (platform === "whatsapp") {
    providerType = "messaging";
  } else if (mainProfileId && mainProfileId === profileId) {
    providerType = "social";
  } else if (await isAdditionalSocialProfile(organizationId, profileId)) {
    // Lot O : profil additionnel (un compte TikTok par profil Zernio).
    providerType = "social";
  } else {
    throw new Error("Connexion Zernio invalide ou expirée. Relancez la connexion depuis Canaux.");
  }

  // Garde-fou serveur : la limite WhatsApp est cumulée sur la table dédiée.
  if (platform === "whatsapp" && providerType === "messaging") {
    const entitlement = await canUseFeature(organizationId, "whatsapp", 1);
    if (!entitlement.allowed) throw new QuotaExceededError(`La limite de numéros WhatsApp de votre offre est atteinte (${entitlement.limit}).`);

    const supabase = getSupabaseServiceClient();
    const [{ count: existingCount, error: countError }, { data: existingAccount, error: existingError }] = await Promise.all([
      supabase
        .from("whatsapp_accounts")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("status", "connected"),
      supabase
        .from("whatsapp_accounts")
        .select("is_primary")
        .eq("organization_id", organizationId)
        .eq("account_id", accountId)
        .maybeSingle(),
    ]);
    if (countError) throw new Error(`Impossible de vérifier les numéros WhatsApp existants: ${countError.message}`);
    if (existingError) throw new Error(`Impossible de vérifier ce numéro WhatsApp: ${existingError.message}`);
    const isPrimary = existingAccount?.is_primary ?? ((existingCount ?? 0) === 0);

    const { error } = await supabase.from("whatsapp_accounts").upsert({
      organization_id: organizationId,
      profile_id: profileId,
      account_id: accountId,
      phone_number: username ?? null,
      username: username ?? null,
      status: "connected",
      is_primary: isPrimary,
    }, { onConflict: "organization_id,account_id" });
    if (error) throw new Error(`Connexion WhatsApp enregistrée mais impossible de finaliser le numéro: ${error.message}`);

    // Le premier numéro reste aussi reflété dans provider_connections pour
    // compatibilité avec les anciennes versions du code.
    if (isPrimary) {
      await supabase.from("provider_connections").upsert({
        organization_id: organizationId,
        provider_type: "messaging",
        provider_name: "zernio",
        status: "connected",
        metadata: { profileId, accountId, platform, username: username ?? null },
      }, { onConflict: "organization_id,provider_type,provider_name" });
    }
    return;
  }

  // Lot O — plafond CUMULATIF des comptes (registre `social_accounts`). Une
  // reconnexion d'un compte déjà enregistré ne consomme pas de quota ; sinon
  // le garde-fou refuse ce nouveau compte (l'appelant l'a déjà refusé avant
  // l'OAuth : ceci couvre une connexion concurrente ou un rejeu du callback).
  const quotaKey = SOCIAL_ACCOUNT_QUOTA_KEY[platform];
  const knownAccount = await getSocialAccountByAccountId(accountId);
  if (quotaKey && !(knownAccount && knownAccount.organizationId === organizationId)) {
    const entitlement = await canUseFeature(organizationId, quotaKey, 1);
    if (!entitlement.allowed) {
      throw new QuotaExceededError(`La limite de ${platform} de votre offre est atteinte (${entitlement.limit}).`);
    }
  }
  await upsertSocialAccount({ organizationId, platform, accountId, profileId, username: username ?? null });

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
      // Le profil PRINCIPAL reste celui de la ligne (jamais écrasé par un profil additionnel).
      metadata: { ...previous, profileId: mainProfileId && mainProfileId !== profileId ? mainProfileId : profileId, accountId, platform, username: username ?? null },
    },
    { onConflict: "organization_id,provider_type,provider_name" },
  );
  if (error) throw new Error(`Connexion ${platform} enregistrée mais impossible à finaliser: ${error.message}`);
}

async function isAdditionalSocialProfile(organizationId: string, profileId: string): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("zernio_social_profiles")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw new Error(`Lecture des profils Zernio impossible: ${error.message}`);
  return Boolean(data);
}
