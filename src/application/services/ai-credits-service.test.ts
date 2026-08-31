import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./plans-repository", () => ({
  getOrganizationPlanKey: vi.fn(),
  getEntitlementLimit: vi.fn(),
}));

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import {
  getCreditStatus,
  hasCreditsAvailable,
  consumeCredit,
  initializeCreditBalance,
  grantCredits,
} from "./ai-credits-service";
import { getOrganizationPlanKey, getEntitlementLimit } from "./plans-repository";

const mockGetOrganizationPlanKey = vi.mocked(getOrganizationPlanKey);
const mockGetEntitlementLimit = vi.mocked(getEntitlementLimit);

interface TableResult {
  data?: unknown;
  error?: { message: string } | null;
}

/**
 * Fabrique un client Supabase minimal pour ces tests : chaque table
 * renvoie toujours le même résultat (data/error) pour n'importe quel
 * appel terminal (maybeSingle / insert / upsert / update().eq()).
 * Suffisant pour tester la logique de ai-credits-service.ts sans
 * réimplémenter le query builder complet de supabase-js — cohérent avec
 * la convention du projet ("mocker les fonctions DB-dépendantes, garder
 * les fonctions pures réelles").
 */
function configureSupabase(tableResults: Record<string, TableResult>) {
  mockFrom.mockImplementation((table: string) => {
    const result: TableResult = tableResults[table] ?? { data: null, error: null };
    const builder = {
      select: () => builder,
      eq: () => builder,
      update: () => builder,
      insert: () => Promise.resolve(result),
      upsert: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
      then: (onFulfilled: (v: TableResult) => unknown) => Promise.resolve(result).then(onFulfilled),
    };
    return builder;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCreditStatus", () => {
  it("calcule le solde restant depuis une ligne existante", async () => {
    configureSupabase({
      ai_credit_balances: { data: { included_credits: 500, used_credits: 120 }, error: null },
    });

    const status = await getCreditStatus("org-1");
    expect(status).toEqual({
      organizationId: "org-1",
      includedCredits: 500,
      usedCredits: 120,
      remainingCredits: 380,
    });
  });

  it("gère un plan illimité (-1) sans produire de valeur négative", async () => {
    configureSupabase({
      ai_credit_balances: { data: { included_credits: -1, used_credits: 9999 }, error: null },
    });

    const status = await getCreditStatus("org-1");
    expect(status.remainingCredits).toBe(-1);
  });

  it("ne descend jamais sous 0 même si used_credits dépasse included_credits", async () => {
    configureSupabase({
      ai_credit_balances: { data: { included_credits: 100, used_credits: 150 }, error: null },
    });

    const status = await getCreditStatus("org-1");
    expect(status.remainingCredits).toBe(0);
  });

  it("tenant sans ligne ai_credit_balances : calcule un statut virtuel depuis son plan, ne plante pas", async () => {
    configureSupabase({ ai_credit_balances: { data: null, error: null } });
    mockGetOrganizationPlanKey.mockResolvedValue("business");
    mockGetEntitlementLimit.mockResolvedValue(500);

    const status = await getCreditStatus("org-legacy");

    expect(mockGetOrganizationPlanKey).toHaveBeenCalledWith("org-legacy");
    expect(mockGetEntitlementLimit).toHaveBeenCalledWith("business", "ai_credits");
    expect(status).toEqual({
      organizationId: "org-legacy",
      includedCredits: 500,
      usedCredits: 0,
      remainingCredits: 500,
    });
  });
});

describe("hasCreditsAvailable", () => {
  it("vrai si le solde restant couvre le montant demandé", async () => {
    configureSupabase({ ai_credit_balances: { data: { included_credits: 10, used_credits: 5 }, error: null } });
    expect(await hasCreditsAvailable("org-1", 3)).toBe(true);
  });

  it("faux si le montant demandé dépasse le solde restant", async () => {
    configureSupabase({ ai_credit_balances: { data: { included_credits: 10, used_credits: 9 }, error: null } });
    expect(await hasCreditsAvailable("org-1", 5)).toBe(false);
  });

  it("toujours vrai en illimité", async () => {
    configureSupabase({ ai_credit_balances: { data: { included_credits: -1, used_credits: 0 }, error: null } });
    expect(await hasCreditsAvailable("org-1", 100000)).toBe(true);
  });
});

describe("consumeCredit", () => {
  it("rejette un montant négatif ou nul avant tout appel réseau", async () => {
    await expect(consumeCredit("org-1", 0)).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("incrémente used_credits et journalise l'évènement sans lever", async () => {
    configureSupabase({
      ai_credit_balances: { data: { used_credits: 10 }, error: null },
      ai_usage_events: { data: null, error: null },
    });

    await expect(consumeCredit("org-1", 5, "ai_reply")).resolves.toBeUndefined();
  });

  it("initialise à la volée un solde manquant (tenant créé avant ce lot) plutôt que de planter", async () => {
    configureSupabase({
      ai_credit_balances: { data: null, error: null },
      ai_usage_events: { data: null, error: null },
    });
    mockGetOrganizationPlanKey.mockResolvedValue("starter");
    mockGetEntitlementLimit.mockResolvedValue(150);

    await expect(consumeCredit("org-legacy", 1)).resolves.toBeUndefined();
    expect(mockGetEntitlementLimit).toHaveBeenCalledWith("starter", "ai_credits");
  });
});

describe("initializeCreditBalance", () => {
  it("résout la valeur incluse depuis plan_entitlements quand aucun montant n'est fourni (remplace DEFAULT_INCLUDED_CREDITS)", async () => {
    configureSupabase({ ai_credit_balances: { data: null, error: null } });
    mockGetOrganizationPlanKey.mockResolvedValue("starter");
    mockGetEntitlementLimit.mockResolvedValue(150);

    await initializeCreditBalance("org-1");

    expect(mockGetOrganizationPlanKey).toHaveBeenCalledWith("org-1");
    expect(mockGetEntitlementLimit).toHaveBeenCalledWith("starter", "ai_credits");
  });

  it("utilise le montant explicite fourni sans interroger le plan (signature compatible Lot C)", async () => {
    configureSupabase({ ai_credit_balances: { data: null, error: null } });

    await initializeCreditBalance("org-1", 1000);

    expect(mockGetOrganizationPlanKey).not.toHaveBeenCalled();
    expect(mockGetEntitlementLimit).not.toHaveBeenCalled();
  });
});

describe("grantCredits", () => {
  it("rejette un montant négatif ou nul", async () => {
    await expect(grantCredits("org-1", 0)).rejects.toThrow();
  });

  it("additionne au solde inclus existant", async () => {
    configureSupabase({
      ai_credit_balances: { data: { included_credits: 500 }, error: null },
      ai_usage_events: { data: null, error: null },
    });

    await expect(grantCredits("org-1", 100, "geste_commercial")).resolves.toBeUndefined();
  });

  it("n'essaie pas d'additionner sur un plan illimité, mais journalise quand même l'évènement", async () => {
    configureSupabase({
      ai_credit_balances: { data: { included_credits: -1 }, error: null },
      ai_usage_events: { data: null, error: null },
    });

    await expect(grantCredits("org-1", 100)).resolves.toBeUndefined();
  });
});
