import { describe, expect, it, vi, beforeEach } from "vitest";

let realPlan: string | null = "free";
let active = false;

vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: realPlan ? { plan_key: realPlan } : null, error: null }) }) }) }),
  }),
}));
vi.mock("./promo-trial-core", () => ({ getActivePromo: async () => (active ? { startsAt: "", endsAt: "" } : null) }));
vi.mock("./country-service", () => ({ resolveCurrencyForCountry: vi.fn() }));

import { getOrganizationPlanKey, getOrganizationRealPlanKey } from "./plans-repository";

beforeEach(() => { realPlan = "free"; active = false; });

describe("plan effectif pendant l'essai Pro", () => {
  it("hors essai : le vrai plan, inchangé", async () => {
    for (const p of ["free", "starter", "pro"]) { realPlan = p; expect(await getOrganizationPlanKey("o")).toBe(p); }
  });
  it("pendant l'essai : Pro pour gratuit, Starter et compte sans abonnement", async () => {
    active = true;
    for (const p of ["free", "starter", null]) { realPlan = p; expect(await getOrganizationPlanKey("o")).toBe("pro"); }
  });
  it("le plan réel reste lisible pendant l'essai (facturation, stats)", async () => {
    active = true; realPlan = "starter";
    expect(await getOrganizationRealPlanKey("o")).toBe("starter");
  });
});
