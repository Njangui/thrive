import type { TelegramApiResponse, TelegramMessage, TelegramSendMessageParams, TelegramUser } from "./types";

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

  /** Valide le jeton fourni par le tenant AVANT de le stocker (voir telegram-channel-service.ts::connectTelegramChannel) — un token invalide échoue ici avec un message clair plutôt qu'au premier message client. */
  async getMe(): Promise<TelegramUser> {
    return this.call<TelegramUser>("getMe", {});
  }

  /** Enregistre le webhook DÉDIÉ à ce tenant (URL + secret propres à cette connexion) — voir telegram-channel-service.ts. */
  async setWebhook(url: string, secretToken: string): Promise<true> {
    return this.call<true>("setWebhook", { url, secret_token: secretToken, allowed_updates: ["message"] });
  }

  async deleteWebhook(): Promise<true> {
    return this.call<true>("deleteWebhook", {});
  }
}
