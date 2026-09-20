/**
 * Sous-ensemble de l'API Bot Telegram (core.telegram.org/bots/api) pour
 * le canal CLIENT (MessagingProvider — un tenant connecte son propre
 * bot pour que SES clients puissent lui écrire). Duplique
 * volontairement `infrastructure/providers/telegram/types.ts` (bot
 * plateforme, alertes admin/affiliés) plutôt que de le réutiliser — même
 * précédent que ce projet applique déjà entre
 * `messaging/zernio/types.ts` et `social/zernio/types.ts` (même
 * fournisseur, deux ports, deux fichiers) : un changement de forme pour
 * l'un des deux usages ne doit jamais risquer de faire dévier l'autre.
 */

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface TelegramPhotoSize { file_id: string; file_unique_id: string; width: number; height: number; file_size?: number; }
export interface TelegramDocument { file_id: string; file_unique_id: string; file_name?: string; mime_type?: string; file_size?: number; }
export interface TelegramAudio { file_id: string; file_unique_id: string; duration: number; performer?: string; title?: string; mime_type?: string; file_size?: number; }
export interface TelegramVideo { file_id: string; file_unique_id: string; width: number; height: number; duration: number; mime_type?: string; file_size?: number; }
export interface TelegramVoice { file_id: string; file_unique_id: string; duration: number; mime_type?: string; file_size?: number; }
export interface TelegramFile { file_id: string; file_unique_id: string; file_size?: number; file_path?: string; }
export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  audio?: TelegramAudio;
  video?: TelegramVideo;
  voice?: TelegramVoice;
}

/** Une "update" telle que livrée au webhook tenant. `update_id` n'est PAS globalement unique (propre à chaque bot tenant) — voir resolve-organization.ts/webhook-handler.ts pour la clé d'idempotence réellement utilisée. */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramSendMessageParams {
  chat_id: number | string;
  text: string;
  parse_mode?: "Markdown" | "HTML";
}

export interface TelegramSendPhotoParams {
  chat_id: number | string;
  photo: string;
  caption?: string;
}

export interface TelegramSendVideoParams {
  chat_id: number | string;
  video: string;
  caption?: string;
}

export interface TelegramSendAudioParams {
  chat_id: number | string;
  audio: string;
  caption?: string;
}

export interface TelegramSendVoiceParams {
  chat_id: number | string;
  /** OGG/OPUS, MP3 ou M4A uniquement (contrainte Bot API) — un WebM est refusé. */
  voice: string;
  caption?: string;
}

export interface TelegramSendDocumentParams {
  chat_id: number | string;
  document: string;
  caption?: string;
}

export interface TelegramGetFileResponse { ok: boolean; result?: TelegramFile; description?: string; error_code?: number; }

export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}
