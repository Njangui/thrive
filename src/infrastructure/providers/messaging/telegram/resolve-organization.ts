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
): Promise<{ organizationId: string; webhookSecret: string } | null> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("provider_connections")
    .select("organization_id, metadata")
    .eq("provider_type", "messaging")
    .eq("provider_name", "telegram")
    .eq("status", "connected")
    .eq("metadata->>webhookPathToken", webhookPathToken)
    .maybeSingle();

  if (error) {
    console.error(`resolveOrganizationIdByTelegramWebhookToken(${webhookPathToken}) error:`, error.message);
    return null;
  }
  if (!data) return null;

  const metadata = (data.metadata ?? {}) as { webhookSecret?: string };
  if (!metadata.webhookSecret) return null;

  return { organizationId: data.organization_id, webhookSecret: metadata.webhookSecret };
}
