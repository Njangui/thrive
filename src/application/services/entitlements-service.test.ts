import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./plans-repository", () => ({
  getOrganizationPlanKey: vi.fn(),
  getEntitlementLimit: vi.fn(),
  countOrganizationRows: vi.fn(),
}));

vi.mock("./ai-credits-service", () => ({
  getCreditStatus: vi.fn(),
}));

import { canUseFeature, evaluateEntitlement } from "./entitlements-service";
import { getOrganizationPlanKey, getEntitlementLimit, countOrganizationRows } from "./plans-repository";
import { getCreditStatus } from "./ai-credits-service";

const mockGetOrganizationPlanKey = vi.mocked(getOrganizationPlanKey);
const mockGetEntitlementLimit = vi.mocked(getEntitlementLimit);
const mockCountOrganizationRows = vi.mocked(countOrganizationRows);
const mockGetCreditStatus = vi.mocked(getCreditStatus);

describe("evaluateEntitlement (fonction pure)", () => {
  it("autorise toujours quand la limite est illimitée (-1)", () => {
    expect(evaluateEntitlement(-1, 999, 50)).toEqual({ allowed: true, limit: -1, used: 999, remaining: -1 });
  });

  it("autorise quand used + requestedAmount reste dans la limite", () => {
    expect(evaluateEntitlement(10, 3, 5)).toEqual({ allowed: true, limit: 10, used: 3, remaining: 7 });
  });

  it("refuse pile au-dessus de la limite (used + requestedAmount > limit)", () => {
    expect(evaluateEntitlement(10, 8, 5)).toEqual({ allowed: false, limit: 10, used: 8, remaining: 2 });
  });

  it("autorise pile à la limite (used + requestedAmount === limit)", () => {
    expect(evaluateEntitlement(10, 5, 5)).toEqual({ allowed: true, limit: 10, used: 5, remaining: 5 });
  });

  it("mode 'par action'/booléen (used=0) : ne dépend que de requestedAmount vs limit", () => {
    // ex: limite booléenne facebook_messenger=0 -> toute tentative refusée
    expect(evaluateEntitlement(0, 0, 1)).toEqual({ allowed: false, limit: 0, used: 0, remaining: 0 });
    // ex: limite booléenne linkedin=1 -> autorisé
    expect(evaluateEntitlement(1, 0, 1)).toEqual({ allowed: true, limit: 1, used: 0, remaining: 1 });
    // ex: broadcast_contacts=100, campagne de 150 contacts -> refusé
    expect(evaluateEntitlement(100, 0, 150)).toEqual({ allowed: false, limit: 100, used: 0, remaining: 100 });
  });

  it("remaining ne descend jamais sous 0 même si used dépasse déjà la limite", () => {
    expect(evaluateEntitlement(10, 15, 1).remaining).toBe(0);
  });
});

describe("canUseFeature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("délègue entièrement à getCreditStatus() pour la clé 'ai_credits'", async () => {
    mockGetCreditStatus.mockResolvedValue({
      organizationId: "org-1",
      includedCredits: 500,
      usedCredits: 480,
      remainingCredits: 20,
    });

    const result = await canUseFeature("org-1", "ai_credits", 10);

    expect(result).toEqual({ allowed: true, limit: 500, used: 480, remaining: 20 });
    expect(mockGetCreditStatus).toHaveBeenCalledWith("org-1");
    // Ne doit pas passer par plan_entitlements pour cette clé (déléguée).
    expect(mockGetEntitlementLimit).not.toHaveBeenCalled();
  });

  it("refuse quand la demande dépasse les crédits IA restants", async () => {
    mockGetCreditStatus.mockResolvedValue({
      organizationId: "org-1",
      includedCredits: 500,
      usedCredits: 495,
      remainingCredits: 5,
    });

    const result = await canUseFeature("org-1", "ai_credits", 10);
    expect(result.allowed).toBe(false);
  });

  it("compte les lignes existantes pour une clé cumulative (whatsapp_groups)", async () => {
    mockGetOrganizationPlanKey.mockResolvedValue("business");
    mockGetEntitlementLimit.mockResolvedValue(10);
    mockCountOrganizationRows.mockResolvedValue(7);

    const result = await canUseFeature("org-1", "whatsapp_groups", 2);

    expect(mockGetOrganizationPlanKey).toHaveBeenCalledWith("org-1");
    expect(mockGetEntitlementLimit).toHaveBeenCalledWith("business", "whatsapp_groups");
    expect(mockCountOrganizationRows).toHaveBeenCalledWith("whatsapp_groups", "org-1");
    expect(result).toEqual({ allowed: true, limit: 10, used: 7, remaining: 3 });
  });

  it("ne compte pas les lignes quand la limite est illimitée (-1) : pas d'appel DB inutile", async () => {
    mockGetOrganizationPlanKey.mockResolvedValue("pro");
    mockGetEntitlementLimit.mockResolvedValue(-1);

    const result = await canUseFeature("org-1", "whatsapp_groups", 100);

    expect(mockCountOrganizationRows).not.toHaveBeenCalled();
    expect(result).toEqual({ allowed: true, limit: -1, used: 0, remaining: -1 });
  });

  it("traite une clé 'par action' (broadcast_contacts) sans compter d'usage cumulé", async () => {
    mockGetOrganizationPlanKey.mockResolvedValue("starter");
    mockGetEntitlementLimit.mockResolvedValue(50);

    const withinLimit = await canUseFeature("org-1", "broadcast_contacts", 40);
    expect(withinLimit).toEqual({ allowed: true, limit: 50, used: 0, remaining: 50 });
    expect(mockCountOrganizationRows).not.toHaveBeenCalled();

    const overLimit = await canUseFeature("org-1", "broadcast_contacts", 60);
    expect(overLimit.allowed).toBe(false);
  });

  it("traite une clé booléenne (linkedin) comme 0/1 : Starter refuse, Pro autorise", async () => {
    mockGetOrganizationPlanKey.mockResolvedValueOnce("starter").mockResolvedValueOnce("pro");
    mockGetEntitlementLimit.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const starterResult = await canUseFeature("org-starter", "linkedin");
    expect(starterResult.allowed).toBe(false);

    const proResult = await canUseFeature("org-pro", "linkedin");
    expect(proResult.allowed).toBe(true);
  });

  it("critère d'acceptation : une clé sans ligne plan_entitlements est traitée comme illimitée, jamais bloquée", async () => {
    mockGetOrganizationPlanKey.mockResolvedValue("starter");
    mockGetEntitlementLimit.mockResolvedValue(-1); // getEntitlementLimit retourne -1 si pas de ligne (plans-repository.ts)

    const result = await canUseFeature("org-1", "une_cle_pas_encore_seedee", 999);
    expect(result.allowed).toBe(true);
  });

  it("critère d'acceptation : un tenant sans ligne organization_subscriptions ne plante jamais (plan 'starter' par défaut)", async () => {
    // getOrganizationPlanKey (plans-repository.ts) retourne déjà "starter"
    // par défaut en interne dans ce cas — on vérifie juste que
    // canUseFeature n'ajoute aucune logique qui pourrait planter.
    mockGetOrganizationPlanKey.mockResolvedValue("starter");
    mockGetEntitlementLimit.mockResolvedValue(3);
    mockCountOrganizationRows.mockResolvedValue(1);

    await expect(canUseFeature("org-legacy", "whatsapp_groups", 1)).resolves.not.toThrow();
  });

  it("requestedAmount par défaut vaut 1 quand non précisé", async () => {
    mockGetOrganizationPlanKey.mockResolvedValue("starter");
    mockGetEntitlementLimit.mockResolvedValue(0);

    const result = await canUseFeature("org-1", "tiktok");
    expect(result.allowed).toBe(false); // 0 + 1 > 0
  });
});
