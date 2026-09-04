import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSearch = vi.fn();
vi.mock("@/infrastructure/providers/registry", () => ({
  getDomainProvider: vi.fn(async () => ({ providerName: "test", search: mockSearch })),
}));

vi.mock("./notification-service", () => ({ notifyOrgAdmins: vi.fn() }));

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import { checkDomainAvailability } from "./domain-service";
import { getDomainProvider } from "@/infrastructure/providers/registry";

const mockGetDomainProvider = vi.mocked(getDomainProvider);

function configurePricing(pricing: Array<{ tld: string; supplier_price_fcfa: number; margin_fcfa: number }>) {
  mockFrom.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        order: () => Promise.resolve({ data: pricing, error: null }),
      }),
    }),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkDomainAvailability (Lot N, Partie 2)", () => {
  it("fusionne la disponibilité réelle du provider avec le prix DE VENTE (grille tarifaire, marge incluse) — jamais le prix brut du provider", async () => {
    configurePricing([{ tld: ".cm", supplier_price_fcfa: 6000, margin_fcfa: 2000 }]);
    mockSearch.mockResolvedValue([{ domain: "boutique-fatou.cm", tld: ".cm", available: true, priceFcfa: 999 }]);

    const results = await checkDomainAvailability("boutique-fatou");

    expect(results).toEqual([{ domain: "boutique-fatou.cm", tld: ".cm", available: true, priceFcfa: 8000 }]);
  });

  it("dégrade proprement vers la grille tarifaire seule (available: null) si le provider actif ne sait pas vérifier (ManualDomainAdapter)", async () => {
    configurePricing([{ tld: ".cm", supplier_price_fcfa: 6000, margin_fcfa: 2000 }]);
    mockSearch.mockRejectedValue(new Error("ManualDomainAdapter: recherche de disponibilité non supportée"));

    const results = await checkDomainAvailability("boutique-fatou");

    expect(results).toEqual([{ domain: "boutique-fatou.cm", tld: ".cm", available: null, priceFcfa: 8000 }]);
  });

  it("rejette un nom de domaine invalide avant tout appel provider", async () => {
    await expect(checkDomainAvailability("pas un domaine valide!!")).rejects.toThrow();
    expect(mockGetDomainProvider).not.toHaveBeenCalled();
  });

  it("aucune extension active tarifée : renvoie une liste vide sans appeler le provider", async () => {
    configurePricing([]);
    const results = await checkDomainAvailability("boutique-fatou");
    expect(results).toEqual([]);
    expect(mockGetDomainProvider).not.toHaveBeenCalled();
  });
});
