import { describe, expect, it, vi, beforeEach } from "vitest";

let balance: { included_credits: number; promo_bonus_credits: number } | null = null;
let active = false;
let realPlan = "free";
const updates: { patch: Record<string, unknown>; filters: [string, unknown][] }[] = [];

vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: balance, error: null }) }) }),
      update: (patch: Record<string, unknown>) => {
        const entry = { patch, filters: [] as [string, unknown][] };
        updates.push(entry);
        const b = { eq: (c: string, v: unknown) => { entry.filters.push([c, v]); return b; }, then: (f: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(f) };
        return b;
      },
    }),
    rpc: vi.fn(),
  }),
}));
vi.mock("./promo-trial-core", () => ({ getActivePromo: async () => (active ? {} : null) }));
vi.mock("./plans-repository", () => ({
  getOrganizationPlanKey: vi.fn(),
  getOrganizationRealPlanKey: async () => realPlan,
  getEntitlementLimit: async (plan: string) => ({ free: 0, starter: 150, pro: 300 })[plan] ?? 0,
}));

import { syncPromoCredits } from "./ai-credits-service";

beforeEach(() => { balance = { included_credits: 0, promo_bonus_credits: 0 }; active = false; realPlan = "free"; updates.length = 0; });

describe("syncPromoCredits", () => {
  it("pendant l'essai : un compte gratuit reçoit la différence Pro − gratuit et elle est mémorisée", async () => {
    active = true;
    await syncPromoCredits("o");
    expect(updates).toHaveLength(1);
    expect(updates[0]?.patch).toEqual({ included_credits: 300, promo_bonus_credits: 300 });
    expect(updates[0]?.filters).toContainEqual(["promo_bonus_credits", 0]); // garde anti-double application
  });
  it("Starter reçoit seulement la différence (300 − 150)", async () => {
    active = true; realPlan = "starter"; balance = { included_credits: 150, promo_bonus_credits: 0 };
    await syncPromoCredits("o");
    expect(updates[0]?.patch).toEqual({ included_credits: 300, promo_bonus_credits: 150 });
  });
  it("bonus déjà accordé : aucune nouvelle écriture", async () => {
    active = true; balance = { included_credits: 300, promo_bonus_credits: 300 };
    await syncPromoCredits("o");
    expect(updates).toHaveLength(0);
  });
  it("Pro payant : rien à accorder", async () => {
    active = true; realPlan = "pro"; balance = { included_credits: 300, promo_bonus_credits: 0 };
    await syncPromoCredits("o");
    expect(updates).toHaveLength(0);
  });
  it("après l'essai : le bonus est retiré exactement, les crédits d'origine restent", async () => {
    active = false; balance = { included_credits: 450, promo_bonus_credits: 300 };
    await syncPromoCredits("o");
    expect(updates[0]?.patch).toEqual({ included_credits: 150, promo_bonus_credits: 0 });
  });
  it("après l'essai, sans bonus : aucune écriture", async () => {
    await syncPromoCredits("o");
    expect(updates).toHaveLength(0);
  });
});
