import { describe, it, expect } from "vitest";
import {
  computeVideoExpiry,
  computeCatalogVideoExpiry,
  computeHostExpiry,
  isVideoExpired,
  validateVideoFile,
  assertVideoAvailableForPublication,
  VIDEO_RETENTION_DAYS,
  MAX_VIDEO_BYTES,
  PUBLICATION_SAFETY_MARGIN_MS,
  RENEWAL_MARGIN_MS,
  telegramVideoLimitMessage,
  TELEGRAM_UPLOAD_MAX_BYTES,
} from "./catalog-video-service";

const DAY = 24 * 60 * 60 * 1000;

describe("rétention — promesse de l'offre (7/30/90 jours) vs fenêtre réelle Zernio (7 jours fixes)", () => {
  it("computeHostExpiry / computeVideoExpiry : exactement 7 jours, la contrainte réelle de Zernio", () => {
    const from = new Date("2026-09-19T10:00:00Z");
    expect(VIDEO_RETENTION_DAYS).toBe(7);
    expect(computeHostExpiry(from).toISOString()).toBe("2026-09-26T10:00:00.000Z");
    expect(computeVideoExpiry(from).toISOString()).toBe(computeHostExpiry(from).toISOString());
  });

  it("computeCatalogVideoExpiry : ajoute exactement N jours (7, 30 ou 90 selon l'offre) — c'est la PROMESSE, distincte de la fenêtre Zernio", () => {
    const uploaded = new Date("2026-09-21T10:00:00Z");
    expect(computeCatalogVideoExpiry(uploaded, 30).toISOString()).toBe("2026-10-21T10:00:00.000Z");
    expect(computeCatalogVideoExpiry(uploaded, 90).toISOString()).toBe("2026-12-20T10:00:00.000Z");
  });

  it("isVideoExpired : vrai à l'échéance exacte et après, faux avant", () => {
    const expiry = new Date("2026-09-26T10:00:00Z");
    expect(isVideoExpired(expiry, new Date(expiry.getTime() - 1))).toBe(false);
    expect(isVideoExpired(expiry, expiry)).toBe(true);
    expect(isVideoExpired(expiry.toISOString(), new Date(expiry.getTime() + DAY))).toBe(true);
  });
});

describe("assertVideoAvailableForPublication — vérifie la promesse de l'offre ET la fenêtre Zernio réelle", () => {
  const now = new Date("2026-09-19T10:00:00Z");
  // Vidéo Starter (30 jours promis), renouvelée récemment (fenêtre Zernio fraîche).
  const video = { title: "Démo", expiresAt: new Date(now.getTime() + 30 * DAY), hostExpiresAt: new Date(now.getTime() + 5 * DAY), retentionDays: 30 };

  it("accepte une diffusion immédiate et une programmation avant les DEUX échéances", () => {
    expect(() => assertVideoAvailableForPublication(video, now, now)).not.toThrow();
    expect(() => assertVideoAvailableForPublication(video, new Date(now.getTime() + 3 * DAY), now)).not.toThrow();
  });

  it("refuse une programmation après la fenêtre Zernio, MÊME SI l'offre promet encore plus longtemps", () => {
    // La promesse (30 j) est loin d'être atteinte, mais la fenêtre Zernio (5 j) ferme avant.
    expect(() => assertVideoAvailableForPublication(video, new Date(now.getTime() + 6 * DAY), now)).toThrow(/disponible que jusqu'au/);
  });

  it("refuse toute publication si le renouvellement a déjà échoué et que la fenêtre Zernio est close (fichier confirmé disparu)", () => {
    const stale = { title: "Ancienne", expiresAt: new Date(now.getTime() + 20 * DAY), hostExpiresAt: new Date(now.getTime() - 1000) };
    expect(() => assertVideoAvailableForPublication(stale, now, now)).toThrow(/n'est plus disponible chez Zernio/);
  });

  it("refuse toute publication d'une vidéo dont la promesse d'offre est déjà passée", () => {
    const expired = { title: "Ancienne", expiresAt: new Date(now.getTime() - 1000) };
    expect(() => assertVideoAvailableForPublication(expired, now, now)).toThrow(/a expiré/);
  });

  it("refuse dans la marge de sécurité juste avant l'échéance la plus proche des deux", () => {
    const tooClose = { title: "Démo", expiresAt: new Date(now.getTime() + 30 * DAY), hostExpiresAt: new Date(now.getTime() + DAY) };
    const justInsideMargin = new Date(tooClose.hostExpiresAt.getTime() - PUBLICATION_SAFETY_MARGIN_MS + 1000);
    expect(() => assertVideoAvailableForPublication(tooClose, justInsideMargin, now)).toThrow();
  });

  it("sans hostExpiresAt connu (URL Zernio hors catalogue) : seule la promesse d'offre compte", () => {
    expect(() => assertVideoAvailableForPublication({ title: "X", expiresAt: new Date(now.getTime() + 3 * DAY) }, new Date(now.getTime() + 2 * DAY), now)).not.toThrow();
  });
});

describe("marge de renouvellement", () => {
  it("36 h : assez large pour absorber plusieurs échecs avant la fermeture réelle de la fenêtre de 7 jours", () => {
    expect(RENEWAL_MARGIN_MS).toBe(36 * 60 * 60 * 1000);
    expect(RENEWAL_MARGIN_MS).toBeLessThan(VIDEO_RETENTION_DAYS * DAY);
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
