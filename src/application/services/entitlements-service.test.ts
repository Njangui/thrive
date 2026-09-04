import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./plans-repository", () => ({
  getOrganizationPlanKey: vi.fn(),
  getEntitlementLimit: vi.fn(),
  countOrganizationRows: vi.fn(),
}));

vi.mock("./ai-credits-service", () => ({
  getCreditStatus: vi.fn(),
}));

vi.mock("./addons-service", () => ({
  getOrganizationAddonBonus: vi.fn(),
}));

vi.mock("./phone-number-repository", () => ({
  hasDedicatedPhoneNumber: vi.fn(),
}));

import { canUseFeature, evaluateEntitlement } from "./entitlements-service";
import { getOrganizationPlanKey, getEntitlementLimit, countOrganizationRows } from "./plans-repository";
import { getCreditStatus } from "./ai-credits-service";
import { getOrganizationAddonBonus } from "./addons-service";
import { hasDedicatedPhoneNumber } from "./phone-number-repository";

const mockGetOrganizationPlanKey = vi.mocked(getOrganizationPlanKey);
const mockGetEntitlementLimit = vi.mocked(getEntitlementLimit);
const mockCountOrganizationRows = vi.mocked(countOrganizationRows);
const mockGetCreditStatus = vi.mocked(getCreditStatus);
const mockGetOrganizationAddonBonus = vi.mocked(getOrganizationAddonBonus);
const mockHasDedicatedPhoneNumber = vi.mocked(hasDedicatedPhoneNumber);

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
    // Défaut pour tous les tests pré-existants (chemin générique, hors
    // ai_credits) qui ne testent pas spécifiquement les add-ons — évite
    // de devoir amender chacun d'eux individuellement (Lot G).
    mockGetOrganizationAddonBonus.mockResolvedValue(0);
    // Lot 4 : idem pour le bonus "numéro dédié" — par défaut aucune
    // organisation n'a de numéro assigné, comportement identique à avant
    // ce lot pour tous les tests qui ne le testent pas explicitement.
    mockHasDedicatedPhoneNumber.mockResolvedValue(false);
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
    // Lot F : ne compte que les groupes 'connected' contre le quota (voir
    // plans-repository.ts/countOrganizationRows — 3e argument optionnel et
    // rétrocompatible, ajouté par ce lot) — sinon déconnecter un groupe ne
    // libérerait jamais son quota.
    expect(mockCountOrganizationRows).toHaveBeenCalledWith("whatsapp_groups", "org-1", ["connected"]);
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

  // --- Lot G : bonus add-ons (limite plan + somme des add-ons actifs) ---

  it("Lot G : additionne le bonus add-ons à la limite du plan (clé cumulative)", async () => {
    mockGetOrganizationPlanKey.mockResolvedValue("starter");
    mockGetEntitlementLimit.mockResolvedValue(3); // limite plan starter, ex: whatsapp_groups
    mockGetOrganizationAddonBonus.mockResolvedValue(2); // 1 add-on "+2 groupes" acheté
    mockCountOrganizationRows.mockResolvedValue(4);

    const result = await canUseFeature("org-1", "whatsapp_groups", 1);

    expect(mockGetOrganizationAddonBonus).toHaveBeenCalledWith("org-1", "whatsapp_groups");
    // limite effective = 3 (plan) + 2 (add-on) = 5 ; used=4 ; +1 reste <= 5 -> autorisé
    expect(result).toEqual({ allowed: true, limit: 5, used: 4, remaining: 1 });
  });

  it("Lot G : sans add-on possédé (bonus=0), le comportement est identique à avant ce lot", async () => {
    mockGetOrganizationPlanKey.mockResolvedValue("starter");
    mockGetEntitlementLimit.mockResolvedValue(3);
    mockGetOrganizationAddonBonus.mockResolvedValue(0);
    mockCountOrganizationRows.mockResolvedValue(3);

    const result = await canUseFeature("org-1", "whatsapp_groups", 1);
    expect(result).toEqual({ allowed: false, limit: 3, used: 3, remaining: 0 });
  });

  it("Lot G : n'interroge jamais le bonus add-ons quand le plan est déjà illimité (-1)", async () => {
    mockGetOrganizationPlanKey.mockResolvedValue("pro");
    mockGetEntitlementLimit.mockResolvedValue(-1);

    const result = await canUseFeature("org-1", "whatsapp_groups", 100);

    expect(mockGetOrganizationAddonBonus).not.toHaveBeenCalled();
    expect(result).toEqual({ allowed: true, limit: -1, used: 0, remaining: -1 });
  });

  it("Lot G : le bonus add-ons s'applique aussi à une clé 'par action' (broadcast_contacts)", async () => {
    mockGetOrganizationPlanKey.mockResolvedValue("starter");
    mockGetEntitlementLimit.mockResolvedValue(50);
    mockGetOrganizationAddonBonus.mockResolvedValue(100); // add-on "+100 contacts"

    const result = await canUseFeature("org-1", "broadcast_contacts", 120);
    // limite effective = 50 + 100 = 150 ; requestedAmount=120 <= 150 -> autorisé
    // (aurait été refusé sans le bonus : 120 > 50)
    expect(result).toEqual({ allowed: true, limit: 150, used: 0, remaining: 150 });
  });

  it("Lot G : ai_credits ne consulte jamais getOrganizationAddonBonus (délégué entièrement à getCreditStatus)", async () => {
    mockGetCreditStatus.mockResolvedValue({
      organizationId: "org-1",
      includedCredits: 600, // suppose déjà topé par un addon via grantCredits, hors scope de canUseFeature
      usedCredits: 100,
      remainingCredits: 500,
    });

    await canUseFeature("org-1", "ai_credits", 1);

    expect(mockGetOrganizationAddonBonus).not.toHaveBeenCalled();
  });

  // --- Lot 4 : bonus "numéro dédié" (section 55 du master prompt) ---

  it("Lot 4 : ajoute le bonus numéro dédié à la limite de whatsapp_groups quand un numéro est assigné", async () => {
    mockGetOrganizationPlanKey.mockResolvedValue("starter");
    mockGetEntitlementLimit.mockResolvedValueOnce(2); // limite de base du plan starter
    mockHasDedicatedPhoneNumber.mockResolvedValue(true);
    mockGetEntitlementLimit.mockResolvedValueOnce(1); // bonus starter (+1)
    mockCountOrganizationRows.mockResolvedValue(2);

    const result = await canUseFeature("org-1", "whatsapp_groups", 1);

    expect(mockHasDedicatedPhoneNumber).toHaveBeenCalledWith("org-1");
    expect(mockGetEntitlementLimit).toHaveBeenNthCalledWith(2, "starter", "whatsapp_groups_dedicated_bonus");
    // limite effective = 2 (plan) + 0 (add-on) + 1 (bonus numéro dédié) = 3 ; used=2 ; +1 <= 3 -> autorisé
    // (aurait été refusé sans le bonus : 2 + 1 > 2)
    expect(result).toEqual({ allowed: true, limit: 3, used: 2, remaining: 1 });
  });

  it("Lot 4 : n'ajoute aucun bonus numéro dédié à une clé différente de whatsapp_groups", async () => {
    mockGetOrganizationPlanKey.mockResolvedValue("starter");
    mockGetEntitlementLimit.mockResolvedValue(50); // broadcast_contacts
    mockHasDedicatedPhoneNumber.mockResolvedValue(true); // même avec un numéro dédié assigné

    const result = await canUseFeature("org-1", "broadcast_contacts", 50);

    expect(mockHasDedicatedPhoneNumber).not.toHaveBeenCalled();
    expect(result).toEqual({ allowed: true, limit: 50, used: 0, remaining: 50 });
  });

  it("Lot 4 : sans numéro dédié assigné (défaut), le comportement whatsapp_groups est identique à avant ce lot", async () => {
    mockGetOrganizationPlanKey.mockResolvedValue("starter");
    mockGetEntitlementLimit.mockResolvedValue(2);
    mockCountOrganizationRows.mockResolvedValue(2);

    const result = await canUseFeature("org-1", "whatsapp_groups", 1);

    expect(mockHasDedicatedPhoneNumber).toHaveBeenCalledWith("org-1");
    // Un seul appel à getEntitlementLimit : jamais la clé de bonus, puisque hasDedicatedPhoneNumber() = false.
    expect(mockGetEntitlementLimit).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ allowed: false, limit: 2, used: 2, remaining: 0 });
  });

  it("Lot 4 : n'interroge jamais le bonus numéro dédié quand le plan whatsapp_groups est déjà illimité (-1)", async () => {
    mockGetOrganizationPlanKey.mockResolvedValue("pro");
    mockGetEntitlementLimit.mockResolvedValue(-1);

    const result = await canUseFeature("org-1", "whatsapp_groups", 100);

    expect(mockHasDedicatedPhoneNumber).not.toHaveBeenCalled();
    expect(result).toEqual({ allowed: true, limit: -1, used: 0, remaining: -1 });
  });

  it("Lot 4 : un bonus numéro dédié non configuré (absence de ligne, -1) est traité comme 0, jamais illimité", async () => {
    mockGetOrganizationPlanKey.mockResolvedValue("starter");
    mockGetEntitlementLimit.mockResolvedValueOnce(2);
    mockHasDedicatedPhoneNumber.mockResolvedValue(true);
    // getEntitlementLimit renvoie -1 pour "clé non configurée" (plans-repository.ts) — ne doit
    // jamais être interprété comme un bonus illimité.
    mockGetEntitlementLimit.mockResolvedValueOnce(-1);
    mockCountOrganizationRows.mockResolvedValue(2);

    const result = await canUseFeature("org-1", "whatsapp_groups", 1);

    // Sans le garde-fou, limit serait -1 (illimité) ou 1 (2 + -1) au lieu de 2.
    expect(result).toEqual({ allowed: false, limit: 2, used: 2, remaining: 0 });
  });
});
