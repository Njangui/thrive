import { describe, it, expect } from "vitest";
import { mapTelegramUpdateToDomainEvent } from "./mapper";
import type { TelegramUpdate } from "./types";

const BOT_INFO = { telegramId: 987654321, username: "ma_boutique_bot" };

function baseUpdate(overrides: Partial<TelegramUpdate["message"]> = {}): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 42,
      date: 1_700_000_000,
      from: { id: 111, is_bot: false, first_name: "Awa", last_name: "Ndzana" },
      chat: { id: 555, type: "private" },
      text: "Bonjour, vous avez encore le sac bleu ?",
      ...overrides,
    },
  };
}

describe("mapTelegramUpdateToDomainEvent — chat privé (comportement existant, inchangé)", () => {
  it("crée un événement avec le nom de l'expéditeur comme contact, sans authorName ni directedAtBot", () => {
    const event = mapTelegramUpdateToDomainEvent(baseUpdate(), "org-1", undefined, "bot-row-id", BOT_INFO);
    expect(event).not.toBeNull();
    expect(event?.payload.contactFullName).toBe("Awa Ndzana");
    expect(event?.payload.externalContactId).toBe("555");
    expect(event?.payload.externalThreadId).toBe("555");
    expect((event?.payload as { authorName?: string }).authorName).toBeUndefined();
    expect((event?.payload as { directedAtBot?: boolean }).directedAtBot).toBeUndefined();
  });
});

describe("mapTelegramUpdateToDomainEvent — canal (toujours exclu)", () => {
  it("retourne null pour un chat de type channel", () => {
    const event = mapTelegramUpdateToDomainEvent(
      baseUpdate({ chat: { id: 777, type: "channel" } }),
      "org-1",
      undefined,
      "bot-row-id",
      BOT_INFO,
    );
    expect(event).toBeNull();
  });
});

describe("mapTelegramUpdateToDomainEvent — groupe (nouvelle conversation partagée)", () => {
  it("crée une conversation partagée : contact = titre du groupe, authorName = expéditeur, directedAtBot = false sur un message ordinaire", () => {
    const event = mapTelegramUpdateToDomainEvent(
      baseUpdate({ chat: { id: 999, type: "supergroup", title: "Clients Boutique X" } }),
      "org-1",
      undefined,
      "bot-row-id",
      BOT_INFO,
    );
    expect(event).not.toBeNull();
    expect(event?.payload.externalContactId).toBe("999");
    expect(event?.payload.externalThreadId).toBe("999");
    expect(event?.payload.contactFullName).toBe("Clients Boutique X");
    expect((event?.payload as { authorName?: string }).authorName).toBe("Awa Ndzana");
    expect((event?.payload as { directedAtBot?: boolean }).directedAtBot).toBe(false);
  });

  it("directedAtBot = true sur une commande (/start)", () => {
    const event = mapTelegramUpdateToDomainEvent(
      baseUpdate({
        chat: { id: 999, type: "group", title: "Clients Boutique X" },
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      }),
      "org-1",
      undefined,
      "bot-row-id",
      BOT_INFO,
    );
    expect((event?.payload as { directedAtBot?: boolean }).directedAtBot).toBe(true);
  });

  it("directedAtBot = true quand le bot est explicitement mentionné (@username)", () => {
    const text = "Bonjour @ma_boutique_bot, dispo demain ?";
    const event = mapTelegramUpdateToDomainEvent(
      baseUpdate({
        chat: { id: 999, type: "group", title: "Clients Boutique X" },
        text,
        entities: [{ type: "mention", offset: text.indexOf("@ma_boutique_bot"), length: "@ma_boutique_bot".length }],
      }),
      "org-1",
      undefined,
      "bot-row-id",
      BOT_INFO,
    );
    expect((event?.payload as { directedAtBot?: boolean }).directedAtBot).toBe(true);
  });

  it("directedAtBot = true quand le message répond directement à un message du bot", () => {
    const event = mapTelegramUpdateToDomainEvent(
      baseUpdate({
        chat: { id: 999, type: "group", title: "Clients Boutique X" },
        text: "oui merci",
        reply_to_message: { message_id: 41, from: { id: BOT_INFO.telegramId, is_bot: true, first_name: "MaBoutiqueBot" } },
      }),
      "org-1",
      undefined,
      "bot-row-id",
      BOT_INFO,
    );
    expect((event?.payload as { directedAtBot?: boolean }).directedAtBot).toBe(true);
  });

  it("directedAtBot reste false quand le message répond à quelqu'un d'autre que le bot", () => {
    const event = mapTelegramUpdateToDomainEvent(
      baseUpdate({
        chat: { id: 999, type: "group", title: "Clients Boutique X" },
        text: "oui merci",
        reply_to_message: { message_id: 41, from: { id: 222, is_bot: false, first_name: "Autre Client" } },
      }),
      "org-1",
      undefined,
      "bot-row-id",
      BOT_INFO,
    );
    expect((event?.payload as { directedAtBot?: boolean }).directedAtBot).toBe(false);
  });
});
