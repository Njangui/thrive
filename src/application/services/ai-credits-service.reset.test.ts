import { describe, expect, it, vi, beforeEach } from "vitest";

const calls: Record<string, unknown>[] = [];
let failWithPromoColumn = false;

vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    from: () => ({
      upsert: async (row: Record<string, unknown>) => {
        calls.push(row);
        return "promo_bonus_credits" in row && failWithPromoColumn
          ? { error: { message: 'column "promo_bonus_credits" of relation "ai_credit_balances" does not exist' } }
          : { error: null };
      },
    }),
    rpc: vi.fn(),
  }),
}));
vi.mock("./plans-repository", () => ({ getOrganizationPlanKey: vi.fn(), getOrganizationRealPlanKey: vi.fn(), getEntitlementLimit: async () => 150 }));
vi.mock("./promo-trial-core", () => ({ getActivePromo: async () => null }));

import { resetCreditBalanceForPlan } from "./ai-credits-service";

beforeEach(() => { calls.length = 0; failWithPromoColumn = false; });

describe("resetCreditBalanceForPlan (changement de palier, y compris pendant l'essai Pro)", () => {
  it("remet aussi le bonus d'essai à 0 : il ne sera pas retiré une 2e fois à la fin", async () => {
    await resetCreditBalanceForPlan("o", "starter");
    expect(calls).toEqual([{ organization_id: "o", included_credits: 150, used_credits: 0, promo_bonus_credits: 0 }]);
  });
  it("migration 0073 pas encore appliquée : repli sans la colonne, le paiement ne casse jamais", async () => {
    failWithPromoColumn = true;
    await expect(resetCreditBalanceForPlan("o", "starter")).resolves.toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ organization_id: "o", included_credits: 150, used_credits: 0 });
  });
});
