import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  notifyOrgAdmins: vi.fn(async () => {}),
  downloadRemoteMedia: vi.fn(async () => ({ data: new Uint8Array([1, 2, 3]), contentType: "video/mp4" })),
  createMediaPresign: vi.fn(async () => ({ uploadUrl: "https://zernio.example/upload/new", publicUrl: "https://media.zernio.com/temp/new.mp4", key: "temp/new.mp4" })),
  rows: [] as Record<string, unknown>[],
  updates: [] as { table: string; payload: unknown; id: unknown }[],
}));

vi.mock("./notification-service", () => ({ notifyOrgAdmins: mocks.notifyOrgAdmins }));
vi.mock("@/lib/remote-media", () => ({
  TELEGRAM_UPLOAD_MAX_BYTES: 50 * 1024 * 1024,
  downloadRemoteMedia: mocks.downloadRemoteMedia,
  isAllowedRemoteMediaHost: () => true,
  isZernioMediaHost: () => true,
}));
vi.mock("@/infrastructure/providers/social/zernio/client", () => ({
  // Vitest ≥ 3 : un mock appelé avec `new` doit être une `function`/`class`, pas une flèche.
  ZernioSocialClient: vi.fn().mockImplementation(function () {
    return { createMediaPresign: mocks.createMediaPresign };
  }),
}));
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      let matchedId: unknown;
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn((column: string, value: unknown) => {
        if (column === "id") matchedId = value;
        return builder;
      });
      builder.gt = vi.fn(() => builder);
      builder.lte = vi.fn(() => builder);
      builder.gte = vi.fn(() => builder);
      builder.order = vi.fn(() => builder);
      builder.limit = vi.fn(() => Promise.resolve({ data: mocks.rows, error: null }));
      builder.update = vi.fn((payload: unknown) => ({
        eq: vi.fn((column: string, value: unknown) => {
          if (column === "id") matchedId = value;
          mocks.updates.push({ table, payload, id: matchedId });
          return Promise.resolve({ error: null });
        }),
      }));
      return builder;
    },
  }),
}));

import { renewExpiringZernioVideos, notifyExpiringCatalogVideos } from "./catalog-video-service";

const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = [];
  mocks.updates.length = 0;
  mocks.downloadRemoteMedia.mockResolvedValue({ data: new Uint8Array([1, 2, 3]), contentType: "video/mp4" });
  mocks.createMediaPresign.mockResolvedValue({ uploadUrl: "https://zernio.example/upload/new", publicUrl: "https://media.zernio.com/temp/new.mp4", key: "temp/new.mp4" });
  fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const baseRow = { id: "v1", organization_id: "org-1", url: "https://media.zernio.com/temp/old.mp4", content_type: "video/mp4", title: "Promo", expires_at: "2026-10-20T10:00:00Z", host_expires_at: "2026-09-22T10:00:00Z" };

describe("renewExpiringZernioVideos — retéléverse chez Zernio AVANT la fermeture des 7 jours, sans jamais avancer la promesse de l'offre", () => {
  it("télécharge le fichier, le retéléverse via un nouveau presign, et avance SEULEMENT host_expires_at", async () => {
    mocks.rows = [baseRow];
    const result = await renewExpiringZernioVideos(new Date("2026-09-21T10:00:00Z"));
    expect(result).toEqual({ renewed: 1, failed: 0, expired: 0 });
    expect(mocks.downloadRemoteMedia).toHaveBeenCalledWith(baseRow.url, expect.any(Number));
    expect(fetchMock).toHaveBeenCalledWith("https://zernio.example/upload/new", expect.objectContaining({ method: "PUT" }));
    const update = mocks.updates.find((u) => u.id === "v1")?.payload as Record<string, unknown>;
    expect(update).toMatchObject({ url: "https://media.zernio.com/temp/new.mp4", renewal_error: null });
    // La promesse de l'offre (expires_at) n'est JAMAIS touchée par un renouvellement.
    expect(update).not.toHaveProperty("expires_at");
  });

  it("un échec de téléchargement est enregistré (renewal_error) et compté « failed » si la fenêtre Zernio est encore ouverte", async () => {
    mocks.rows = [baseRow];
    mocks.downloadRemoteMedia.mockRejectedValueOnce(new Error("La vidéo n'est plus disponible chez Zernio."));
    const result = await renewExpiringZernioVideos(new Date("2026-09-21T10:00:00Z"));
    expect(result).toEqual({ renewed: 0, failed: 1, expired: 0 });
    expect(mocks.updates.find((u) => u.id === "v1")?.payload).toMatchObject({ renewal_error: expect.stringContaining("disponible") });
  });

  it("un échec APRÈS que la fenêtre Zernio a fermé est compté « expired », pas « failed » (le fichier est confirmé disparu)", async () => {
    const alreadyClosed = { ...baseRow, host_expires_at: "2026-09-20T10:00:00Z" };
    mocks.rows = [alreadyClosed];
    mocks.downloadRemoteMedia.mockRejectedValueOnce(new Error("expiré"));
    const result = await renewExpiringZernioVideos(new Date("2026-09-21T10:00:00Z"));
    expect(result).toEqual({ renewed: 0, failed: 0, expired: 1 });
  });

  it("un envoi refusé par Zernio (PUT non ok) est traité comme un échec, pas un succès silencieux", async () => {
    mocks.rows = [baseRow];
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    const result = await renewExpiringZernioVideos(new Date("2026-09-21T10:00:00Z"));
    expect(result).toEqual({ renewed: 0, failed: 1, expired: 0 });
  });

  it("aucune vidéo à renouveler : rien à faire, aucun téléchargement", async () => {
    mocks.rows = [];
    expect(await renewExpiringZernioVideos()).toEqual({ renewed: 0, failed: 0, expired: 0 });
    expect(mocks.downloadRemoteMedia).not.toHaveBeenCalled();
  });
});

describe("notifyExpiringCatalogVideos", () => {
  it("notifie chaque organisation et marque la vidéo comme notifiée (une seule fois)", async () => {
    mocks.rows = [{ id: "v1", organization_id: "org-1", title: "Promo", expires_at: "2026-09-24T10:00:00Z" }];
    const result = await notifyExpiringCatalogVideos(new Date("2026-09-21T10:00:00Z"));
    expect(result).toEqual({ notified: 1 });
    expect(mocks.notifyOrgAdmins).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1", relatedEntityId: "v1" }));
    expect(mocks.updates.find((u) => u.id === "v1")?.payload).toEqual({ notified_expiry_soon: true });
  });

  it("aucune vidéo dans la fenêtre : aucune notification", async () => {
    mocks.rows = [];
    expect(await notifyExpiringCatalogVideos()).toEqual({ notified: 0 });
    expect(mocks.notifyOrgAdmins).not.toHaveBeenCalled();
  });
});
