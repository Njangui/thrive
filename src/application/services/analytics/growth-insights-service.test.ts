import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
let members: Array<{ user_id: string; organization_id: string }> = [];
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    rpc,
    from: () => {
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
        maybeSingle: () => Promise.resolve({ data: members.find((m) => filters.every((f) => f(m))) ?? null, error: null }),
      };
      return b;
    },
  }),
}));

import { getGrowthInsights, mapDemand, mapForecast, mapMargin } from "./growth-insights-service";

const actor = { userId: "u1", organizationId: "org-1" };
beforeEach(() => {
  rpc.mockReset();
  members = [{ user_id: "u1", organization_id: "org-1" }];
});

describe("getGrowthInsights", () => {
  it("refuse un acteur étranger à l'organisation SANS appeler le SQL", async () => {
    await expect(getGrowthInsights({ userId: "intrus", organizationId: "org-1" })).rejects.toThrow(/n'appartenez pas/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("appelle les 7 fonctions avec p_org de l'acteur et convertit les numériques texte en nombres", async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "c5_stockout_forecast") return { data: [{ product_id: "p1", name: "Riz", current_stock: "10.00", min_stock: "2", daily_rate: "1.000", days_left: "10.0" }], error: null };
      if (fn === "c5_product_margins") return { data: [{ product_id: "p2", name: "Sac", units: "4", revenue: "40000", cost: null, margin: null, margin_pct: null, cost_known: false }], error: null };
      return { data: [], error: null };
    });
    const out = await getGrowthInsights(actor, { dormantDays: 90 });
    expect(rpc).toHaveBeenCalledTimes(7);
    for (const call of rpc.mock.calls) expect(call[1].p_org).toBe("org-1");
    expect(rpc.mock.calls.find((c) => c[0] === "c5_dormant_stock")![1].p_days).toBe(90);
    expect(out.forecast[0]).toEqual({ productId: "p1", name: "Riz", currentStock: 10, minStock: 2, dailyRate: 1, daysLeft: 10 });
    expect(out.margins[0]).toMatchObject({ cost: null, margin: null, marginPct: null, costKnown: false });
  });

  it("une erreur SQL remonte avec le nom de l'analyse, jamais un résultat partiel silencieux", async () => {
    rpc.mockImplementation(async (fn: string) => (fn === "c5_inactive_customers" ? { data: null, error: { message: "boom" } } : { data: [], error: null }));
    await expect(getGrowthInsights(actor)).rejects.toThrow(/c5_inactive_customers.*boom/);
  });

  it("demande par produit : p_days transmis, valeurs numériques converties, vues gardées mais distinctes des clics", async () => {
    rpc.mockImplementation(async (fn: string) => (fn === "c5_product_demand" ? { data: [{ product_id: "p1", name: "Robe", current_stock: "0.00", min_stock: "2", unit_price: "15000.00", clicks: 12, clicks_prev: 2, views: 40, units_sold: "0" }], error: null } : { data: [], error: null }));
    const out = await getGrowthInsights(actor, { demandDays: 7 });
    expect(rpc.mock.calls.find((c) => c[0] === "c5_product_demand")![1]).toMatchObject({ p_org: "org-1", p_days: 7 });
    expect(out.demand![0]).toEqual({ productId: "p1", name: "Robe", currentStock: 0, minStock: 2, unitPrice: 15000, clicks: 12, clicksPrev: 2, views: 40, unitsSold: 0 });
    expect(mapDemand({}).clicks).toBe(0);
  });

  it("les mappeurs gardent NULL (coût inconnu) distinct de 0", () => {
    expect(mapMargin({ product_id: "x", name: "n", units: 1, revenue: 1, cost: null, margin: null, margin_pct: null, cost_known: false }).marginPct).toBeNull();
    expect(mapMargin({ product_id: "x", name: "n", units: 1, revenue: 1, cost: 0, margin: 0, margin_pct: 0, cost_known: true }).marginPct).toBe(0);
    expect(mapForecast({}).daysLeft).toBe(0);
  });
});
