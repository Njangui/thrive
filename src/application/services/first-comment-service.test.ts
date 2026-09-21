import { describe, it, expect } from "vitest";
import { normalizeFirstComment, parseTikTokVideoId, FIRST_COMMENT_MAX_LENGTH } from "./first-comment-service";

describe("parseTikTokVideoId", () => {
  it("extrait l'identifiant numérique de l'URL d'une vidéo TikTok", () => {
    expect(parseTikTokVideoId("https://www.tiktok.com/@boutique/video/7300000000000000000")).toBe("7300000000000000000");
    expect(parseTikTokVideoId("https://www.tiktok.com/@a/video/7300000000000000000?is_from_webapp=1")).toBe("7300000000000000000");
  });
  it("URL absente, non TikTok ou sans identifiant : null (jamais deviné)", () => {
    expect(parseTikTokVideoId(undefined)).toBeNull();
    expect(parseTikTokVideoId("https://www.tiktok.com/@boutique")).toBeNull();
    expect(parseTikTokVideoId("https://example.com/video/12")).toBeNull();
  });
});

describe("normalizeFirstComment", () => {
  it("vide → undefined ; texte → trim", () => {
    expect(normalizeFirstComment("   ")).toBeUndefined();
    expect(normalizeFirstComment(null)).toBeUndefined();
    expect(normalizeFirstComment("  Commandez ici  ")).toBe("Commandez ici");
  });
  it("refuse au-delà de la limite", () => {
    expect(() => normalizeFirstComment("x".repeat(FIRST_COMMENT_MAX_LENGTH + 1))).toThrow(/dépasser/);
  });
});
