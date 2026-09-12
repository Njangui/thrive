import { describe, it, expect, vi, beforeEach } from "vitest";

interface QueryResult {
  data?: unknown;
  error?: { message: string } | null;
}

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

const mockWriteAdminAuditLog = vi.fn();
vi.mock("./admin-organizations-service", () => ({
  writeAdminAuditLog: (...args: unknown[]) => mockWriteAdminAuditLog(...args),
}));

const mockGetCountries = vi.fn();
const mockGetCountry = vi.fn();
const mockGetChannels = vi.fn();
const mockSyncAllResources = vi.fn();
const mockSyncChannels = vi.fn();
const mockGetSyncStatus = vi.fn();
vi.mock("./notchpay-resources-service", () => ({
  getCountries: (...args: unknown[]) => mockGetCountries(...args),
  getCountry: (...args: unknown[]) => mockGetCountry(...args),
  getChannels: (...args: unknown[]) => mockGetChannels(...args),
  syncAllResources: (...args: unknown[]) => mockSyncAllResources(...args),
  syncChannels: (...args: unknown[]) => mockSyncChannels(...args),
  getSyncStatus: (...args: unknown[]) => mockGetSyncStatus(...args),
}));

const mockListPlanPricesForCountry = vi.fn();
vi.mock("./plans-repository", () => ({
  PLAN_KEYS: ["starter", "business", "pro"],
  listPlanPricesForCountry: (...args: unknown[]) => mockListPlanPricesForCountry(...args),
}));

import {
  getCountriesOverviewForAdmin,
  getCountryDetailForAdmin,
  setCountryLaunchStatus,
  upsertCountryPrice,
  triggerManualSync,
  triggerCountryChannelsSync,
} from "./admin-countries-service";
import { ValidationError, NotFoundError } from "@/lib/errors";

function makeCountry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "id-cm",
    isoCode: "CM",
    name: "Cameroun",
    nativeName: null,
    currencyCode: "XAF",
    currencyName: "Franc CFA",
    currencySymbol: "FCFA",
    phoneCode: "+237",
    flagUrl: null,
    notchpaySupported: true,
    launchStatus: "active",
    displayOrder: 0,
    metadata: {},
    lastSyncedAt: null,
    activatedAt: "2026-01-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const COMPLETE_PRICES = [
  { key: "starter", amount: 0, currencyCode: "XAF", source: "country_specific" },
  { key: "business", amount: 15000, currencyCode: "XAF", source: "country_specific" },
  { key: "pro", amount: 35000, currencyCode: "XAF", source: "country_specific" },
];

const INCOMPLETE_PRICES = [
  { key: "starter", amount: 0, currencyCode: "GHS", source: "fallback_default" },
  { key: "business", amount: 15000, currencyCode: "GHS", source: "fallback_default" },
  { key: "pro", amount: 35000, currencyCode: "GHS", source: "fallback_default" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCountriesOverviewForAdmin", () => {
  it("calcule les KPIs par statut et enrichit chaque pays (canaux disponibles, pricing complet)", async () => {
    mockGetCountries.mockResolvedValue([
      makeCountry({ isoCode: "CM", launchStatus: "active" }),
      makeCountry({ isoCode: "CI", launchStatus: "coming_soon" }),
      makeCountry({ isoCode: "SN", launchStatus: "waitlist" }),
      makeCountry({ isoCode: "GH", launchStatus: "disabled", notchpaySupported: false }),
    ]);
    mockGetChannels.mockResolvedValue([{ isAvailable: true }]);
    mockListPlanPricesForCountry.mockResolvedValue(COMPLETE_PRICES);
    mockGetSyncStatus.mockResolvedValue({ lastSuccessfulSyncAt: "2026-09-06T03:00:00Z", lastFailedSyncAt: null, lastError: null, isHealthy: true });

    const overview = await getCountriesOverviewForAdmin();

    expect(overview.kpis).toEqual({
      notchpaySupportedCount: 3,
      activeCount: 1,
      comingSoonCount: 1,
      waitlistCount: 1,
      disabledCount: 1,
    });
    expect(overview.countries[0]).toMatchObject({ isoCode: "CM", availableChannelCount: 1, hasCompletePricing: true });
  });
});

describe("getCountryDetailForAdmin", () => {
  it("lève NotFoundError pour un pays inconnu", async () => {
    mockGetCountry.mockResolvedValue(null);
    await expect(getCountryDetailForAdmin("ZZ")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("renvoie pays + canaux + prix pour un pays connu", async () => {
    mockGetCountry.mockResolvedValue(makeCountry());
    mockGetChannels.mockResolvedValue([{ channelCode: "cm.mtn" }]);
    mockListPlanPricesForCountry.mockResolvedValue(COMPLETE_PRICES);

    const detail = await getCountryDetailForAdmin("cm");
    expect(detail.country.isoCode).toBe("CM");
    expect(detail.channels).toHaveLength(1);
    expect(detail.prices).toHaveLength(3);
  });
});

describe("setCountryLaunchStatus", () => {
  it("rejette un statut invalide", async () => {
    await expect(setCountryLaunchStatus("CM", "actif", "admin-1")).rejects.toBeInstanceOf(ValidationError);
    expect(mockGetCountry).not.toHaveBeenCalled();
  });

  it("lève NotFoundError pour un pays inconnu", async () => {
    mockGetCountry.mockResolvedValue(null);
    await expect(setCountryLaunchStatus("ZZ", "active", "admin-1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("bloque l'activation d'un pays dont la checklist n'est pas complète (section 51/52)", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ isoCode: "GH", launchStatus: "coming_soon", notchpaySupported: true }));
    mockGetChannels.mockResolvedValue([{ isAvailable: true }]);
    mockListPlanPricesForCountry.mockResolvedValue(INCOMPLETE_PRICES); // prix non configurés (fallback_default)

    await expect(setCountryLaunchStatus("GH", "active", "admin-1")).rejects.toThrow(/Prix non configurés/);
    expect(mockFrom).not.toHaveBeenCalled(); // aucune écriture DB si la checklist échoue
  });

  it("bloque l'activation si aucun canal de paiement n'est disponible", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ isoCode: "GH", launchStatus: "coming_soon" }));
    mockGetChannels.mockResolvedValue([]);
    mockListPlanPricesForCountry.mockResolvedValue(COMPLETE_PRICES);

    await expect(setCountryLaunchStatus("GH", "active", "admin-1")).rejects.toThrow(/canal de paiement/);
  });

  it("bloque l'activation si NotchPay ne supporte pas le pays", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ isoCode: "GH", launchStatus: "coming_soon", notchpaySupported: false }));
    mockGetChannels.mockResolvedValue([{ isAvailable: true }]);
    mockListPlanPricesForCountry.mockResolvedValue(COMPLETE_PRICES);

    await expect(setCountryLaunchStatus("GH", "active", "admin-1")).rejects.toThrow(/NotchPay ne supporte pas/);
  });

  it("active un pays dont la checklist est complète, met à jour countries et audite COUNTRY_ENABLED", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ isoCode: "GH", launchStatus: "coming_soon", notchpaySupported: true }));
    mockGetChannels.mockResolvedValue([{ isAvailable: true }]);
    mockListPlanPricesForCountry.mockResolvedValue(COMPLETE_PRICES);
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    mockFrom.mockReturnValue({ update });

    await setCountryLaunchStatus("GH", "active", "admin-1");

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ launch_status: "active" }));
    expect(mockWriteAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "COUNTRY_ENABLED", actorUserId: "admin-1", entityId: "id-cm" }),
    );
  });

  it("ne redéclenche PAS la checklist quand le pays est déjà actif (ex: re-sauvegarde)", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ isoCode: "CM", launchStatus: "active" }));
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    mockFrom.mockReturnValue({ update });

    await setCountryLaunchStatus("CM", "active", "admin-1");

    expect(mockGetChannels).not.toHaveBeenCalled();
    expect(mockListPlanPricesForCountry).not.toHaveBeenCalled();
  });

  it("une désactivation produit l'action COUNTRY_DISABLED", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ isoCode: "SN", launchStatus: "active" }));
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    mockFrom.mockReturnValue({ update });

    await setCountryLaunchStatus("SN", "disabled", "admin-1");

    expect(mockWriteAdminAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "COUNTRY_DISABLED" }));
  });

  it("un passage vers coming_soon ou waitlist produit COUNTRY_STATUS_CHANGED", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ isoCode: "SN", launchStatus: "disabled" }));
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    mockFrom.mockReturnValue({ update });

    await setCountryLaunchStatus("SN", "waitlist", "admin-1");

    expect(mockWriteAdminAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "COUNTRY_STATUS_CHANGED" }));
  });
});

describe("upsertCountryPrice", () => {
  it("rejette un plan_key invalide", async () => {
    await expect(upsertCountryPrice("CM", "ultra", 10000, "admin-1")).rejects.toBeInstanceOf(ValidationError);
    expect(mockGetCountry).not.toHaveBeenCalled();
  });

  it("lève NotFoundError pour un pays inconnu", async () => {
    mockGetCountry.mockResolvedValue(null);
    await expect(upsertCountryPrice("ZZ", "business", 100, "admin-1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("normalise le montant selon la devise DU PAYS et archive l'ancien prix actif avant d'en créer un nouveau", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ isoCode: "GH", currencyCode: "GHS" }));

    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "old-price-1", amount: 20000, currency_code: "GHS" }, error: null });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    const insert = vi.fn().mockResolvedValue({ error: null });

    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }) }) }),
      update,
      insert,
    });

    await upsertCountryPrice("gh", "business", 50, "admin-1"); // 50 GHS -> 5000 (2 décimales)

    expect(update).toHaveBeenCalledWith({ is_active: false });
    expect(updateEq).toHaveBeenCalledWith("id", "old-price-1");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ plan_key: "business", country_code: "GH", currency_code: "GHS", amount: 5000, is_active: true }),
    );
    expect(mockWriteAdminAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "COUNTRY_PRICE_CHANGED" }));
  });

  it("XAF (0 décimale) : le montant saisi est stocké tel quel, aucun ancien prix à archiver", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ isoCode: "CM", currencyCode: "XAF" }));
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const insert = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn();

    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }) }) }),
      update,
      insert,
    });

    await upsertCountryPrice("CM", "starter", 0, "admin-1");

    expect(update).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ amount: 0, currency_code: "XAF" }));
  });
});

describe("triggerManualSync", () => {
  it("délègue à syncAllResources et audite COUNTRY_SYNCED avec un résumé", async () => {
    mockSyncAllResources.mockResolvedValue({
      countries: { status: "success", itemsSynced: 5 },
      channels: [
        { status: "success", itemsSynced: 2 },
        { status: "failed", itemsSynced: 0, errorMessage: "timeout" },
      ],
    });

    const result = await triggerManualSync("admin-1");

    expect(result.countries.itemsSynced).toBe(5);
    expect(mockWriteAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "COUNTRY_SYNCED",
        actorUserId: "admin-1",
        afterState: expect.objectContaining({ channelSyncsRun: 2, channelSyncFailures: 1 }),
      }),
    );
  });
});

describe("triggerCountryChannelsSync", () => {
  it("lève NotFoundError pour un pays inconnu", async () => {
    mockGetCountry.mockResolvedValue(null);
    await expect(triggerCountryChannelsSync("ZZ", "admin-1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("resynchronise UNIQUEMENT les canaux de ce pays et audite COUNTRY_CHANNEL_UPDATED", async () => {
    mockGetCountry.mockResolvedValue(makeCountry({ isoCode: "CI" }));
    mockSyncChannels.mockResolvedValue({ status: "success", itemsSynced: 3 });

    const result = await triggerCountryChannelsSync("ci", "admin-1");

    expect(mockSyncChannels).toHaveBeenCalledWith("CI");
    expect(result.itemsSynced).toBe(3);
    expect(mockWriteAdminAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "COUNTRY_CHANNEL_UPDATED" }));
  });
});
