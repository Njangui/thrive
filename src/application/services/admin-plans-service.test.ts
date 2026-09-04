import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./admin-organizations-service", () => ({
  writeAdminAuditLog: vi.fn(),
}));

interface QueryResult {
  data?: unknown;
  error?: { message: string } | null;
}

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import { getPlansOverviewForAdmin, updatePlanDetails, upsertPlanEntitlementLimit } from "./admin-plans-service";
import { writeAdminAuditLog } from "./admin-organizations-service";
import { ValidationError, NotFoundError } from "@/lib/errors";

const mockWriteAdminAuditLog = vi.mocked(writeAdminAuditLog);

/** Même pattern que ai-credits-service.test.ts / admin-observability-service.test.ts. */
function configureSupabase(byTable: Record<string, QueryResult>) {
  mockFrom.mockImplementation((table: string) => {
    const result: QueryResult = byTable[table] ?? { data: null, error: null };
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      update: () => builder,
      upsert: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
      then: (onFulfilled: (v: QueryResult) => unknown) => Promise.resolve(result).then(onFulfilled),
    };
    return builder;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPlansOverviewForAdmin", () => {
  it("une clé d'entitlement jamais configurée est traitée comme illimitée (-1), jamais comme 0/bloquante", async () => {
    configureSupabase({
      plans: { data: [{ key: "starter", name: "Starter", price_fcfa: 5000, description: null }], error: null },
      plan_entitlements: { data: [], error: null },
    });

    const overview = await getPlansOverviewForAdmin();
    const aiCredits = overview.entitlements.find((e) => e.key === "ai_credits");

    expect(aiCredits?.limitsByPlan).toEqual({ starter: -1, business: -1, pro: -1 });
  });

  it("un bonus 'numéro dédié' jamais configuré vaut 0, jamais -1/illimité", async () => {
    configureSupabase({
      plans: { data: [], error: null },
      plan_entitlements: { data: [], error: null },
    });

    const overview = await getPlansOverviewForAdmin();
    const bonus = overview.dedicatedBonuses.find((e) => e.key === "whatsapp_groups_dedicated_bonus");

    expect(bonus?.limitsByPlan).toEqual({ starter: 0, business: 0, pro: 0 });
  });

  it("reflète fidèlement les valeurs réellement configurées en base", async () => {
    configureSupabase({
      plans: { data: [], error: null },
      plan_entitlements: {
        data: [
          { plan_key: "starter", entitlement_key: "whatsapp_groups", limit_value: 2 },
          { plan_key: "business", entitlement_key: "whatsapp_groups", limit_value: 5 },
          { plan_key: "pro", entitlement_key: "whatsapp_groups", limit_value: 10 },
        ],
        error: null,
      },
    });

    const overview = await getPlansOverviewForAdmin();
    const groups = overview.entitlements.find((e) => e.key === "whatsapp_groups");

    expect(groups?.limitsByPlan).toEqual({ starter: 2, business: 5, pro: 10 });
  });
});

describe("updatePlanDetails", () => {
  it("refuse une clé de plan invalide sans toucher la base", async () => {
    await expect(updatePlanDetails("enterprise", { name: "X", priceFcfa: 1000, description: "" }, "admin-1")).rejects
      .toBeInstanceOf(ValidationError);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("refuse un nom vide", async () => {
    await expect(updatePlanDetails("starter", { name: "   ", priceFcfa: 1000, description: "" }, "admin-1")).rejects
      .toBeInstanceOf(ValidationError);
  });

  it("refuse un prix négatif", async () => {
    await expect(updatePlanDetails("starter", { name: "Starter", priceFcfa: -1, description: "" }, "admin-1")).rejects
      .toBeInstanceOf(ValidationError);
  });

  it("lève NotFoundError si le plan n'existe pas en base (ne devrait pas arriver avec les 3 clés seedées, mais ne doit jamais planter silencieusement)", async () => {
    configureSupabase({ plans: { data: null, error: null } });

    await expect(
      updatePlanDetails("starter", { name: "Starter", priceFcfa: 5000, description: "" }, "admin-1"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("met à jour le plan et écrit un audit log avec la clé texte dans before/after (pas en entityId, qui est uuid)", async () => {
    configureSupabase({
      plans: { data: { name: "Ancien nom", price_fcfa: 4000, description: "Ancienne description" }, error: null },
    });

    await updatePlanDetails("starter", { name: "Starter", priceFcfa: 5000, description: "Nouvelle description" }, "admin-1");

    expect(mockWriteAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "admin-1",
        organizationId: null,
        action: "PLAN_DETAILS_UPDATED",
        beforeState: { planKey: "starter", name: "Ancien nom", price_fcfa: 4000, description: "Ancienne description" },
        afterState: { planKey: "starter", name: "Starter", priceFcfa: 5000, description: "Nouvelle description" },
      }),
    );
    expect(mockWriteAdminAuditLog.mock.calls[0]?.[0]).not.toHaveProperty("entityId");
  });
});

describe("upsertPlanEntitlementLimit", () => {
  it("refuse une clé de plan invalide", async () => {
    await expect(upsertPlanEntitlementLimit("enterprise", "ai_credits", 100, "admin-1")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("refuse une clé d'entitlement inconnue (protège contre une faute de frappe côté formulaire admin)", async () => {
    await expect(upsertPlanEntitlementLimit("starter", "ai_credit", 100, "admin-1")).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("refuse une valeur négative autre que -1", async () => {
    await expect(upsertPlanEntitlementLimit("starter", "ai_credits", -5, "admin-1")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("accepte -1 (illimité) comme valeur valide", async () => {
    configureSupabase({ plan_entitlements: { data: null, error: null } });

    await expect(upsertPlanEntitlementLimit("pro", "ai_credits", -1, "admin-1")).resolves.not.toThrow();
  });

  it("upsert la ligne et écrit un audit log avant/après", async () => {
    configureSupabase({ plan_entitlements: { data: { limit_value: 500 }, error: null } });

    await upsertPlanEntitlementLimit("business", "ai_credits", 750, "admin-1");

    expect(mockWriteAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PLAN_ENTITLEMENT_UPDATED",
        beforeState: { planKey: "business", entitlementKey: "ai_credits", limitValue: 500 },
        afterState: { planKey: "business", entitlementKey: "ai_credits", limitValue: 750 },
      }),
    );
  });

  it("accepte la clé de bonus 'numéro dédié' (pas seulement les jauges/fonctionnalités du dashboard tenant)", async () => {
    configureSupabase({ plan_entitlements: { data: null, error: null } });

    await expect(
      upsertPlanEntitlementLimit("starter", "whatsapp_groups_dedicated_bonus", 1, "admin-1"),
    ).resolves.not.toThrow();
  });
});
