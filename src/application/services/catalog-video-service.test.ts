import { describe, it, expect } from "vitest";
import {
  computeVideoExpiry,
  isVideoExpired,
  isZernioMediaUrl,
  validateVideoFile,
  assertVideoAvailableForPublication,
  VIDEO_RETENTION_DAYS,
  MAX_VIDEO_BYTES,
  PUBLICATION_SAFETY_MARGIN_MS,
  telegramVideoLimitMessage,
  TELEGRAM_UPLOAD_MAX_BYTES,
} from "./catalog-video-service";

const DAY = 24 * 60 * 60 * 1000;

describe("rétention Zernio de 7 jours", () => {
  it("l'échéance est exactement 7 jours après l'envoi", () => {
    const uploaded = new Date("2026-09-19T10:00:00Z");
    expect(VIDEO_RETENTION_DAYS).toBe(7);
    expect(computeVideoExpiry(uploaded).toISOString()).toBe("2026-09-26T10:00:00.000Z");
  });

  it("isVideoExpired : vrai à l'échéance exacte et après, faux avant", () => {
    const expiry = new Date("2026-09-26T10:00:00Z");
    expect(isVideoExpired(expiry, new Date(expiry.getTime() - 1))).toBe(false);
    expect(isVideoExpired(expiry, expiry)).toBe(true);
    expect(isVideoExpired(expiry.toISOString(), new Date(expiry.getTime() + DAY))).toBe(true);
  });
});

describe("assertVideoAvailableForPublication — interdit de programmer au-delà des 7 jours Zernio", () => {
  const now = new Date("2026-09-19T10:00:00Z");
  const video = { title: "Démo", expiresAt: new Date(now.getTime() + 7 * DAY) };

  it("accepte une diffusion immédiate et une programmation avant l'échéance", () => {
    expect(() => assertVideoAvailableForPublication(video, now, now)).not.toThrow();
    expect(() => assertVideoAvailableForPublication(video, new Date(now.getTime() + 3 * DAY), now)).not.toThrow();
  });

  it("refuse une programmation après l'échéance, avec un message qui donne la date limite", () => {
    expect(() => assertVideoAvailableForPublication(video, new Date(now.getTime() + 8 * DAY), now)).toThrow(/n'est conservée par Zernio que jusqu'au/);
  });

  it("refuse aussi dans la marge de sécurité juste avant l'échéance", () => {
    const tooClose = new Date(video.expiresAt.getTime() - PUBLICATION_SAFETY_MARGIN_MS + 1000);
    expect(() => assertVideoAvailableForPublication(video, tooClose, now)).toThrow();
  });

  it("refuse toute publication d'une vidéo déjà expirée, même immédiate", () => {
    const expired = { title: "Ancienne", expiresAt: new Date(now.getTime() - 1000) };
    expect(() => assertVideoAvailableForPublication(expired, now, now)).toThrow(/a expiré/);
  });
});

describe("isZernioMediaUrl", () => {
  it("n'accepte que https://media.zernio.com", () => {
    expect(isZernioMediaUrl("https://media.zernio.com/temp/abc.mp4")).toBe(true);
    expect(isZernioMediaUrl("http://media.zernio.com/temp/abc.mp4")).toBe(false);
    expect(isZernioMediaUrl("https://media.zernio.com.evil.example/a.mp4")).toBe(false);
    expect(isZernioMediaUrl("https://evil.example/media.zernio.com/a.mp4")).toBe(false);
    expect(isZernioMediaUrl("pas une url")).toBe(false);
  });
});

describe("validateVideoFile", () => {
  it("accepte MP4 et MOV dans la limite de taille", () => {
    expect(() => validateVideoFile("video/mp4", 10 * 1024 * 1024)).not.toThrow();
    expect(() => validateVideoFile("video/quicktime", 10 * 1024 * 1024)).not.toThrow();
  });

  it("refuse un autre format, un fichier vide ou trop lourd", () => {
    expect(() => validateVideoFile("video/webm", 1000)).toThrow(/MP4 ou MOV/);
    expect(() => validateVideoFile("video/mp4", 0)).toThrow(/vide/);
    expect(() => validateVideoFile("video/mp4", MAX_VIDEO_BYTES + 1)).toThrow(/trop lourde/);
  });
});

describe("limites vérifiées dans la doc", () => {
  it("plafond vidéo à 200 Mo (au-delà, Zernio ne garantit plus la compression aux limites des plateformes)", () => {
    expect(MAX_VIDEO_BYTES).toBe(200 * 1024 * 1024);
  });

  it("Telegram : une vidéo de plus de 50 Mo (limite du téléversement Bot API) est refusée avec un message clair", () => {
    expect(telegramVideoLimitMessage(TELEGRAM_UPLOAD_MAX_BYTES)).toBeNull();
    expect(telegramVideoLimitMessage(null)).toBeNull();
    expect(telegramVideoLimitMessage(TELEGRAM_UPLOAD_MAX_BYTES + 1)).toMatch(/50 Mo/);
  });
});
