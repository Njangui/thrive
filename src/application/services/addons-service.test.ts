import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./notification-service", () => ({ notifyOrgAdmins: vi.fn() }));
vi.mock("./ai-credits-service", () => ({ grantCredits: vi.fn() }));

const mockCreatePayment = vi.fn();
vi.mock("@/infrastructure/providers/registry", () => ({
  getPaymentProvider: vi.fn(async () => ({ providerName: "notchpay", createPayment: mockCreatePayment })),
}));

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import { listAddons, getOrganizationAddonBonus, purchaseAddon, confirmAddonPurchase } from "./addons-service";
import { notifyOrgAdmins } from "./notification-service";
import { grantCredits } from "./ai-credits-service";

const mockNotifyOrgAdmins = vi.mocked(notifyOrgAdmins);
const mockGrantCredits = vi.mocked(grantCredits);

interface TableResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

/** Même pattern établi que ai-credits-service.test.ts (résultat fixe par table). */
function configureSupabase(tableResults: Record<string, TableResult>) {
  mockFrom.mockImplementation((table: string) => {
    const result: TableResult = tableResults[table] ?? { data: null, error: null };
    const builder = {
      select: () => builder,
      eq: () => builder,
      gt: () => builder,
      order: () => builder,
      insert: () => Promise.resolve(result),
      upsert: () => Promise.resolve(result),
      update: () => builder,
      maybeSingle: () => Promise.resolve(result),
      then: (onFulfilled: (v: TableResult) => unknown) => Promise.resolve(result).then(onFulfilled),
    };
    return builder;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listAddons", () => {
  it("ne renvoie que les add-ons actifs par défaut", async () => {
    configureSupabase({
      addons: {
        data: [{ key: "a", name: "A", description: null, price_fcfa: 1000, entitlement_key: "x", increment_value: 1, active: true }],
        error: null,
      },
    });
    const result = await listAddons();
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe("a");
  });
});

describe("getOrganizationAddonBonus", () => {
  it("additionne total_increment_granted (déjà figé) pour les lignes ciblant la bonne entitlement_key — Lot N, ne recalcule jamais depuis increment_value courant", async () => {
    configureSupabase({
      organization_addons: {
        data: [
          { total_increment_granted: 6, addons: { entitlement_key: "whatsapp_groups" } },
          { total_increment_granted: 100, addons: { entitlement_key: "ai_credits" } }, // ignoré : mauvaise clé
        ],
        error: null,
      },
    });

    const bonus = await getOrganizationAddonBonus("org-1", "whatsapp_groups");
    expect(bonus).toBe(6);
  });

  it("ne lève jamais, renvoie 0 sur erreur de lecture (consommé depuis canUseFeature, ne doit jamais casser une vérification de droits)", async () => {
    configureSupabase({ organization_addons: { data: null, error: { message: "connexion perdue" } } });
    const bonus = await getOrganizationAddonBonus("org-1", "whatsapp_groups");
    expect(bonus).toBe(0);
  });
});

describe("purchaseAddon — critère d'acceptation : jamais d'incrément avant confirmation", () => {
  it("crée une ligne subscription_payments 'pending' et renvoie l'URL de checkout, sans toucher organization_addons", async () => {
    configureSupabase({
      addons: {
        data: { key: "extra_credits", name: "Crédits IA +100", price_fcfa: 2000, entitlement_key: "ai_credits", increment_value: 100, active: true },
        error: null,
      },
      subscription_payments: { data: null, error: null },
    });
    mockCreatePayment.mockImplementation(async (req: { orderId: string }) => ({
      providerReference: req.orderId,
      paymentUrl: "https://pay.notchpay.co/checkout/xyz",
      status: "pending",
    }));

    const result = await purchaseAddon("org-1", "extra_credits", 2, "user-1", "user@example.com");

    expect(result.paymentUrl).toBe("https://pay.notchpay.co/checkout/xyz");
    expect(mockCreatePayment).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 4000, currency: "XAF", customerEmail: "user@example.com" }),
    );
    // organization_addons n'est JAMAIS appelé par purchaseAddon — seul
    // confirmAddonPurchase (déclenché par le webhook) y écrit.
    expect(mockFrom).not.toHaveBeenCalledWith("organization_addons");
    expect(mockGrantCredits).not.toHaveBeenCalled();
  });

  it("refuse un add-on désactivé, sans jamais appeler le provider de paiement", async () => {
    configureSupabase({ addons: { data: { key: "x", active: false }, error: null } });
    await expect(purchaseAddon("org-1", "x", 1, "user-1", "user@example.com")).rejects.toThrow();
    expect(mockCreatePayment).not.toHaveBeenCalled();
  });

  it("refuse une quantité nulle ou négative avant tout appel DB", async () => {
    await expect(purchaseAddon("org-1", "x", 0, "user-1", "user@example.com")).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("confirmAddonPurchase — appelé uniquement sur paiement confirmé (webhook)", () => {
  it("incrémente organization_addons ET top-up ai_credit_balances quand l'add-on cible ai_credits", async () => {
    configureSupabase({
      addons: {
        data: { key: "extra_credits", name: "Crédits IA +100", entitlement_key: "ai_credits", increment_value: 100 },
        error: null,
      },
      organization_addons: { data: { quantity: 3 }, error: null }, // possédait déjà 3
    });

    await confirmAddonPurchase({ id: "pay-1", organizationId: "org-1", addonKey: "extra_credits", addonQuantity: 2 });

    // 100 (increment_value) × 2 (addonQuantity) = 200 crédits accordés
    expect(mockGrantCredits).toHaveBeenCalledWith("org-1", 200, "addon_purchase");
    expect(mockNotifyOrgAdmins).toHaveBeenCalledTimes(1);
  });

  it("n'appelle jamais grantCredits pour un add-on ne ciblant pas ai_credits", async () => {
    configureSupabase({
      addons: { data: { key: "extra_groups", name: "+2 groupes WhatsApp", entitlement_key: "whatsapp_groups", increment_value: 2 }, error: null },
      organization_addons: { data: null, error: null },
    });

    await confirmAddonPurchase({ id: "pay-2", organizationId: "org-1", addonKey: "extra_groups", addonQuantity: 1 });

    expect(mockGrantCredits).not.toHaveBeenCalled();
  });

  it("critère d'acceptation Lot N : un second achat après un changement de increment_value ADDITIONNE au bonus déjà figé, ne le recalcule jamais", async () => {
    // Simule : un premier achat a été fait quand increment_value valait 10
    // (total_increment_granted=20 pour quantity=2, déjà en base) ; l'admin
    // a depuis changé increment_value à 50 ; un second achat de 1 unité
    // arrive. Le total attendu est 20 + 50 = 70 — PAS (2+1) × 50 = 150,
    // qui serait une réécriture rétroactive du premier achat.
    let capturedUpsert: Record<string, unknown> | null = null;
    mockFrom.mockImplementation((table: string) => {
      if (table === "addons") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { key: "extra_groups", name: "+2 groupes WhatsApp", entitlement_key: "whatsapp_groups", increment_value: 50 },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "organization_addons") {
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: () => Promise.resolve({ data: { quantity: 2, total_increment_granted: 20 }, error: null }),
          upsert: (payload: Record<string, unknown>) => {
            capturedUpsert = payload;
            return Promise.resolve({ error: null });
          },
        };
        return builder;
      }
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
    });

    await confirmAddonPurchase({ id: "pay-3", organizationId: "org-1", addonKey: "extra_groups", addonQuantity: 1 });

    expect(capturedUpsert).toMatchObject({ quantity: 3, total_increment_granted: 70 });
  });
});
