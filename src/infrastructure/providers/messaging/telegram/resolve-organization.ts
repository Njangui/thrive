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
): Promise<{ organizationId: string; webhookSecret: string; botId: string; botTelegramId: number | null; botUsername: string } | null> {
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
    // Extension groupe : identité Telegram du bot lui-même (pas notre id
    // interne `botId` ci-dessus), pour détecter mention/réponse dans un
    // groupe — voir mapper.ts::isDirectedAtBot. `bot_id` (colonne
    // `telegram_bots.bot_id`, bigint) est nullable en base : un bot
    // connecté avant l'introduction de ce champ peut ne pas l'avoir —
    // dans ce cas `directedAtBot` retombe uniquement sur la détection par
    // commande/mention (jamais sur la réponse-au-bot), jamais une erreur.
    botTelegramId: (data.bot_id as number | null) ?? null,
    botUsername: data.bot_username as string,
  };
}