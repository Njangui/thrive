import type { DomainEvent, MessageReceivedEvent } from "@/domain/events/domain-events";
import type { TelegramMessage, TelegramUpdate } from "./types";

/**
 * Un message texte commence-t-il par une commande (`/xxx`), mentionne-t-il
 * `@botUsername`, ou est-il une réponse directe à un message du bot
 * lui-même ? Sert UNIQUEMENT à décider, pour un message de GROUPE, s'il
 * s'adresse explicitement au bot (voir `directedAtBot` plus bas) — jamais
 * utilisé en chat privé, où tout message s'adresse forcément au bot.
 */
function isDirectedAtBot(
  message: TelegramMessage,
  botInfo?: { telegramId?: number | null; username?: string | null },
): boolean {
  if (message.reply_to_message?.from?.id != null && botInfo?.telegramId != null && message.reply_to_message.from.id === botInfo.telegramId) {
    return true;
  }
  if (!message.entities || !message.text) return false;
  return message.entities.some((entity) => {
    if (entity.type === "bot_command") return true;
    if (entity.type === "mention" && botInfo?.username) {
      const mentionText = message.text!.slice(entity.offset, entity.offset + entity.length);
      return mentionText.toLowerCase() === `@${botInfo.username}`.toLowerCase();
    }
    return false;
  });
}

/**
 * Traduit une update Telegram (canal client) en MESSAGE_RECEIVED —
 * seul endroit qui connaît la forme brute Telegram pour ce port, même
 * discipline que `messaging/zernio/mapper.ts`.
 *
 * Un chat privé Telegram n'a ni conversationId ni contactId séparés
 * (contrairement à Zernio) : `chat.id` sert IDENTIQUEMENT
 * d'`externalContactId` ET d'`externalThreadId` — c'est la même entité
 * durable côté Telegram (une conversation privée = ce chat, pour
 * toujours). `phoneE164` reste volontairement absent : un bot Telegram
 * n'a accès au numéro de l'utilisateur que s'il le partage
 * explicitement via un bouton "partager le contact" (non implémenté
 * dans ce lot) — jamais deviné.
 *
 * Extension groupe (demande explicite utilisateur, 2026-09-22) : un
 * GROUPE ou SUPERGROUPE devient désormais UNE conversation PARTAGÉE —
 * même logique `chat.id` que ci-dessus, mais `contactFullName` prend le
 * titre du groupe (stable) au lieu du nom de l'expéditeur (qui varie à
 * chaque message et écraserait le contact à chaque fois). Le nom de
 * l'expéditeur réel est conservé séparément dans `authorName`, affiché
 * par message dans le fil (voir conversation-thread-view.tsx). Un
 * CANAL (`channel`) reste exclu : ni demandé, ni possible côté Telegram
 * (les abonnés ne peuvent pas y écrire ; seuls des posts d'admin ou des
 * commentaires dans un groupe de discussion lié existent, hors scope ici).
 *
 * Dans un groupe, le bot recevra TOUT (mention, réponse, mais aussi une
 * conversation normale entre clients qui ne s'adresse pas à lui) dès que
 * le mode confidentialité Telegram est désactivé côté BotFather (ou le
 * bot admin) — réglage Telegram, hors de ce code. `directedAtBot`
 * distingue donc, panmi ce qui arrive, ce qui s'adresse explicitement au
 * bot (commande, mention, réponse à lui) : la conversation est quand même
 * enregistrée dans tous les cas pour qu'un humain garde le contexte, mais
 * seul un message `directedAtBot` déclenche la réponse automatique IA/FAQ
 * (voir route.ts::POST, `autoReplyAllowed`).
 */
export function mapTelegramUpdateToDomainEvent(
  raw: TelegramUpdate,
  organizationId: string,
  attachment?: { url: string; type: "image" | "video" | "audio" | "file"; fileName?: string; mimeType?: string; fileId?: string },
  /** Lot O : identifiant (`telegram_bots.id`) du bot qui a reçu l'update — les réponses repartent par CE bot. */
  providerAccountId?: string,
  /** Extension groupe : identité Telegram du bot lui-même (pas `providerAccountId`, qui est notre id interne), pour détecter mention/réponse. */
  botInfo?: { telegramId?: number | null; username?: string | null },
): DomainEvent | null {
  const message = raw.message;
  // CORRECTIF Lot P : la condition exigeait jusqu'ici un texte, une légende,
  // OU une pièce jointe déjà téléchargée — un message d'un type non couvert
  // par `downloadTelegramAttachmentIfPresent` (sticker, note vocale ronde,
  // sondage, position, contact partagé...) tombait dans aucun de ces trois
  // cas et était silencieusement perdu, alors même que la valeur de repli
  // `content` ci-dessous avait justement été écrite pour le couvrir. On ne
  // garde que la condition qui compte réellement : un chat identifiable.
  if (!message || !message.chat) {
    return null;
  }
  const isGroup = message.chat.type === "group" || message.chat.type === "supergroup";
  // Un CANAL reste une destination de publication pure (table
  // telegram_destinations) : ses messages ne créent ni contact ni
  // conversation. Seuls le chat PRIVÉ et, désormais, le GROUPE/SUPERGROUPE
  // deviennent des conversations clients.
  if (message.chat.type !== "private" && !isGroup) {
    return null;
  }

  const chatId = String(message.chat.id);
  const senderName = message.from
    ? [message.from.first_name, message.from.last_name].filter(Boolean).join(" ") || message.from.username
    : undefined;
  // Groupe : le "contact" représente le GROUPE entier (conversation partagée
  // choisie par l'utilisateur) — son nom doit rester stable d'un message à
  // l'autre, donc le titre du groupe, jamais le nom de qui vient d'écrire.
  const contactFullName = isGroup ? (message.chat.title ?? "Groupe Telegram") : senderName;

  const event: MessageReceivedEvent = {
    type: "MESSAGE_RECEIVED",
    organizationId,
    occurredAt: new Date(message.date * 1000).toISOString(),
    externalEventId: String(raw.update_id),
    sourceProvider: "telegram",
    payload: {
      externalContactId: chatId,
      externalThreadId: chatId,
      contactFullName,
      // CORRECTIF Lot P : repli générique quand ni texte/légende ni pièce
      // jointe téléchargée ne sont disponibles (type non géré, ou
      // téléchargement échoué côté webhook route — voir
      // downloadTelegramAttachmentIfPresent) : le message reste conservé et
      // acquitté plutôt que perdu.
      content:
        message.text ??
        message.caption ??
        (attachment
          ? `Le client a envoyé une pièce jointe Telegram${attachment.fileName ? ` : ${attachment.fileName}` : "."}`
          : "Le client a envoyé une pièce jointe Telegram (contenu non pris en charge par ce canal)."),
      externalMessageId: String(message.message_id),
      channel: "telegram",
      ...(providerAccountId ? { providerAccountId } : {}),
      ...(attachment ? { attachment } : {}),
      ...(isGroup && senderName ? { authorName: senderName } : {}),
      ...(isGroup ? { directedAtBot: isDirectedAtBot(message, botInfo) } : {}),
    },
  };
  return event;
}
