import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

/**
 * Un webhook Telegram (canal client) arrive sur une URL PROPRE À CHAQUE
 * TENANT — `/api/webhooks/telegram/tenant/[token]` — car Telegram n'a
 * aucun champ de type "account.id" dans son payload pour identifier
 * quel bot a reçu l'update (chaque bot a sa propre URL de webhook,
 * enregistrée une fois via `setWebhook`, voir
 * telegram-channel-service.ts). Le `[token]` de l'URL est un identifiant
 * opaque généré à la connexion (`provider_connections.metadata.
 * webhookPathToken`), jamais l'organizationId lui-même (éviter un id
 * énumérable dans une URL publique).
 *
 * Renvoie aussi `webhookSecret` (metadata.webhookSecret, texte en clair
 * — PAS le token du bot, qui lui reste en Vault) dans le MÊME
 * aller-retour, pour que le webhook-handler vérifie le header
 * `X-Telegram-Bot-Api-Secret-Token` sans requête supplémentaire.
 */
export async function resolveOrganizationIdByTelegramWebhookToken(
  webhookPathToken: string,
): Promise<{ organizationId: string; webhookSecret: string; botId: string; botTelegramId: number; botUsername: string } | null> {
  const supabase = getSupabaseServiceClient();

  // Lot O : un bot par ligne de `telegram_bots` (plusieurs bots par organisation).
  const { data, error } = await supabase
    .from("telegram_bots")
    .select("id, organization_id, webhook_secret, bot_id, bot_username")
    .eq("status", "connected")
    .eq("webhook_path_token", webhookPathToken)
    .maybeSingle();

  if (error) {
    console.error(`resolveOrganizationIdByTelegramWebhookToken(${webhookPathToken}) error:`, error.message);
    return null;
  }
  if (!data || !data.webhook_secret) return null;

  return {
    organizationId: data.organization_id as string,
    webhookSecret: data.webhook_secret as string,
    botId: data.id as string,
    // NB : distinct de `botId` ci-dessus (l'UUID de la ligne) — `bot_id` est
    // l'identifiant numérique Telegram du bot (celui renvoyé par getMe(),
    // voir telegram-channel-service.ts::connectTelegramBot). Utilisé UNIQUEMENT
    // par mapper.ts::isDirectedAtBot pour détecter une réponse directe au bot.
    botTelegramId: data.bot_id as number,
    botUsername: data.bot_username as string,
  };
}
