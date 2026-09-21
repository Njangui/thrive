import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import type { TelegramChat, TelegramChatMemberUpdated } from "@/infrastructure/providers/messaging/telegram/types";
import { NotFoundError, QuotaExceededError, ValidationError } from "@/lib/errors";
import { canUseFeature } from "./entitlements-service";
import { notifyOrgAdmins } from "./notification-service";
import { getTelegramBotClient } from "./telegram-channel-service";

/**
 * Lot O — canaux et groupes Telegram ENREGISTRÉS (quotas cumulés).
 *
 *  - Canal (`channel`)  : diffusion à sens unique — le bot doit y être ADMINISTRATEUR.
 *  - Groupe (`group`)   : groupes et supergroupes — le bot doit en être membre.
 *
 * Discover 1 canal + 1 groupe · Starter 3 + 2 · Pro 12 + 8
 * (`telegram_channels` / `telegram_groups`). Une destination s'enregistre
 * soit à la main (`@nom` ou identifiant), soit AUTOMATIQUEMENT quand le bot
 * est ajouté au canal/groupe (mise à jour `my_chat_member`).
 */
export type TelegramDestinationKind = "channel" | "group";

export const TELEGRAM_DESTINATION_QUOTA_KEY: Record<TelegramDestinationKind, string> = {
  channel: "telegram_channels",
  group: "telegram_groups",
};

export const TELEGRAM_DESTINATION_LABEL: Record<TelegramDestinationKind, string> = { channel: "canal", group: "groupe" };

export function classifyTelegramChat(type: string): TelegramDestinationKind | null {
  if (type === "channel") return "channel";
  if (type === "group" || type === "supergroup") return "group";
  return null;
}

/** Le bot peut-il publier ? Canal : administrateur (ou créateur) autorisé à publier ; groupe : membre actif. */
export function canBotPostIn(kind: TelegramDestinationKind, status: string, canPostMessages?: boolean): boolean {
  if (kind === "channel") return (status === "administrator" && canPostMessages !== false) || status === "creator";
  return status === "member" || status === "administrator" || status === "creator";
}

/** `@nom`, `nom`, `https://t.me/nom` ou identifiant numérique (`-100…`) → forme acceptée par l'API Telegram. */
export function normalizeTelegramChatRef(input: string): string {
  const raw = input.trim();
  if (!raw) throw new ValidationError("Renseignez le @nom du canal/groupe ou son identifiant.");
  if (/^-?\d{5,20}$/.test(raw)) return raw;
  const fromUrl = raw.match(/^(?:https?:\/\/)?(?:t|telegram)\.me\/([A-Za-z][A-Za-z0-9_]{4,31})\/?$/i);
  const username = (fromUrl ? fromUrl[1] : raw.replace(/^@/, "")) as string;
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)) {
    throw new ValidationError("Nom de canal/groupe invalide. Exemple : @ma_boutique ou l'identifiant numérique.");
  }
  return `@${username}`;
}

export interface TelegramDestination {
  id: string;
  botId: string;
  botUsername: string | null;
  chatId: string;
  kind: TelegramDestinationKind;
  title: string | null;
  username: string | null;
  status: "active" | "disabled" | "error";
  errorMessage: string | null;
}

export async function listTelegramDestinations(organizationId: string, options: { activeOnly?: boolean } = {}): Promise<TelegramDestination[]> {
  const supabase = getSupabaseServiceClient();
  let query = supabase
    .from("telegram_destinations")
    .select("id, bot_id, chat_id, chat_type, title, username, status, error_message, telegram_bots(bot_username)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (options.activeOnly) query = query.eq("status", "active");
  const { data, error } = await query;
  if (error) throw new Error(`Erreur lecture des destinations Telegram: ${error.message}`);
  return (data ?? []).map((row) => {
    const bot = row.telegram_bots as { bot_username?: string } | { bot_username?: string }[] | null;
    const botUsername = Array.isArray(bot) ? bot[0]?.bot_username : bot?.bot_username;
    return {
      id: row.id as string,
      botId: row.bot_id as string,
      botUsername: botUsername ?? null,
      chatId: row.chat_id as string,
      kind: row.chat_type as TelegramDestinationKind,
      title: (row.title as string | null) ?? null,
      username: (row.username as string | null) ?? null,
      status: row.status as TelegramDestination["status"],
      errorMessage: (row.error_message as string | null) ?? null,
    };
  });
}

async function assertDestinationQuota(organizationId: string, kind: TelegramDestinationKind): Promise<void> {
  const entitlement = await canUseFeature(organizationId, TELEGRAM_DESTINATION_QUOTA_KEY[kind], 1);
  if (!entitlement.allowed) {
    const label = TELEGRAM_DESTINATION_LABEL[kind];
    throw new QuotaExceededError(
      entitlement.limit === 0
        ? `Les ${label}s Telegram ne sont pas inclus dans votre offre.`
        : `La limite de ${entitlement.limit} ${label}${entitlement.limit > 1 ? "s" : ""} Telegram de votre offre est atteinte.`,
    );
  }
}

async function upsertDestination(
  organizationId: string,
  botRowId: string,
  chat: TelegramChat,
  kind: TelegramDestinationKind,
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const chatId = String(chat.id);
  const { data: existing, error: existingError } = await supabase
    .from("telegram_destinations")
    .select("id, chat_type, status")
    .eq("organization_id", organizationId)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (existingError) throw new Error(`Erreur lecture des destinations Telegram: ${existingError.message}`);

  // Ré-enregistrer une destination déjà connue (ex: bot ré-ajouté) ne consomme pas de quota.
  if (!existing || existing.status !== "active") await assertDestinationQuota(organizationId, kind);

  const { error } = await supabase.from("telegram_destinations").upsert(
    {
      organization_id: organizationId,
      bot_id: botRowId,
      chat_id: chatId,
      chat_type: kind,
      title: chat.title ?? null,
      username: chat.username ?? null,
      status: "active",
      error_message: null,
      last_checked_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,chat_id" },
  );
  if (error) throw new Error(`Enregistrement de la destination Telegram impossible: ${error.message}`);
}

/** Enregistrement manuel : `@nom` / identifiant → le bot doit voir le chat ET pouvoir y publier. */
export async function addTelegramDestination(organizationId: string, botRowId: string, chatRef: string): Promise<{ kind: TelegramDestinationKind; title: string | null }> {
  const ref = normalizeTelegramChatRef(chatRef);
  const { bot, client } = await getTelegramBotClient(organizationId, botRowId);

  let chat: TelegramChat;
  try {
    chat = await client.getChat(ref);
  } catch {
    throw new ValidationError("Le bot n'a pas accès à ce canal/groupe. Ajoutez d'abord @" + bot.bot_username + " comme administrateur (canal) ou membre (groupe), puis réessayez.");
  }
  const kind = classifyTelegramChat(chat.type);
  if (!kind) throw new ValidationError("Seuls les canaux et les groupes Telegram peuvent recevoir des publications.");

  const botTelegramId = bot.bot_id ?? (await client.getMe()).id;
  let member;
  try {
    member = await client.getChatMember(chat.id, botTelegramId);
  } catch {
    throw new ValidationError(`Impossible de vérifier les droits de @${bot.bot_username} dans ce ${TELEGRAM_DESTINATION_LABEL[kind]}.`);
  }
  if (!canBotPostIn(kind, member.status, member.can_post_messages)) {
    throw new ValidationError(
      kind === "channel"
        ? `@${bot.bot_username} doit être administrateur du canal avec le droit de publier des messages.`
        : `@${bot.bot_username} n'est pas membre de ce groupe.`,
    );
  }

  await upsertDestination(organizationId, botRowId, chat, kind);
  return { kind, title: chat.title ?? null };
}

export async function removeTelegramDestination(organizationId: string, destinationId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("telegram_destinations").delete().eq("id", destinationId).eq("organization_id", organizationId).select("id").maybeSingle();
  if (error) throw new Error(`Suppression de la destination impossible: ${error.message}`);
  if (!data) throw new NotFoundError("Destination Telegram introuvable.");
}

/**
 * Webhook `my_chat_member` : le bot vient d'être ajouté / retiré d'un canal
 * ou d'un groupe. Ajout autorisé → destination enregistrée automatiquement
 * (dans la limite du plan, sinon les administrateurs sont prévenus) ;
 * retrait → destination désactivée.
 */
export async function handleBotMembershipUpdate(
  organizationId: string,
  botRowId: string,
  update: TelegramChatMemberUpdated,
): Promise<"registered" | "disabled" | "quota" | "ignored"> {
  const kind = classifyTelegramChat(update.chat.type);
  if (!kind) return "ignored";
  const status = update.new_chat_member.status;
  const supabase = getSupabaseServiceClient();

  if (status === "left" || status === "kicked") {
    await supabase
      .from("telegram_destinations")
      .update({ status: "disabled", error_message: "Le bot a été retiré de ce chat." })
      .eq("organization_id", organizationId)
      .eq("chat_id", String(update.chat.id))
      .eq("bot_id", botRowId);
    return "disabled";
  }

  if (!canBotPostIn(kind, status, update.new_chat_member.can_post_messages)) return "ignored";

  try {
    await upsertDestination(organizationId, botRowId, update.chat, kind);
    return "registered";
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      await notifyOrgAdmins({
        organizationId,
        title: "Canal Telegram non enregistré.",
        body: `${update.chat.title ?? "Ce chat"} n'a pas été ajouté : ${error.message}`,
        priority: "normal",
      }).catch(() => undefined);
      return "quota";
    }
    throw error;
  }
}
