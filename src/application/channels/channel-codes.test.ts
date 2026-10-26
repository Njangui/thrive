import { describe, it, expect } from "vitest";
import { LINK_CODE_LENGTH, generateLinkCode, hashSecret, normalizeExternalId, normalizeLinkCode } from "./channel-codes";

describe("code de liaison", () => {
  it("génère 10 caractères de l'alphabet sans ambiguïté (pas de I, L, O, U)", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateLinkCode();
      expect(code).toHaveLength(LINK_CODE_LENGTH);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
    }
  });

  it("ne produit pas deux fois le même code sur 1 000 tirages", () => {
    expect(new Set(Array.from({ length: 1000 }, generateLinkCode)).size).toBe(1000);
  });

  it("normalise la saisie humaine (casse, séparateurs, O→0, I/L→1)", () => {
    expect(normalizeLinkCode("ab12-cd34 ef")).toBe("AB12CD34EF");
    expect(normalizeLinkCode("OIL0OIL0OI")).toBe("0110011001");
  });

  it("rejette longueur ou caractères invalides", () => {
    expect(normalizeLinkCode("ABC")).toBeNull();
    expect(normalizeLinkCode("ABCDEFGHJU")).toBeNull(); // U hors alphabet
    expect(normalizeLinkCode("")).toBeNull();
  });

  it("hache en SHA-256 hex déterministe (jamais le clair)", () => {
    const h = hashSecret("ABC");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashSecret("ABC"));
    expect(h).not.toContain("ABC");
  });
});

describe("normalizeExternalId", () => {
  it("Telegram : identifiant numérique uniquement (pas de @username)", () => {
    expect(normalizeExternalId("telegram", 123456789)).toBe("123456789");
    expect(normalizeExternalId("telegram", "@marc")).toBeNull();
    expect(normalizeExternalId("telegram", "12ab")).toBeNull();
  });

  it("WhatsApp : E.164 normalisé", () => {
    expect(normalizeExternalId("whatsapp", "+237 6 90 12 34 56")).toBe("+237690123456");
    expect(normalizeExternalId("whatsapp", "00237690123456")).toBe("+237690123456");
    expect(normalizeExternalId("whatsapp", "(237) 690-123-456")).toBe("+237690123456");
  });

  it("WhatsApp : rejette trop court, trop long, ou non numérique", () => {
    expect(normalizeExternalId("whatsapp", "12345")).toBeNull();
    expect(normalizeExternalId("whatsapp", "+1234567890123456")).toBeNull();
    expect(normalizeExternalId("whatsapp", "abc")).toBeNull();
  });
});
