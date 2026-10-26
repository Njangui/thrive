import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./notification-service", () => ({ notifyOrgAdmins: vi.fn() }));
vi.mock("./ai-credits-service", () => ({ initializeCreditBalance: vi.fn(async () => undefined) }));

const mockCreatePayment = vi.fn();
vi.mock("@/infrastructure/providers/registry", () => ({
  getPaymentProvider: vi.fn(async () => ({ providerName: "fapshi", createPayment: mockCreatePayment })),
}));

const mockFrom = vi.fn();
const mockRpc = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

import { listAddons, getOrganizationAddonBonus, purchaseAddon, confirmAddonPurchase } from "./addons-service";
import { notifyOrgAdmins } from "./notification-service";
import { initializeCreditBalance } from "./ai-credits-service";

const mockNotifyOrgAdmins = vi.mocked(notifyOrgAdmins);
const mockInit = vi.mocked(initializeCreditBalance);

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
      paymentUrl: "https://checkout.fapshi.com/pay/xyz",
      status: "pending",
    }));

    const result = await purchaseAddon("org-1", "extra_credits", 2, "user-1", "user@example.com");

    expect(result.paymentUrl).toBe("https://checkout.fapshi.com/pay/xyz");
    expect(mockCreatePayment).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 4000, currency: "XAF", customerEmail: "user@example.com" }),
    );
    // organization_addons n'est JAMAIS appelé par purchaseAddon — seul
    // confirmAddonPurchase (déclenché par le webhook) y écrit.
    expect(mockFrom).not.toHaveBeenCalledWith("organization_addons");
    expect(mockRpc).not.toHaveBeenCalled();
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
  it("applique tout en UNE transaction SQL (apply_addon_purchase) puis notifie une seule fois", async () => {
    mockRpc.mockResolvedValue({ data: { status: "applied", name: "Crédits IA +100", quantity: 2 }, error: null });

    await confirmAddonPurchase({ id: "pay-1", organizationId: "org-1", addonKey: "extra_credits", addonQuantity: 2 });

    expect(mockInit).toHaveBeenCalledWith("org-1");
    expect(mockRpc).toHaveBeenCalledWith("apply_addon_purchase", { p_payment_id: "pay-1" });
    expect(mockNotifyOrgAdmins).toHaveBeenCalledTimes(1);
  });

  it("rejeu d'un paiement déjà appliqué : aucun second effet, aucune seconde notification", async () => {
    mockRpc.mockResolvedValue({ data: { status: "already" }, error: null });
    await confirmAddonPurchase({ id: "pay-1", organizationId: "org-1", addonKey: "extra_credits", addonQuantity: 2 });
    expect(mockNotifyOrgAdmins).not.toHaveBeenCalled();
  });

  it("échec SQL : l'erreur remonte (le paiement passera en effect_failed et sera rejoué)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(
      confirmAddonPurchase({ id: "pay-1", organizationId: "org-1", addonKey: "extra_credits", addonQuantity: 2 }),
    ).rejects.toThrow("boom");
    expect(mockNotifyOrgAdmins).not.toHaveBeenCalled();
  });
});
