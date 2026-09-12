import { describe, it, expect, vi, beforeEach } from "vitest";

interface QueryResult {
  data?: unknown;
  error?: { message: string } | null;
}

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

const mockResolveCurrencyForCountry = vi.fn();
vi.mock("./country-service", () => ({
  resolveCurrencyForCountry: (...args: unknown[]) => mockResolveCurrencyForCountry(...args),
}));

import { resolvePlanPriceForCountry, listPlanPricesForCountry, type PlanSummary } from "./plans-repository";

function configureFrom(byTable: Record<string, QueryResult>) {
  mockFrom.mockImplementation((table: string) => {
    const result: QueryResult = byTable[table] ?? { data: null, error: null };
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
    };
    return builder;
  });
}

const businessPlan: PlanSummary = { key: "business", name: "Business", priceFcfa: 15000, description: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolvePlanPriceForCountry", () => {
  it("utilise le prix country-specific quand une ligne active existe", async () => {
    configureFrom({ plan_prices: { data: { amount: 25000, currency_code: "GHS" }, error: null } });

    const result = await resolvePlanPriceForCountry(businessPlan, "GH");

    expect(result).toEqual({ amount: 25000, currencyCode: "GHS", source: "country_specific" });
    expect(mockResolveCurrencyForCountry).not.toHaveBeenCalled();
  });

  it("repli sur plan.priceFcfa + devise du pays quand aucune ligne country-specific n'existe (comportement historique préservé)", async () => {
    configureFrom({ plan_prices: { data: null, error: null } });
    mockResolveCurrencyForCountry.mockResolvedValue("XAF");

    const result = await resolvePlanPriceForCountry(businessPlan, "CM");

    expect(result).toEqual({ amount: 15000, currencyCode: "XAF", source: "fallback_default" });
  });

  it("une erreur de lecture plan_prices retombe aussi sur le prix par défaut, sans lever", async () => {
    configureFrom({ plan_prices: { data: null, error: { message: "connexion perdue" } } });
    mockResolveCurrencyForCountry.mockResolvedValue("XOF");

    const result = await resolvePlanPriceForCountry(businessPlan, "CI");

    expect(result).toEqual({ amount: 15000, currencyCode: "XOF", source: "fallback_default" });
  });
});

describe("listPlanPricesForCountry", () => {
  it("résout le prix de chaque plan pour le pays donné", async () => {
    configureFrom({
      plans: {
        data: [
          { key: "starter", name: "Starter", price_fcfa: 0, description: null },
          { key: "business", name: "Business", price_fcfa: 15000, description: null },
        ],
        error: null,
      },
      plan_prices: { data: null, error: null },
    });
    mockResolveCurrencyForCountry.mockResolvedValue("XAF");

    const result = await listPlanPricesForCountry("CM");

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ key: "business", amount: 15000, currencyCode: "XAF" });
  });
});
