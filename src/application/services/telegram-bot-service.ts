import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { TelegramClient } from "@/infrastructure/providers/telegram/client";
import type { TelegramMessage } from "@/infrastructure/providers/telegram/types";
import { env } from "@/lib/env";
import { getAffiliateDashboardStats } from "./affiliate-service";

/**
 * Commandes du bot Telegram PLATEFORME (le même bot que
 * `TelegramAdapter`/`NotificationProvider`, utilisé ici pour les
 * interactions ENTRANTES — liaison de compte affilié, consultation de
 * stats). ENTIÈREMENT indépendant du canal client tenant
 * (messaging/telegram/*) : bot différent, jeton différent
 * (`TELEGRAM_BOT_TOKEN` plateforme vs le jeton propre à chaque tenant),
 * aucun import croisé.
 */

function requireClient(): TelegramClient {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN non configuré — le bot Telegram plateforme est désactivé.");
  }
  return new TelegramClient(env.TELEGRAM_BOT_TOKEN);
}

export async function handlePlatformBotMessage(message: TelegramMessage): Promise<void> {
  const client = requireClient();
  const chatId = message.chat.id;
  const text = (message.text ?? "").trim();

  if (text.startsWith("/start")) {
    const token = text.split(/\s+/)[1]?.trim();
    if (!token) {
      await client.sendMessage({
        chat_id: chatId,
        text: "👋 Bienvenue sur le bot tokoo .\n\nPour connecter ce chat à votre compte affilié, utilisez le bouton \"Connecter Telegram\" depuis votre tableau de bord.",
      });
      return;
    }
    await linkAffiliateChat(client, token, chatId, message.from?.id, message.from?.username);
    return;
  }

  if (text === "/mystats" || text === "/stats") {
    await replyWithStats(client, chatId);
    return;
  }

  if (text === "/help" || text === "/aide") {
    await client.sendMessage({
      chat_id: chatId,
      text: "Commandes disponibles :\n/mystats — vos statistiques d'affiliation (clics, filleuls, solde)\n/help — cette aide",
    });
    return;
  }

  await client.sendMessage({ chat_id: chatId, text: "Commande non reconnue. Tapez /help pour la liste des commandes." });
}

async function linkAffiliateChat(
  client: TelegramClient,
  token: string,
  chatId: number,
  telegramUserId: number | undefined,
  telegramUsername: string | undefined,
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data: link, error } = await supabase
    .from("telegram_links")
    .select("id, status, link_token_expires_at")
    .eq("link_token", token)
    .eq("purpose", "affiliate")
    .maybeSingle();

  if (error || !link) {
    await client.sendMessage({ chat_id: chatId, text: "Lien de connexion invalide. Générez-en un nouveau depuis votre tableau de bord." });
    return;
  }
  if (link.status !== "pending") {
    await client.sendMessage({ chat_id: chatId, text: "Ce lien de connexion a déjà été utilisé." });
    return;
  }
  if (new Date(link.link_token_expires_at).getTime() < Date.now()) {
    await client.sendMessage({ chat_id: chatId, text: "Ce lien de connexion a expiré. Générez-en un nouveau depuis votre tableau de bord." });
    return;
  }

  const { error: updateError } = await supabase
    .from("telegram_links")
    .update({
      chat_id: chatId,
      telegram_user_id: telegramUserId ?? null,
      telegram_username: telegramUsername ?? null,
      status: "linked",
      linked_at: new Date().toISOString(),
    })
    .eq("id", link.id)
    .eq("status", "pending"); // idempotence si /start est reçu deux fois.

  if (updateError) {
    await client.sendMessage({ chat_id: chatId, text: "Une erreur est survenue lors de la connexion. Réessayez." });
    return;
  }

  await client.sendMessage({
    chat_id: chatId,
    text: "✅ Compte connecté ! Vous recevrez ici vos notifications de commission. Tapez /mystats à tout moment pour vos statistiques.",
  });
}

async function replyWithStats(client: TelegramClient, chatId: number): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data: link } = await supabase
    .from("telegram_links")
    .select("affiliate_id")
    .eq("chat_id", chatId)
    .eq("purpose", "affiliate")
    .eq("status", "linked")
    .maybeSingle();

  if (!link?.affiliate_id) {
    await client.sendMessage({
      chat_id: chatId,
      text: "Ce chat n'est lié à aucun compte affilié. Connectez-le depuis votre tableau de bord.",
    });
    return;
  }

  const stats = await getAffiliateDashboardStats(link.affiliate_id);
  await client.sendMessage({
    chat_id: chatId,
    text:
      `📊 Vos statistiques\n\n` +
      `Clics : ${stats.totalClicks}\n` +
      `Filleuls : ${stats.totalReferrals}\n` +
      `Conversions : ${stats.totalConversions}\n\n` +
      `💰 Solde\n` +
      `En attente : ${stats.balance.pendingHoldFcfa} FCFA\n` +
      `Disponible : ${stats.balance.availableFcfa} FCFA\n` +
      `Déjà versé : ${stats.balance.paidFcfa} FCFA`,
  });
}
