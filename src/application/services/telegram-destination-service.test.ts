import { describe, it, expect } from "vitest";
import { canBotPostIn, classifyTelegramChat, normalizeTelegramChatRef } from "./telegram-destination-service";

describe("classifyTelegramChat", () => {
  it("canal → channel ; groupe et supergroupe → group ; privé → refusé", () => {
    expect(classifyTelegramChat("channel")).toBe("channel");
    expect(classifyTelegramChat("group")).toBe("group");
    expect(classifyTelegramChat("supergroup")).toBe("group");
    expect(classifyTelegramChat("private")).toBeNull();
  });
});

describe("canBotPostIn", () => {
  it("canal : administrateur avec droit de publier, ou créateur — jamais simple membre", () => {
    expect(canBotPostIn("channel", "administrator", true)).toBe(true);
    expect(canBotPostIn("channel", "administrator", undefined)).toBe(true);
    expect(canBotPostIn("channel", "administrator", false)).toBe(false);
    expect(canBotPostIn("channel", "creator")).toBe(true);
    expect(canBotPostIn("channel", "member")).toBe(false);
  });
  it("groupe : membre, administrateur ou créateur — pas retiré/banni", () => {
    expect(canBotPostIn("group", "member")).toBe(true);
    expect(canBotPostIn("group", "administrator")).toBe(true);
    expect(canBotPostIn("group", "left")).toBe(false);
    expect(canBotPostIn("group", "kicked")).toBe(false);
  });
});

describe("normalizeTelegramChatRef", () => {
  it("accepte @nom, nom, lien t.me et identifiant numérique", () => {
    expect(normalizeTelegramChatRef("@ma_boutique")).toBe("@ma_boutique");
    expect(normalizeTelegramChatRef("ma_boutique")).toBe("@ma_boutique");
    expect(normalizeTelegramChatRef("https://t.me/ma_boutique/")).toBe("@ma_boutique");
    expect(normalizeTelegramChatRef("-1001234567890")).toBe("-1001234567890");
  });
  it("refuse vide, trop court ou caractères invalides", () => {
    expect(() => normalizeTelegramChatRef("  ")).toThrow();
    expect(() => normalizeTelegramChatRef("@ab")).toThrow(/invalide/);
    expect(() => normalizeTelegramChatRef("ma boutique")).toThrow(/invalide/);
  });
});
