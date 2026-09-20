import type { TelegramApiResponse, TelegramFile, TelegramMessage, TelegramSendAudioParams, TelegramSendDocumentParams, TelegramSendMessageParams, TelegramSendPhotoParams, TelegramSendVideoParams, TelegramSendVoiceParams, TelegramUser } from "./types";

/**
 * Client bas niveau Bot API Telegram pour le canal CLIENT — un tenant
 * connecte SON PROPRE bot (jeton créé via @BotFather), jamais le bot
 * plateforme (`infrastructure/providers/telegram/client.ts`, utilisé
 * uniquement pour les alertes admin/affiliés). Deux fichiers distincts
 * pour deux bots/tokens/portées distincts, même si le protocole HTTP
 * sous-jacent est identique — voir types.ts pour le raisonnement complet.
 */
export class TelegramMessagingClient {
  private readonly baseUrl: string;

  constructor(private readonly botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as TelegramApiResponse<T>;
    if (!payload.ok) {
      throw new Error(
        `Telegram API ${method} a échoué (${payload.error_code ?? response.status}): ${payload.description ?? "erreur inconnue"}`,
      );
    }
    return payload.result as T;
  }

  /**
   * Envoi par TÉLÉVERSEMENT (multipart/form-data) — limites Bot API : 50 Mo
   * (10 Mo pour une photo). Contrairement à l'envoi par URL (20 Mo, formats
   * de documents restreints), le fichier part de notre serveur.
   */
  private async callMultipart<T>(
    method: string,
    fields: Record<string, string>,
    fileField: string,
    file: { data: Uint8Array; fileName: string; contentType: string },
  ): Promise<T> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append(fileField, new Blob([file.data as unknown as BlobPart], { type: file.contentType }), file.fileName);

    const response = await fetch(`${this.baseUrl}/${method}`, { method: "POST", body: form });
    const payload = (await response.json()) as TelegramApiResponse<T>;
    if (!payload.ok) {
      throw new Error(
        `Telegram API ${method} a échoué (${payload.error_code ?? response.status}): ${payload.description ?? "erreur inconnue"}`,
      );
    }
    return payload.result as T;
  }

  async sendFileUpload(
    kind: "photo" | "video" | "audio" | "voice" | "document",
    chatId: number | string,
    file: { data: Uint8Array; fileName: string; contentType: string },
    caption?: string,
  ): Promise<TelegramMessage> {
    const method = { photo: "sendPhoto", video: "sendVideo", audio: "sendAudio", voice: "sendVoice", document: "sendDocument" }[kind];
    return this.callMultipart<TelegramMessage>(
      method,
      {
        chat_id: String(chatId),
        ...(caption ? { caption } : {}),
        ...(kind === "video" ? { supports_streaming: "true" } : {}),
      },
      kind,
      file,
    );
  }

  async sendMessage(params: TelegramSendMessageParams): Promise<TelegramMessage> {
    return this.call<TelegramMessage>("sendMessage", params as unknown as Record<string, unknown>);
  }

  async sendPhoto(params: TelegramSendPhotoParams): Promise<TelegramMessage> {
    return this.call<TelegramMessage>("sendPhoto", params as unknown as Record<string, unknown>);
  }

  async sendVideo(params: TelegramSendVideoParams): Promise<TelegramMessage> {
    return this.call<TelegramMessage>("sendVideo", params as unknown as Record<string, unknown>);
  }

  async sendAudio(params: TelegramSendAudioParams): Promise<TelegramMessage> {
    return this.call<TelegramMessage>("sendAudio", params as unknown as Record<string, unknown>);
  }

  async sendVoice(params: TelegramSendVoiceParams): Promise<TelegramMessage> {
    return this.call<TelegramMessage>("sendVoice", params as unknown as Record<string, unknown>);
  }

  async sendDocument(params: TelegramSendDocumentParams): Promise<TelegramMessage> {
    return this.call<TelegramMessage>("sendDocument", params as unknown as Record<string, unknown>);
  }

  /** Valide le jeton fourni par le tenant AVANT de le stocker (voir telegram-channel-service.ts::connectTelegramChannel) — un token invalide échoue ici avec un message clair plutôt qu'au premier message client. */
  async getMe(): Promise<TelegramUser> {
    return this.call<TelegramUser>("getMe", {});
  }

  async getFile(fileId: string): Promise<TelegramFile> {
    return this.call<TelegramFile>("getFile", { file_id: fileId });
  }

  async downloadFile(filePath: string): Promise<{ data: Uint8Array; contentType: string | null }> {
    const response = await fetch(`https://api.telegram.org/file/bot${this.botToken}/${filePath}`);
    if (!response.ok) throw new Error(`Téléchargement du fichier Telegram impossible (${response.status}).`);
    return { data: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") };
  }

  /** Enregistre le webhook DÉDIÉ à ce tenant (URL + secret propres à cette connexion) — voir telegram-channel-service.ts. */
  async setWebhook(url: string, secretToken: string): Promise<true> {
    return this.call<true>("setWebhook", { url, secret_token: secretToken, allowed_updates: ["message"] });
  }

  async deleteWebhook(): Promise<true> {
    return this.call<true>("deleteWebhook", {});
  }
}
