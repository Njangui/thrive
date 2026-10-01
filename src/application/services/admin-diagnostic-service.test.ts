import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: vi.fn() }));
vi.mock("./entitlements-service", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("./promo-trial-service", () => ({ getPromoTrial: vi.fn(), getPromoPhase: vi.fn() }));

import { explainAccess, findMissingEntitlements } from "./admin-diagnostic-service";
import { KNOWN_ENTITLEMENT_KEYS, PLAN_KEYS } from "./plans-repository";

describe("findMissingEntitlements", () => {
  const full = [...KNOWN_ENTITLEMENT_KEYS].flatMap((k) => PLAN_KEYS.map((p) => ({ plan_key: p, entitlement_key: k })));
  it("grille complète : rien de manquant", () => expect(findMissingEntitlements(full)).toEqual([]));
  it("détecte une clé absente pour tous les plans (cas site_customization)", () => {
    const rows = full.filter((r) => r.entitlement_key !== "site_customization");
    expect(findMissingEntitlements(rows)).toEqual(PLAN_KEYS.map((planKey) => ({ planKey, entitlementKey: "site_customization" })));
  });
  it("détecte une seule cellule absente", () => {
    const rows = full.filter((r) => !(r.plan_key === "starter" && r.entitlement_key === "crm"));
    expect(findMissingEntitlements(rows)).toEqual([{ planKey: "starter", entitlementKey: "crm" }]);
  });
});

describe("explainAccess", () => {
  it("sans ligne d'abonnement : explique le repli Discover et renvoie vers les paiements", () => {
    expect(explainAccess({ hasSubscriptionRow: false, realPlan: "free", effectivePlan: "free", phase: "none" })).toMatch(/Aucune ligne d'abonnement/);
  });
  it("essai en cours : plan réel ≠ plan effectif", () => {
    expect(explainAccess({ hasSubscriptionRow: true, realPlan: "starter", effectivePlan: "pro", phase: "active" })).toMatch(/essai Pro offert en cours/);
  });
  it("Pro payant pendant l'essai", () => {
    expect(explainAccess({ hasSubscriptionRow: true, realPlan: "pro", effectivePlan: "pro", phase: "active" })).toMatch(/n'y change rien/);
  });
  it("hors essai : droits du plan réel", () => {
    expect(explainAccess({ hasSubscriptionRow: true, realPlan: "starter", effectivePlan: "starter", phase: "none" })).toMatch(/plan « starter »/);
  });
});
