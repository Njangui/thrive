/**
 * Sous-ensemble de l'API Bot Telegram réellement utilisé par ce projet
 * (core.telegram.org/bots/api). Volontairement partiel : seuls les
 * champs consommés par telegram-bot-service.ts/adapter.ts sont typés,
 * pas l'intégralité du schéma Telegram (même discipline que
 * `notchpay/types.ts` — un type "juste assez large").
 *
 * Fichier ENTIÈREMENT indépendant de
 * `infrastructure/providers/messaging/zernio/types.ts` — aucun import
 * croisé, aucune forme partagée (les deux providers ne modélisent pas le
 * même domaine : Zernio normalise WhatsApp/réseaux sociaux pour un
 * tenant, Telegram ici sert uniquement les affiliés/l'opérateur
 * plateforme).
 */

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

/**
 * Une "update" telle que livrée au webhook. `update_id` est la clé
 * d'idempotence (voir webhook-handler.ts) — CONFIRMÉ strictement
 * croissant par bot (core.telegram.org/bots/api#getting-updates), donc
 * fiable comme `external_event_id` dans `webhook_events`.
 */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramSendMessageParams {
  chat_id: number | string;
  text: string;
  parse_mode?: "Markdown" | "HTML";
  disable_web_page_preview?: boolean;
  reply_markup?: {
    inline_keyboard?: { text: string; url?: string; callback_data?: string }[][];
  };
}

/** Enveloppe de réponse commune à tous les appels `api.telegram.org/bot<token>/<method>`. */
export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}
