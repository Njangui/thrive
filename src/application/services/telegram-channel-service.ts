import { randomBytes } from "node:crypto";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { TelegramMessagingClient } from "@/infrastructure/providers/messaging/telegram/client";
import { env } from "@/lib/env";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { writeAdminAuditLog } from "./admin-organizations-service";

/**
 * Connexion SELF-SERVICE d'un tenant à son propre bot Telegram — canal
 * client INDÉPENDANT de Zernio (docs/TELEGRAM_INTEGRATION.md). Contrairement
 * à `configureTenantProviderCredential` (admin-organizations-service.ts,
 * réservé Super Admin, générique "coller une clé API"), ce service est
 * pensé pour être actionné par le propriétaire/admin de l'organisation
 * lui-même : il valide le jeton, génère le secret de webhook DÉDIÉ à
 * cette connexion, et enregistre le webhook côté Telegram — trois étapes
 * qu'un simple "coller une clé" ne couvre pas.
 */

const PROVIDER_TYPE = "messaging";
const PROVIDER_NAME = "telegram";

export interface TelegramChannelStatus {
  connected: boolean;
  botUsername: string | null;
}

export async function getTelegramChannelStatus(organizationId: string): Promise<TelegramChannelStatus> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("provider_connections")
    .select("status, metadata")
    .eq("organization_id", organizationId)
    .eq("provider_type", PROVIDER_TYPE)
    .eq("provider_name", PROVIDER_NAME)
    .maybeSingle();

  if (error) throw new Error(`Erreur lecture provider_connections: ${error.message}`);

  const metadata = (data?.metadata ?? {}) as { botUsername?: string };
  return { connected: data?.status === "connected", botUsername: metadata.botUsername ?? null };
}

/**
 * Valide le jeton (appel réel `getMe` à l'API Telegram — un jeton
 * invalide échoue ici avec un message clair plutôt qu'au premier message
 * client), stocke le jeton en Vault (jamais en clair, même discipline
 * que `configureTenantProviderCredential`), génère un secret de webhook
 * PROPRE à cette connexion, et enregistre l'URL de webhook côté
 * Telegram — `setWebhook` doit réussir pour que la connexion soit
 * considérée `connected` (sinon le tenant croirait être connecté sans
 * jamais recevoir aucun message).
 */
export async function connectTelegramChannel(
  organizationId: string,
  actorUserId: string,
  botToken: string,
): Promise<{ botUsername: string }> {
  const trimmedToken = botToken.trim();
  if (!trimmedToken) throw new ValidationError("Le jeton du bot est requis.");

  const client = new TelegramMessagingClient(trimmedToken);
  let botUsername: string;
  try {
    const me = await client.getMe();
    if (!me.username) throw new Error("no_username");
    botUsername = me.username;
  } catch {
    throw new ValidationError(
      "Jeton Telegram invalide. Vérifiez que vous avez bien copié le jeton complet fourni par @BotFather.",
    );
  }

  const supabase = getSupabaseServiceClient();

  const { data: existing, error: existingError } = await supabase
    .from("provider_connections")
    .select("id, credential_reference")
    .eq("organization_id", organizationId)
    .eq("provider_type", PROVIDER_TYPE)
    .eq("provider_name", PROVIDER_NAME)
    .maybeSingle();
  if (existingError) throw new Error(`Erreur lecture provider_connections: ${existingError.message}`);

  let secretReference: string;
  if (existing?.credential_reference) {
    const { error: vaultError } = await supabase.rpc("vault_update_secret", {
      secret_id: existing.credential_reference,
      new_secret_value: trimmedToken,
    });
    if (vaultError) throw new Error(`Erreur mise à jour du secret: ${vaultError.message}`);
    secretReference = existing.credential_reference;
  } else {
    const { data: newSecretId, error: vaultError } = await supabase.rpc("vault_create_secret", {
      secret_value: trimmedToken,
      secret_name: `${PROVIDER_TYPE}:${PROVIDER_NAME}:${organizationId}`,
    });
    if (vaultError || !newSecretId) throw new Error(`Erreur création du secret: ${vaultError?.message}`);
    secretReference = newSecretId as string;
  }

  // Identifiant d'URL opaque + secret de vérification — voir
  // messaging/telegram/resolve-organization.ts pour leur usage exact.
  // Régénérés à CHAQUE (re)connexion : une ancienne URL de webhook
  // révoquée par le tenant (jeton changé côté BotFather) ne doit jamais
  // rester valide.
  const webhookPathToken = randomBytes(24).toString("hex");
  const webhookSecret = randomBytes(32).toString("hex");
  const webhookUrl = `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/telegram/tenant/${webhookPathToken}`;

  try {
    await client.setWebhook(webhookUrl, webhookSecret);
  } catch (err) {
    throw new Error(
      `Le jeton est valide mais l'enregistrement du webhook a échoué : ${err instanceof Error ? err.message : err}`,
    );
  }

  const { error: upsertError } = await supabase.from("provider_connections").upsert(
    {
      organization_id: organizationId,
      provider_type: PROVIDER_TYPE,
      provider_name: PROVIDER_NAME,
      status: "connected",
      credential_reference: secretReference,
      metadata: { botUsername, webhookPathToken, webhookSecret },
    },
    { onConflict: "organization_id,provider_type,provider_name" },
  );
  if (upsertError) throw new Error(`Erreur écriture provider_connections: ${upsertError.message}`);

  await writeAdminAuditLog({
    actorUserId,
    organizationId,
    action: "TELEGRAM_CHANNEL_CONNECTED",
    entityType: "provider_connection",
    afterState: { botUsername },
  });

  return { botUsername };
}

export async function disconnectTelegramChannel(organizationId: string, actorUserId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { data: existing, error } = await supabase
    .from("provider_connections")
    .select("credential_reference")
    .eq("organization_id", organizationId)
    .eq("provider_type", PROVIDER_TYPE)
    .eq("provider_name", PROVIDER_NAME)
    .maybeSingle();

  if (error) throw new Error(`Erreur lecture provider_connections: ${error.message}`);
  if (!existing) throw new NotFoundError("Aucun canal Telegram connecté pour cette organisation.");

  // Best-effort : le tenant a pu révoquer/supprimer son bot côté
  // BotFather entre-temps — un échec ici ne doit jamais empêcher la
  // déconnexion côté SME-OS (voir aussi le raisonnement identique pour
  // Zernio dans provider-connection-service.ts).
  if (existing.credential_reference) {
    try {
      const { data: secret } = await supabase.rpc("vault_read_secret", { secret_id: existing.credential_reference });
      if (secret) await new TelegramMessagingClient(secret as string).deleteWebhook();
    } catch (err) {
      console.warn(`disconnectTelegramChannel: échec deleteWebhook (org ${organizationId}):`, err);
    }
    await supabase.rpc("vault_delete_secret", { secret_id: existing.credential_reference });
  }

  const { error: updateError } = await supabase
    .from("provider_connections")
    .update({ status: "disconnected", credential_reference: null })
    .eq("organization_id", organizationId)
    .eq("provider_type", PROVIDER_TYPE)
    .eq("provider_name", PROVIDER_NAME);
  if (updateError) throw new Error(`Erreur mise à jour provider_connections: ${updateError.message}`);

  await writeAdminAuditLog({
    actorUserId,
    organizationId,
    action: "TELEGRAM_CHANNEL_DISCONNECTED",
    entityType: "provider_connection",
  });
}
