import { describe, it, expect } from "vitest";
import {
  detectBroadcastOptOut,
  effectiveRecipientCap,
  isWithinMessagingWindow,
  parseDoualaLocalDateTime,
  pickRecipients,
  UNLIMITED_BROADCAST_HARD_CAP,
  type AudienceCandidate,
} from "./contact-broadcast-service";

describe("detectBroadcastOptOut", () => {
  it("reconnaît STOP et variantes, seul dans le message", () => {
    for (const text of ["STOP", " stop ", "Arrêt", "arret", "désabonner", "Unsubscribe", "stop."]) expect(detectBroadcastOptOut(text)).toBe(true);
  });
  it("ne se déclenche pas dans une phrase normale", () => {
    expect(detectBroadcastOptOut("Je ne veux pas arrêter, continuez")).toBe(false);
    expect(detectBroadcastOptOut("Quel est le prix ?")).toBe(false);
  });
});

describe("isWithinMessagingWindow (règle Meta des 24 h)", () => {
  const now = new Date("2026-09-21T12:00:00Z");
  it("Telegram : jamais de fenêtre", () => {
    expect(isWithinMessagingWindow("telegram", null, now)).toBe(true);
  });
  it("WhatsApp / Messenger / Instagram : dernier message entrant ≤ 24 h", () => {
    expect(isWithinMessagingWindow("whatsapp", "2026-09-21T01:00:00Z", now)).toBe(true);
    expect(isWithinMessagingWindow("facebook", "2026-09-20T11:00:00Z", now)).toBe(false);
    expect(isWithinMessagingWindow("instagram", null, now)).toBe(false);
  });
});

describe("parseDoualaLocalDateTime", () => {
  const now = new Date("2026-09-21T12:00:00Z");
  it("vide = maintenant", () => {
    expect(parseDoualaLocalDateTime("", now)).toBe(now);
  });
  it("datetime-local interprété en UTC+1 (Douala)", () => {
    expect(parseDoualaLocalDateTime("2026-09-22T09:30", now).toISOString()).toBe("2026-09-22T08:30:00.000Z");
  });
  it("respecte un fuseau explicite, refuse une date invalide", () => {
    expect(parseDoualaLocalDateTime("2026-09-22T09:30:00Z", now).toISOString()).toBe("2026-09-22T09:30:00.000Z");
    expect(() => parseDoualaLocalDateTime("pas une date", now)).toThrow(/invalide/);
  });
});

describe("pickRecipients / effectiveRecipientCap", () => {
  const candidate = (contactId: string, channel: AudienceCandidate["channel"], lastMessageAt: string): AudienceCandidate => ({ contactId, conversationId: `${contactId}-${channel}`, channel, lastMessageAt });
  it("un seul destinataire par contact (le plus récent), plafonné, du plus récent au plus ancien", () => {
    const picked = pickRecipients(
      [
        candidate("a", "whatsapp", "2026-09-10T00:00:00Z"),
        candidate("a", "telegram", "2026-09-15T00:00:00Z"),
        candidate("b", "telegram", "2026-09-12T00:00:00Z"),
        candidate("c", "telegram", "2026-09-01T00:00:00Z"),
      ],
      2,
    );
    expect(picked.map((p) => `${p.contactId}:${p.channel}`)).toEqual(["a:telegram", "b:telegram"]);
  });
  it("plafond : plan limité, illimité (-1) → plafond dur, non inclus (0) → 0", () => {
    expect(effectiveRecipientCap(50)).toBe(50);
    expect(effectiveRecipientCap(-1)).toBe(UNLIMITED_BROADCAST_HARD_CAP);
    expect(effectiveRecipientCap(0)).toBe(0);
  });
});
