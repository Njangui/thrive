import type {
  MessagingProvider,
  NormalizedContact,
  NormalizedConversation,
  OutboundMessage,
  SendMessageResult,
} from "@/domain/ports/messaging-provider";
import { TelegramMessagingClient } from "./client";

/**
 * Implémentation Telegram du port MessagingProvider — canal CLIENT
 * (un tenant connecte son propre bot pour que ses clients lui écrivent),
 * ENTIÈREMENT indépendant de ZernioAdapter : aucun import croisé, aucune
 * forme de données partagée, aucune supposition sur la présence de
 * l'autre. Un tenant peut connecter Zernio, Telegram, les deux, ou
 * aucun — voir registry.ts::getMessagingProvider.
 *
 * Aucun service applicatif ne doit importer TelegramMessagingClient
 * directement — uniquement cet adapter, obtenu via le ProviderRegistry
 * (même règle que ZernioAdapter, voir domain/ports/messaging-provider.ts).
 */
export class TelegramMessagingAdapter implements MessagingProvider {
  readonly providerName = "telegram";

  constructor(private readonly client: TelegramMessagingClient) {}

  async sendMessage(_organizationId: string, message: OutboundMessage): Promise<SendMessageResult> {
    // CONFIRMÉ (core.telegram.org/bots/api#sendmessage) : `chat_id` seul
    // suffit à envoyer un message à un chat privé déjà initié par
    // l'utilisateur (contrairement à Zernio, aucun conversationId séparé
    // n'est requis) — `message.to` porte déjà ce chat_id (voir mapper.ts,
    // externalContactId = externalThreadId = chat.id).
    const sent = await this.client.sendMessage({ chat_id: message.to, text: message.content });
    return { providerMessageId: String(sent.message_id), status: "sent" };
  }

  async getConversation(_organizationId: string, externalThreadId: string): Promise<NormalizedConversation | null> {
    // Comme ZernioAdapter : le thread est déjà connu depuis le webhook
    // (mapper.ts), aucune resynchronisation nécessaire pour le workflow
    // central.
    return { externalThreadId, channel: "telegram" };
  }

  async getContact(_organizationId: string, externalContactId: string): Promise<NormalizedContact | null> {
    // CONFIRMÉ (core.telegram.org/bots/api) : il n'existe AUCUN endpoint
    // pour interroger le profil d'un utilisateur arbitraire par id — un
    // bot ne connaît un utilisateur qu'à travers les messages qu'il lui
    // envoie (restriction de confidentialité Telegram documentée). Le
    // nom/l'identité viennent donc déjà du payload webhook (mapper.ts),
    // jamais d'un second appel réseau ici — même limitation, mêmes mots,
    // que ZernioAdapter.getContact.
    return { externalContactId };
  }

  async markAsRead(_organizationId: string, _externalMessageId: string): Promise<void> {
    // CONFIRMÉ : aucun endpoint "accusé de lecture" pour un bot Telegram
    // en chat privé — non implémenté plutôt que deviné.
  }

  /** Utilisé par telegram-channel-service.ts pour valider un jeton avant de le stocker. */
  async verifyToken(): Promise<{ botUsername: string }> {
    const me = await this.client.getMe();
    if (!me.username) throw new Error("Ce bot Telegram n'a pas de nom d'utilisateur exploitable.");
    return { botUsername: me.username };
  }
}
