import { describe, it, expect, vi, beforeEach } from "vitest";

const mockListCountries = vi.fn();
const mockListChannels = vi.fn();
vi.mock("@/infrastructure/providers/payment/notchpay/resources-client", () => ({
  NotchPayResourcesClient: vi.fn().mockImplementation(() => ({
    listCountries: mockListCountries,
    listChannels: mockListChannels,
  })),
}));

interface QueryResult {
  data?: unknown;
  error?: { message: string } | null;
}

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import {
  getCountries,
  getCountry,
  getChannels,
  syncCountries,
  syncChannels,
  getSyncStatus,
} from "./notchpay-resources-service";

/** Même pattern que admin-plans-service.test.ts : résultat fixe par table. */
function configureSupabase(byTable: Record<string, QueryResult>) {
  const upsertCalls: Array<{ table: string; payload: unknown; options: unknown }> = [];
  const updateCalls: Array<{ table: string; payload: unknown }> = [];
  const insertCalls: Array<{ table: string; payload: unknown }> = [];

  mockFrom.mockImplementation((table: string) => {
    const result: QueryResult = byTable[table] ?? { data: null, error: null };
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => Promise.resolve(result),
      not: () => builder,
      maybeSingle: () => Promise.resolve(result),
      then: (onFulfilled: (v: QueryResult) => unknown) => Promise.resolve(result).then(onFulfilled),
      upsert: (payload: unknown, options: unknown) => {
        upsertCalls.push({ table, payload, options });
        return Promise.resolve({ error: null });
      },
      update: (payload: unknown) => {
        updateCalls.push({ table, payload });
        return builder;
      },
      insert: (payload: unknown) => {
        insertCalls.push({ table, payload });
        return Promise.resolve({ error: null });
      },
    };
    return builder;
  });

  return { upsertCalls, updateCalls, insertCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCountries / getCountry / getChannels — lecture pure", () => {
  it("getCountries mappe les colonnes snake_case vers camelCase", async () => {
    configureSupabase({
      countries: {
        data: [
          {
            id: "id-1",
            iso_code: "CM",
            name: "Cameroun",
            native_name: null,
            currency_code: "XAF",
            currency_name: "Franc CFA",
            currency_symbol: "FCFA",
            phone_code: "+237",
            flag_url: null,
            notchpay_supported: true,
            launch_status: "active",
            display_order: 0,
            metadata: {},
            last_synced_at: null,
            activated_at: "2026-01-01T00:00:00Z",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      },
    });

    const countries = await getCountries();
    expect(countries).toHaveLength(1);
    expect(countries[0]).toMatchObject({ isoCode: "CM", currencyCode: "XAF", launchStatus: "active" });
  });

  it("getCountry renvoie null si aucune ligne (pays jamais synchronisé)", async () => {
    configureSupabase({ countries: { data: null, error: null } });
    expect(await getCountry("ZZ")).toBeNull();
  });

  it("getChannels mappe les colonnes et filtre par pays", async () => {
    configureSupabase({
      payment_channels: {
        data: [
          {
            id: "chan-1",
            country_code: "CM",
            provider: "notchpay",
            channel_code: "cm.mtn",
            channel_name: "MTN Mobile Money",
            type: "mobile_money",
            currency_code: "XAF",
            is_available: true,
            metadata: {},
            last_synced_at: null,
          },
        ],
        error: null,
      },
    });

    const channels = await getChannels("cm");
    expect(channels).toEqual([
      {
        id: "chan-1",
        countryCode: "CM",
        provider: "notchpay",
        channelCode: "cm.mtn",
        channelName: "MTN Mobile Money",
        type: "mobile_money",
        currencyCode: "XAF",
        isAvailable: true,
        metadata: {},
        lastSyncedAt: null,
      },
    ]);
  });
});

describe("syncCountries", () => {
  it("upsert chaque pays valide reçu de NotchPay, sans jamais toucher launch_status", async () => {
    const mocks = configureSupabase({ notchpay_sync_runs: { data: null, error: null } });
    mockListCountries.mockResolvedValue({
      code: 200,
      status: "OK",
      message: "Countries retrieved",
      countries: [
        { code: "NG", name: "Nigeria", currency: "NGN", phone_code: "+234", channels: ["mobile_money", "card"] },
      ],
    });

    const result = await syncCountries();

    expect(result).toEqual({ status: "success", itemsSynced: 1 });
    const upsertCall = mocks.upsertCalls.find((c) => c.table === "countries");
    expect(upsertCall).toBeDefined();
    const payload = upsertCall!.payload as Record<string, unknown>;
    expect(payload).toMatchObject({ iso_code: "NG", currency_code: "NGN", phone_code: "+234", notchpay_supported: true });
    expect(payload).not.toHaveProperty("launch_status");
    expect(payload).not.toHaveProperty("display_order");
  });

  it("ignore silencieusement une entrée malformée (code manquant) sans faire échouer toute la sync", async () => {
    configureSupabase({ notchpay_sync_runs: { data: null, error: null } });
    mockListCountries.mockResolvedValue({
      code: 200,
      status: "OK",
      message: "ok",
      countries: [
        { code: "", name: "Invalide", currency: "XAF", phone_code: "+000" },
        { code: "GA", name: "Gabon", currency: "XAF", phone_code: "+241" },
      ],
    });

    const result = await syncCountries();
    expect(result).toEqual({ status: "success", itemsSynced: 1 });
  });

  it("en cas d'échec réseau/API, retourne un statut 'failed' explicite sans lever (le dernier état DB reste intact)", async () => {
    configureSupabase({ notchpay_sync_runs: { data: null, error: null } });
    mockListCountries.mockRejectedValue(new Error("NotchPay indisponible"));

    const result = await syncCountries();
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/NotchPay indisponible/);
  });

  it("enregistre une ligne notchpay_sync_runs à chaque appel (succès ou échec)", async () => {
    const mocks = configureSupabase({ notchpay_sync_runs: { data: null, error: null } });
    mockListCountries.mockResolvedValue({ code: 200, status: "OK", message: "ok", countries: [] });

    await syncCountries();

    const runInsert = mocks.insertCalls.find((c) => c.table === "notchpay_sync_runs");
    expect(runInsert).toBeDefined();
    expect(runInsert!.payload).toMatchObject({ resource_type: "countries", status: "success" });
  });
});

describe("syncChannels", () => {
  it("upsert chaque canal reçu et marque obsolètes ceux qui ne sont plus renvoyés", async () => {
    const mocks = configureSupabase({ notchpay_sync_runs: { data: null, error: null } });
    mockListChannels.mockResolvedValue({
      code: 200,
      status: "OK",
      message: "ok",
      channels: [
        { id: "cm.mtn", name: "MTN Mobile Money", country: "CM", currency: "XAF", type: "mobile_money" },
      ],
    });

    const result = await syncChannels("cm");

    expect(result).toEqual({ status: "success", itemsSynced: 1 });
    expect(mockListChannels).toHaveBeenCalledWith("CM");
    const upsertCall = mocks.upsertCalls.find((c) => c.table === "payment_channels");
    expect(upsertCall).toBeDefined();
    expect(upsertCall!.payload).toMatchObject({ channel_code: "cm.mtn", country_code: "CM", currency_code: "XAF" });
    const updateCall = mocks.updateCalls.find((c) => c.table === "payment_channels");
    expect(updateCall).toBeDefined();
    expect(updateCall!.payload).toEqual({ is_available: false });
  });

  it("échec réseau : retourne 'failed' sans lever", async () => {
    configureSupabase({ notchpay_sync_runs: { data: null, error: null } });
    mockListChannels.mockRejectedValue(new Error("timeout"));

    const result = await syncChannels("CM");
    expect(result.status).toBe("failed");
  });
});

describe("getSyncStatus", () => {
  it("aucune synchronisation jamais effectuée : isHealthy=false, tout à null", async () => {
    configureSupabase({ notchpay_sync_runs: { data: [], error: null } });
    const status = await getSyncStatus();
    expect(status).toEqual({ lastSuccessfulSyncAt: null, lastFailedSyncAt: null, lastError: null, isHealthy: false });
  });

  it("dernière tentative en échec après un succès antérieur : isHealthy=false, conserve la date du dernier succès", async () => {
    configureSupabase({
      notchpay_sync_runs: {
        data: [
          { status: "failed", error_message: "boom", finished_at: "2026-09-06T03:00:00Z" },
          { status: "success", error_message: null, finished_at: "2026-09-05T03:00:00Z" },
        ],
        error: null,
      },
    });

    const status = await getSyncStatus();
    expect(status.isHealthy).toBe(false);
    expect(status.lastError).toBe("boom");
    expect(status.lastSuccessfulSyncAt).toBe("2026-09-05T03:00:00Z");
  });

  it("dernière tentative réussie : isHealthy=true", async () => {
    configureSupabase({
      notchpay_sync_runs: {
        data: [{ status: "success", error_message: null, finished_at: "2026-09-06T03:00:00Z" }],
        error: null,
      },
    });

    const status = await getSyncStatus();
    expect(status.isHealthy).toBe(true);
    expect(status.lastError).toBeNull();
  });
});
