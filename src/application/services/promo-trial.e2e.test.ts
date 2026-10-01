import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Bout en bout (Supabase simulé, vrai plans-repository + vrai
 * entitlements-service) : prouve que le verrou « Mon site / Discover »
 * (`site_customization`, 0 sur free, 1 sur pro) s'ouvre pendant l'essai Pro
 * et se referme dès la date de fin, sans toucher à l'abonnement réel.
 */
const LIMITS: Record<string, number> = { "free:site_customization": 0, "starter:site_customization": 1, "pro:site_customization": 1 };
const DAY = 24 * 60 * 60 * 1000;
let realPlan = "free";
let promoValue: unknown = null;

vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    from: (table: string) => {
      const f: Record<string, string> = {};
      const b = {
        select: () => b,
        eq: (c: string, v: string) => { f[c] = v; return b; },
        maybeSingle: async () => {
          if (table === "organization_subscriptions") return { data: { plan_key: realPlan }, error: null };
          if (table === "platform_settings") return { data: promoValue ? { value: promoValue } : null, error: null };
          if (table === "plan_entitlements") {
            const k = `${f.plan_key}:${f.entitlement_key}`;
            return { data: k in LIMITS ? { limit_value: LIMITS[k] } : null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return b;
    },
  }),
}));
vi.mock("./country-service", () => ({ resolveCurrencyForCountry: vi.fn() }));
vi.mock("./ai-credits-service", () => ({ getCreditStatus: vi.fn() }));
vi.mock("./addons-service", () => ({ getOrganizationAddonBonus: vi.fn().mockResolvedValue(0) }));
vi.mock("./phone-number-repository", () => ({ hasDedicatedPhoneNumber: vi.fn().mockResolvedValue(false) }));

import { canUseFeature } from "./entitlements-service";
import { resetPromoCache } from "./promo-trial-core";

const window = (startOffsetDays: number) => ({
  startsAt: new Date(Date.now() + startOffsetDays * DAY).toISOString(),
  endsAt: new Date(Date.now() + (startOffsetDays + 14) * DAY).toISOString(),
});

beforeEach(() => { realPlan = "free"; promoValue = null; resetPromoCache(); });

describe("essai Pro — verrou site_customization (page Mon site)", () => {
  it("sans essai : verrouillé sur Discover (comportement d'avant)", async () => {
    expect((await canUseFeature("o", "site_customization", 1)).allowed).toBe(false);
  });
  it("essai en cours : déverrouillé pour un compte Discover", async () => {
    promoValue = window(-1);
    expect((await canUseFeature("o", "site_customization", 1)).allowed).toBe(true);
  });
  it("essai terminé : re-verrouillé automatiquement", async () => {
    promoValue = window(-15);
    expect((await canUseFeature("o", "site_customization", 1)).allowed).toBe(false);
  });
  it("essai programmé dans le futur : pas encore actif", async () => {
    promoValue = window(2);
    expect((await canUseFeature("o", "site_customization", 1)).allowed).toBe(false);
  });
});
