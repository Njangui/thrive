import type { NotificationProvider, NotificationRequest } from "@/domain/ports/notification-provider";
import { TelegramClient } from "./client";

/**
 * Premier (et unique, à ce lot) adapter concret du port
 * `NotificationProvider` (domain/ports/notification-provider.ts) — un
 * port posé de longue date mais jamais implémenté jusqu'ici (aucune
 * autre classe de ce projet ne l'implémente, voir la note de tête de
 * `notification-service.ts`). Sert exclusivement à alerter l'OPÉRATEUR
 * plateforme (nouvelle candidature affilié, fraude détectée, demande de
 * paiement) — jamais le client final d'un tenant, qui reste sur
 * MessagingProvider/Zernio, entièrement séparé.
 *
 * `recipientUserId`/`relatedEntityType`/`relatedEntityId` du port ne
 * sont pas exploités ici (pas de résolution "quel chat Telegram pour cet
 * utilisateur" — un seul chat d'alerte plateforme,
 * `TELEGRAM_ADMIN_CHAT_ID`) : le port a été pensé pour un futur
 * multi-destinataire par utilisateur, cet adapter V1 reste volontairement
 * plus simple (un seul canal d'alerte groupé), documenté ici plutôt que
 * de sur-implémenter une résolution non demandée.
 */
export class TelegramAdapter implements NotificationProvider {
  readonly providerName = "telegram";

  constructor(
    private readonly client: TelegramClient,
    private readonly adminChatId: string,
  ) {}

  async send(request: NotificationRequest): Promise<{ delivered: boolean }> {
    const text = `*${escapeMarkdown(request.title)}*\n${escapeMarkdown(request.body)}`;

    try {
      await this.client.sendMessage({
        chat_id: this.adminChatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      });
      return { delivered: true };
    } catch (error) {
      // Best-effort par contrat du port (voir notification-service.ts,
      // même philosophie que sendPush) : un canal secondaire qui échoue
      // ne doit jamais remonter une exception à l'appelant.
      console.warn("[telegram] échec d'envoi de notification admin:", error);
      return { delivered: false };
    }
  }
}

/**
 * Markdown Telegram (mode "Markdown", pas "MarkdownV2") échappe peu de
 * caractères mais `_`, `*`, `` ` ``, `[` cassent le rendu s'ils
 * apparaissent dans un texte utilisateur non prévu pour du markup (ex:
 * un nom d'affilié contenant un underscore). Échappement minimal plutôt
 * que de basculer vers MarkdownV2 (qui exige d'échapper une vingtaine de
 * caractères) — le contenu envoyé ici est toujours du texte
 * informatif court, pas du markup riche.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*`[])/g, "\\$1");
}
