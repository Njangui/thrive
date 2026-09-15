import type {
  TelegramApiResponse,
  TelegramMessage,
  TelegramSendMessageParams,
  TelegramUser,
} from "./types";

/**
 * Client bas niveau Bot API Telegram — SEUL fichier de ce projet
 * autorisé à appeler `api.telegram.org` (même règle que ZernioClient/
 * NotchPayClient pour leurs domaines respectifs). `TelegramAdapter`
 * (NotificationProvider) ET `telegram-bot-service.ts` (commandes
 * entrantes) consomment tous les deux CE client plutôt que de dupliquer
 * un appel `fetch` — un seul endroit à changer si l'API Telegram évolue.
 *
 * CONFIRMÉ (core.telegram.org/bots/api, section "Making requests") :
 * authentification par le token dans l'URL elle-même
 * (`https://api.telegram.org/bot<token>/<method>`), jamais un header —
 * à la différence de Zernio (`Authorization: Bearer`) et NotchPay
 * (`Authorization: <clé>`). Documenté ici pour ne pas ressembler à un
 * oubli si quelqu'un compare les trois clients.
 */
export class TelegramClient {
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
    // CONFIRMÉ : `ok: true` implique toujours `result` présent pour les
    // méthodes utilisées ici (sendMessage, getMe, answerCallbackQuery).
    return payload.result as T;
  }

  async sendMessage(params: TelegramSendMessageParams): Promise<TelegramMessage> {
    return this.call<TelegramMessage>("sendMessage", params as unknown as Record<string, unknown>);
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<true> {
    return this.call<true>("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
  }

  /** Vérifie que le token est valide — utilisé par le script d'installation du webhook (docs/TELEGRAM_INTEGRATION.md), jamais appelé en production. */
  async getMe(): Promise<TelegramUser> {
    return this.call<TelegramUser>("getMe", {});
  }

  /**
   * Enregistre l'URL de webhook + le secret de vérification côté
   * Telegram. Appelé UNE FOIS depuis un script d'exploitation (jamais au
   * démarrage de l'app — voir docs/TELEGRAM_INTEGRATION.md, section
   * "Installation"), pas depuis un chemin de requête utilisateur.
   */
  async setWebhook(url: string, secretToken: string): Promise<true> {
    return this.call<true>("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message", "callback_query"],
    });
  }
}
