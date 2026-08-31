import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./entitlements-service", () => ({
  canUseFeature: vi.fn(),
}));

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import { addHoursToNaiveIso, createCampaignFromProducts } from "./marketing-service";
import { canUseFeature } from "./entitlements-service";

const mockCanUseFeature = vi.mocked(canUseFeature);

describe("addHoursToNaiveIso", () => {
  it("décale de N heures sans changer le format", () => {
    expect(addHoursToNaiveIso("2026-09-01T18:00:00", 24)).toBe("2026-09-02T18:00:00");
  });

  it("étale 3 produits sur 3 créneaux distincts espacés de 24h (section 29)", () => {
    const slots = [0, 1, 2].map((i) => addHoursToNaiveIso("2026-09-01T18:00:00", i * 24));
    expect(slots).toEqual(["2026-09-01T18:00:00", "2026-09-02T18:00:00", "2026-09-03T18:00:00"]);
    // Pas de doublon involontaire (section 29)
    expect(new Set(slots).size).toBe(3);
  });

  it("gère le changement de mois correctement", () => {
    expect(addHoursToNaiveIso("2026-08-31T20:00:00", 24)).toBe("2026-09-01T20:00:00");
  });

  it("gère un décalage de 0 heure (premier produit de la campagne)", () => {
    expect(addHoursToNaiveIso("2026-09-01T18:00:00", 0)).toBe("2026-09-01T18:00:00");
  });
});

describe("createCampaignFromProducts — enforcement Lot B (entitlements)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuse la création AVANT tout accès DB si le quota 'social_accounts' est dépassé", async () => {
    mockCanUseFeature.mockResolvedValue({ allowed: false, limit: 3, used: 0, remaining: 3 });

    await expect(
      createCampaignFromProducts({
        organizationId: "org-1",
        name: "Promo rentrée",
        productIds: ["p1"],
        targets: [
          { platform: "facebook", accountId: "acc-1" },
          { platform: "instagram", accountId: "acc-2" },
          { platform: "tiktok", accountId: "acc-3" },
          { platform: "linkedin", accountId: "acc-4" },
        ],
        firstSlotAt: "2026-09-01T18:00:00",
        intervalHours: 24,
      }),
    ).rejects.toThrow(/Passez à Business/);

    // Vérifie le point d'application exact demandé par le cahier Lot B :
    // le nombre de COMPTES DISTINCTS ciblés (pas le nombre de targets brut).
    expect(mockCanUseFeature).toHaveBeenCalledWith("org-1", "social_accounts", 4);
    // Aucun accès DB avant la vérification de droits (enforcement serveur réel).
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("déduplique les comptes ciblés plusieurs fois dans la même campagne avant de vérifier le quota", async () => {
    mockCanUseFeature.mockResolvedValue({ allowed: false, limit: 1, used: 0, remaining: 1 });

    await expect(
      createCampaignFromProducts({
        organizationId: "org-1",
        name: "Promo rentrée",
        productIds: ["p1"],
        targets: [
          { platform: "facebook", accountId: "acc-1" },
          { platform: "facebook", accountId: "acc-1" }, // même compte, ne doit compter qu'une fois
        ],
        firstSlotAt: "2026-09-01T18:00:00",
        intervalHours: 24,
      }),
    ).rejects.toThrow();

    expect(mockCanUseFeature).toHaveBeenCalledWith("org-1", "social_accounts", 1);
  });
});
