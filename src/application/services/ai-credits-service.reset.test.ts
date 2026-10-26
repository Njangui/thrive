import { describe, expect, it, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ rpc }),
}));
vi.mock("./plans-repository", () => ({ getOrganizationPlanKey: vi.fn(), getOrganizationRealPlanKey: vi.fn(), getEntitlementLimit: async () => 150 }));

import { resetCreditBalanceForPlan } from "./ai-credits-service";

beforeEach(() => rpc.mockReset());

describe("resetCreditBalanceForPlan (changement de palier)", () => {
  it("passe par la RPC atomique : nouveau plafond, crédits d'add-on non consommés conservés côté SQL", async () => {
    rpc.mockResolvedValue({ error: null });
    await resetCreditBalanceForPlan("o", "starter");
    expect(rpc).toHaveBeenCalledWith("reset_ai_credits_for_plan", { p_organization_id: "o", p_included: 150 });
  });
  it("remonte l'erreur (le paiement est alors rejoué, pas perdu)", async () => {
    rpc.mockResolvedValue({ error: { message: "x" } });
    await expect(resetCreditBalanceForPlan("o", "starter")).rejects.toThrow("x");
  });
});
