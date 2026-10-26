import { describe, it, expect } from "vitest";
import { fitMetadataToPlatform, normalizeHashtag, normalizeHashtags, textLength } from "./publication-metadata";
import { PLATFORM_PROFILES, PUBLICATION_PLATFORMS, getPlatformProfile, normalizePlatform } from "./platform-profiles";

const base = { caption: "Nouvelle robe wax disponible", hashtags: ["wax", "mode"], callToAction: "Commandez sur WhatsApp" };

describe("profils de plateformes", () => {
  it("couvre les 8 plateformes demandées, Telegram étant hors Zernio", () => {
    expect([...PUBLICATION_PLATFORMS].sort()).toEqual(["facebook", "instagram", "linkedin", "pinterest", "telegram", "tiktok", "twitter", "youtube"]);
    expect(PLATFORM_PROFILES.telegram.viaZernio).toBe(false);
    for (const p of PUBLICATION_PLATFORMS.filter((x) => x !== "telegram")) expect(PLATFORM_PROFILES[p].viaZernio).toBe(true);
  });
  it("« x » est un alias de twitter ; plateforme inconnue → null", () => {
    expect(normalizePlatform("X")).toBe("twitter");
    expect(getPlatformProfile("snapchat")).toBeNull();
  });
});

describe("hashtags", () => {
  it("nettoie, préfixe et dédoublonne sans tenir compte de la casse", () => {
    expect(normalizeHashtag("#Promo Noël!")).toBe("#PromoNoël");
    expect(normalizeHashtag("  ## ")).toBeNull();
    expect(normalizeHashtags(["Wax", "#wax", "WAX", "mode"])).toEqual(["#Wax", "#mode"]);
  });
});

describe("fitMetadataToPlatform", () => {
  it("un texte conforme passe sans anomalie et contient légende, CTA et hashtags", () => {
    const r = fitMetadataToPlatform("facebook", { ...base, hashtags: ["#wax", "#mode"] });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.text).toBe("Nouvelle robe wax disponible\n\nCommandez sur WhatsApp\n\n#wax #mode");
  });

  it("X : ne dépasse jamais 280 caractères et conserve l'appel à l'action", () => {
    const r = fitMetadataToPlatform("twitter", { caption: "a ".repeat(400), hashtags: ["wax", "mode", "promo"], callToAction: "WhatsApp : 6XX" });
    expect(r.length).toBeLessThanOrEqual(280);
    expect(r.text).toContain("WhatsApp : 6XX");
    expect(r.metadata.hashtags).toHaveLength(2);
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["caption_truncated", "hashtags_trimmed"]));
  });

  it("compte les émojis comme un caractère (points de code)", () => {
    expect(textLength("👗👗")).toBe(2);
    const r = fitMetadataToPlatform("twitter", { caption: "👗".repeat(280), hashtags: [] });
    expect(r.length).toBe(280);
    expect(r.issues).toEqual([]);
  });

  it("Telegram : 1 024 caractères avec média, 4 096 sans", () => {
    const long = { caption: "mot ".repeat(1500), hashtags: [] };
    expect(fitMetadataToPlatform("telegram", long, { hasMedia: true }).length).toBeLessThanOrEqual(1024);
    const sans = fitMetadataToPlatform("telegram", long, { hasMedia: false });
    expect(sans.length).toBeLessThanOrEqual(4096);
    expect(sans.length).toBeGreaterThan(1024);
  });

  it("YouTube et Pinterest exigent un titre ; le titre trop long est raccourci", () => {
    expect(fitMetadataToPlatform("youtube", base, { hasMedia: true }).issues.map((i) => i.code)).toContain("title_missing");
    const r = fitMetadataToPlatform("pinterest", { ...base, title: "t".repeat(150) }, { hasMedia: true });
    expect(textLength(r.metadata.title ?? "")).toBeLessThanOrEqual(100);
    expect(r.ok).toBe(true);
  });

  it("plateforme sans titre : le titre est ignoré sans erreur", () => {
    const r = fitMetadataToPlatform("instagram", { ...base, title: "Titre" }, { hasMedia: true });
    expect(r.metadata.title).toBeUndefined();
    expect(r.ok).toBe(true);
  });

  it("premier commentaire : ignoré sur X, Pinterest, Telegram ; conservé sur Instagram", () => {
    const withComment = { ...base, firstComment: "Lien en commentaire" };
    expect(fitMetadataToPlatform("twitter", withComment).metadata.firstComment).toBeUndefined();
    expect(fitMetadataToPlatform("telegram", withComment).issues.map((i) => i.code)).toContain("first_comment_unsupported");
    expect(fitMetadataToPlatform("instagram", withComment, { hasMedia: true }).metadata.firstComment).toBe("Lien en commentaire");
  });

  it("média absent sur une plateforme qui l'exige = bloquant ; légende vide = bloquant", () => {
    const r = fitMetadataToPlatform("instagram", base, { hasMedia: false });
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("media_missing");
    expect(fitMetadataToPlatform("facebook", { caption: "  ", hashtags: [] }).ok).toBe(false);
  });

  it("chaque plateforme respecte sa limite sur un texte démesuré", () => {
    for (const platform of PUBLICATION_PLATFORMS) {
      const profile = PLATFORM_PROFILES[platform];
      const r = fitMetadataToPlatform(platform, { title: "T".repeat(300), caption: "lorem ipsum ".repeat(1000), hashtags: Array.from({ length: 40 }, (_, i) => `tag${i}`), callToAction: "Écrivez-nous" }, { hasMedia: true });
      expect(r.length).toBeLessThanOrEqual(profile.bodyMaxWithMedia ?? profile.bodyMax);
      expect(r.metadata.hashtags.length).toBeLessThanOrEqual(profile.hashtagsMax);
    }
  });
});
