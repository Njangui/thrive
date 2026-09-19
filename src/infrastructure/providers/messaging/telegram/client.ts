import type { TelegramApiResponse, TelegramFile, TelegramMessage, TelegramSendAudioParams, TelegramSendDocumentParams, TelegramSendMessageParams, TelegramSendPhotoParams, TelegramSendVideoParams, TelegramUser } from "./types";

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
