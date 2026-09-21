import { describe, it, expect } from "vitest";
import { computeCatalogVideoExpiry, detectVideoStorageClass, effectiveRetentionDays } from "./catalog-video-service";

describe("detectVideoStorageClass (jamais la parole du navigateur)", () => {
  it("chemin temp/ = temporaire, quelle que soit la demande", () => {
    expect(detectVideoStorageClass("https://media.zernio.com/temp/123/video.mp4", "temp/123/video.mp4")).toBe("temporary");
    expect(detectVideoStorageClass("https://media.zernio.com/temp/123/video.mp4", null)).toBe("temporary");
  });
  it("hors temp/ = permanent", () => {
    expect(detectVideoStorageClass("https://media.zernio.com/uploads/123/video.mp4", "uploads/123/video.mp4")).toBe("permanent");
  });
  it("un drapeau explicite de Zernio l'emporte (true → permanent, false → temporaire)", () => {
    expect(detectVideoStorageClass("https://media.zernio.com/temp/x.mp4", "temp/x.mp4", true)).toBe("permanent");
    expect(detectVideoStorageClass("https://media.zernio.com/uploads/x.mp4", "uploads/x.mp4", false)).toBe("temporary");
  });
});

describe("effectiveRetentionDays", () => {
  it("temporaire : toujours 7 jours, même en Pro (la promesse 90 j ne tient qu'avec un stockage permanent)", () => {
    expect(effectiveRetentionDays("temporary", 90)).toBe(7);
  });
  it("permanent : durée du plan (7 / 30 / 90), illimité borné à 365, plan sans valeur = 7", () => {
    expect(effectiveRetentionDays("permanent", 30)).toBe(30);
    expect(effectiveRetentionDays("permanent", 90)).toBe(90);
    expect(effectiveRetentionDays("permanent", -1)).toBe(365);
    expect(effectiveRetentionDays("permanent", 0)).toBe(7);
  });
});

describe("computeCatalogVideoExpiry", () => {
  it("ajoute exactement N jours", () => {
    expect(computeCatalogVideoExpiry(new Date("2026-09-21T10:00:00Z"), 30).toISOString()).toBe("2026-10-21T10:00:00.000Z");
  });
});
