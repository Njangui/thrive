import { randomBytes } from "node:crypto";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { TelegramMessagingClient } from "@/infrastructure/providers/messaging/telegram/client";
import { env } from "@/lib/env";
import { NotFoundError, QuotaExceededError, ValidationError } from "@/lib/errors";
import { writeAdminAuditLog } from "./admin-organizations-service";
import { canUseFeature } from "./entitlements-service";

/**
 * Connexion SELF-SERVICE d'un tenant à SES bots Telegram — canal client
 * INDÉPENDANT de Zernio (docs/TELEGRAM_INTEGRATION.md).
 *
 * Lot O — multi-bots : une organisation peut connecter plusieurs bots
 * (Discover 1, Starter 3, Pro 10 — `telegram_bots`, plafond CUMULATIF
 * appliqué ici à la connexion). Chaque bot a son jeton (Vault), son URL de
 * webhook opaque et son secret dédiés ; la table `telegram_bots` remplace
 * la ligne unique `provider_connections` (reprise par la migration 0067).
 * Les canaux/groupes vers lesquels un bot publie sont gérés par
 * telegram-destination-service.ts.
 */
export interface TelegramBotSummary {
  id: string;
  botUsername: string;
  botName: string | null;
  isPrimary: boolean;
  connectedAt: string;
}

export interface TelegramChannelStatus {
  connected: boolean;
  /** Bot principal (compatibilité des anciens appelants mono-bot). */
  botUsername: string | null;
  bots: TelegramBotSummary[];
}

interface TelegramBotRow {
  id: string;
  organization_id: string;
  bot_id: number | null;
  bot_username: string;
  bot_name: string | null;
  credential_reference: string | null;
  webhook_path_token: string;
  webhook_secret: string;
  status: string;
  is_primary: boolean;
  created_at: string;
}

const BOT_COLUMNS = "id, organization_id, bot_id, bot_username, bot_name, credential_reference, webhook_path_token, webhook_secret, status, is_primary, created_at";

export async function listTelegramBots(organizationId: string): Promise<TelegramBotSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("telegram_bots")
    .select("id, bot_username, bot_name, is_primary, created_at")
    .eq("organization_id", organizationId)
    .eq("status", "connected")
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Erreur lecture des bots Telegram: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    botUsername: row.bot_username as string,
    botName: (row.bot_name as string | null) ?? null,
    isPrimary: Boolean(row.is_primary),
    connectedAt: row.created_at as string,
  }));
}

export async function getTelegramChannelStatus(organizationId: string): Promise<TelegramChannelStatus> {
  const bots = await listTelegramBots(organizationId);
  return { connected: bots.length > 0, botUsername: bots[0]?.botUsername ?? null, bots };
}

async function readBotToken(credentialReference: string | null): Promise<string> {
  if (!credentialReference) throw new Error("Ce bot Telegram n'a plus de jeton enregistré. Reconnectez-le.");
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("vault_read_secret", { secret_id: credentialReference });
  if (error || !data) throw new Error("Jeton du bot Telegram illisible (Vault).");
  return data as string;
}

/** Bot + client API de l'organisation (`botRowId` absent = bot principal). */
export async function getTelegramBotClient(organizationId: string, botRowId?: string | null): Promise<{ bot: TelegramBotRow; client: TelegramMessagingClient }> {
  const supabase = getSupabaseServiceClient();
  let query = supabase.from("telegram_bots").select(BOT_COLUMNS).eq("organization_id", organizationId).eq("status", "connected");
  query = botRowId ? query.eq("id", botRowId) : query.order("is_primary", { ascending: false }).order("created_at", { ascending: true }).limit(1);
  const { data, error } = await query;
  if (error) throw new Error(`Erreur lecture des bots Telegram: ${error.message}`);
  const bot = (data?.[0] ?? null) as TelegramBotRow | null;
  if (!bot) throw new NotFoundError("Bot Telegram introuvable ou déconnecté.");
  return { bot, client: new TelegramMessagingClient(await readBotToken(bot.credential_reference)) };
}

/**
 * Valide le jeton (`getMe` réel), refuse un bot déjà rattaché à une AUTRE
 * organisation, applique le plafond de bots à une NOUVELLE connexion,
 * stocke le jeton en Vault, génère un secret de webhook propre à ce bot et
 * enregistre le webhook (`setWebhook` doit réussir pour que le bot soit
 * `connected`).
 */
export async function connectTelegramBot(
  organizationId: string,
  actorUserId: string,
  botToken: string,
): Promise<{ botUsername: string; botRowId: string }> {
  const trimmedToken = botToken.trim();
  if (!trimmedToken) throw new ValidationError("Le jeton du bot est requis.");

  const client = new TelegramMessagingClient(trimmedToken);
  let me: { id: number; username: string; first_name?: string };
  try {
    const result = await client.getMe();
    if (!result.username) throw new Error("no_username");
    me = { id: result.id, username: result.username, first_name: (result as { first_name?: string }).first_name };
  } catch {
    throw new ValidationError("Jeton Telegram invalide. Vérifiez que vous avez bien copié le jeton complet fourni par @BotFather.");
  }

  const supabase = getSupabaseServiceClient();

  // Un même bot ne peut servir qu'UNE organisation (un bot = un webhook Telegram).
  const { data: otherOrg, error: otherOrgError } = await supabase
    .from("telegram_bots")
    .select("id")
    .eq("bot_id", me.id)
    .eq("status", "connected")
    .neq("organization_id", organizationId)
    .limit(1);
  if (otherOrgError) throw new Error(`Erreur lecture des bots Telegram: ${otherOrgError.message}`);
  if (otherOrg && otherOrg.length > 0) throw new ValidationError("Ce bot est déjà connecté à une autre organisation.");

  const { data: existing, error: existingError } = await supabase
    .from("telegram_bots")
    .select("id, credential_reference, is_primary, status")
    .eq("organization_id", organizationId)
    .eq("bot_username", me.username)
    .maybeSingle();
  if (existingError) throw new Error(`Erreur lecture des bots Telegram: ${existingError.message}`);

  // Reconnecter un bot déjà connu ne consomme pas de quota ; un NOUVEAU bot, si.
  if (!existing || existing.status !== "connected") {
    const entitlement = await canUseFeature(organizationId, "telegram_bots", 1);
    if (!entitlement.allowed) {
      throw new QuotaExceededError(
        entitlement.limit === 0 ? "Telegram n'est pas inclus dans votre offre." : `La limite de bots Telegram de votre offre est atteinte (${entitlement.limit}).`,
      );
    }
  }

  let secretReference: string;
  let createdSecret = false;
  if (existing?.credential_reference) {
    const { error: vaultError } = await supabase.rpc("vault_update_secret", { secret_id: existing.credential_reference, new_secret_value: trimmedToken });
    if (vaultError) throw new Error(`Erreur mise à jour du secret: ${vaultError.message}`);
    secretReference = existing.credential_reference;
  } else {
    const { data: newSecretId, error: vaultError } = await supabase.rpc("vault_create_secret", {
      secret_value: trimmedToken,
      secret_name: `messaging:telegram:${organizationId}:${me.id}`,
    });
    if (vaultError || !newSecretId) throw new Error(`Erreur création du secret: ${vaultError?.message}`);
    secretReference = newSecretId as string;
    createdSecret = true;
  }

  // Régénérés à CHAQUE (re)connexion : une ancienne URL de webhook ne doit jamais rester valide.
  const webhookPathToken = randomBytes(24).toString("hex");
  const webhookSecret = randomBytes(32).toString("hex");
  const webhookUrl = `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/telegram/tenant/${webhookPathToken}`;
  try {
    await client.setWebhook(webhookUrl, webhookSecret);
  } catch (err) {
    if (createdSecret) await supabase.rpc("vault_delete_secret", { secret_id: secretReference });
    throw new Error(`Le jeton est valide mais l'enregistrement du webhook a échoué : ${err instanceof Error ? err.message : err}`);
  }

  // Premier bot connecté = bot principal (index unique partiel : un seul principal par organisation).
  const { count: primaryCount } = await supabase
    .from("telegram_bots")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("status", "connected")
    .eq("is_primary", true);
  const isPrimary = existing?.status === "connected" ? Boolean(existing.is_primary) : (primaryCount ?? 0) === 0;

  const { data: saved, error: upsertError } = await supabase
    .from("telegram_bots")
    .upsert(
      {
        organization_id: organizationId,
        bot_id: me.id,
        bot_username: me.username,
        bot_name: me.first_name ?? null,
        credential_reference: secretReference,
        webhook_path_token: webhookPathToken,
        webhook_secret: webhookSecret,
        status: "connected",
        is_primary: isPrimary,
      },
      { onConflict: "organization_id,bot_username" },
    )
    .select("id")
    .single();
  if (upsertError || !saved) throw new Error(`Erreur écriture du bot Telegram: ${upsertError?.message}`);

  await writeAdminAuditLog({
    actorUserId,
    organizationId,
    action: "TELEGRAM_CHANNEL_CONNECTED",
    entityType: "telegram_bot",
    afterState: { botUsername: me.username },
  });
  return { botUsername: me.username, botRowId: saved.id as string };
}

/** Alias historique (anciens appelants mono-bot). */
export async function connectTelegramChannel(organizationId: string, actorUserId: string, botToken: string): Promise<{ botUsername: string }> {
  const { botUsername } = await connectTelegramBot(organizationId, actorUserId, botToken);
  return { botUsername };
}

/** Déconnecte UN bot : webhook supprimé, jeton retiré de Vault, destinations du bot désactivées, principal ré-attribué. */
export async function disconnectTelegramBot(organizationId: string, actorUserId: string, botRowId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data: bot, error } = await supabase.from("telegram_bots").select(BOT_COLUMNS).eq("id", botRowId).eq("organization_id", organizationId).maybeSingle();
  if (error) throw new Error(`Erreur lecture du bot Telegram: ${error.message}`);
  if (!bot) throw new NotFoundError("Bot Telegram introuvable.");
  const row = bot as TelegramBotRow;

  // Best-effort : le bot a pu être révoqué côté BotFather — jamais bloquant.
  if (row.credential_reference) {
    try {
      const token = await readBotToken(row.credential_reference);
      await new TelegramMessagingClient(token).deleteWebhook();
    } catch (err) {
      console.warn(`disconnectTelegramBot: échec deleteWebhook (org ${organizationId}):`, err);
    }
    await supabase.rpc("vault_delete_secret", { secret_id: row.credential_reference }).then(undefined, () => undefined);
  }

  const { error: updateError } = await supabase
    .from("telegram_bots")
    .update({ status: "disconnected", credential_reference: null, is_primary: false })
    .eq("id", botRowId)
    .eq("organization_id", organizationId);
  if (updateError) throw new Error(`Erreur mise à jour du bot Telegram: ${updateError.message}`);

  await supabase.from("telegram_destinations").update({ status: "disabled", error_message: "Bot déconnecté" }).eq("bot_id", botRowId).eq("organization_id", organizationId);

  if (row.is_primary) {
    const { data: next } = await supabase
      .from("telegram_bots")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("status", "connected")
      .order("created_at", { ascending: true })
      .limit(1);
    if (next?.[0]) await supabase.from("telegram_bots").update({ is_primary: true }).eq("id", next[0].id);
  }

  await writeAdminAuditLog({ actorUserId, organizationId, action: "TELEGRAM_CHANNEL_DISCONNECTED", entityType: "telegram_bot", afterState: { botUsername: row.bot_username } });
}

/** Alias historique : déconnecte TOUS les bots de l'organisation. */
export async function disconnectTelegramChannel(organizationId: string, actorUserId: string): Promise<void> {
  const bots = await listTelegramBots(organizationId);
  if (bots.length === 0) throw new NotFoundError("Aucun canal Telegram connecté pour cette organisation.");
  for (const bot of bots) await disconnectTelegramBot(organizationId, actorUserId, bot.id);
}

/**
 * Ré-enregistre le webhook d'un bot avec l'URL et le secret EXISTANTS, en
 * ajoutant les mises à jour `my_chat_member` (enregistrement automatique des
 * canaux/groupes) aux bots connectés avant le lot O.
 */
export async function resyncTelegramBotWebhook(organizationId: string, botRowId: string): Promise<void> {
  const { bot, client } = await getTelegramBotClient(organizationId, botRowId);
  await client.setWebhook(`${env.NEXT_PUBLIC_APP_URL}/api/webhooks/telegram/tenant/${bot.webhook_path_token}`, bot.webhook_secret);
}
