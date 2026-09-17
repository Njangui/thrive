import { describe, it, expect, vi, beforeEach } from "vitest";

interface QueryResult {
  data?: unknown;
  error?: { message: string } | null;
}

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import { getCountries, getCountry, getChannels } from "./notchpay-resources-service";

/** Même pattern que admin-plans-service.test.ts : résultat fixe par table. */
function configureSupabase(byTable: Record<string, QueryResult>) {
  mockFrom.mockImplementation((table: string) => {
    const result: QueryResult = byTable[table] ?? { data: null, error: null };
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      maybeSingle: () => Promise.resolve(result),
      then: (onFulfilled: (v: QueryResult) => unknown) => Promise.resolve(result).then(onFulfilled),
    };
    return builder;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// CORRECTIF 16/09/2026 : ce fichier ne teste plus que la lecture pure
// (getCountries/getCountry/getChannels). La synchronisation
// automatique depuis NotchPay (syncCountries/syncChannels/
// syncAllResources/getSyncStatus) a été retirée — l'endpoint qu'elle
// appelait n'existe pas réellement côté NotchPay (404 constaté en
// production). Voir docs/notchpay-resources.md pour le détail complet.
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

  it("getCountry renvoie null si aucune ligne (pays inconnu)", async () => {
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
