import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./plans-repository", () => ({
  listPlans: vi.fn(),
}));

vi.mock("./notification-service", () => ({
  notifyOrgAdmins: vi.fn(),
}));

vi.mock("./addons-service", () => ({
  confirmAddonPurchase: vi.fn(),
}));

const mockCreatePayment = vi.fn();
const mockVerifyPayment = vi.fn();
const mockCancelPayment = vi.fn();
vi.mock("@/infrastructure/providers/registry", () => ({
  getPaymentProvider: vi.fn(async () => ({
    providerName: "notchpay",
    createPayment: mockCreatePayment,
    verifyPayment: mockVerifyPayment,
    cancelPayment: mockCancelPayment,
  })),
}));

const mockFrom = vi.fn();
const mockGetUserById = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom, auth: { admin: { getUserById: mockGetUserById } } }),
}));

import {
  initiatePayment,
  cancelPendingPayment,
  handlePaymentWebhook,
  processSubscriptionRenewals,
} from "./subscription-payment-service";
import { listPlans } from "./plans-repository";
import { notifyOrgAdmins } from "./notification-service";
import { confirmAddonPurchase } from "./addons-service";
import type { NotchPayWebhookEvent } from "@/infrastructure/providers/payment/notchpay/types";

const mockListPlans = vi.mocked(listPlans);
const mockNotifyOrgAdmins = vi.mocked(notifyOrgAdmins);
const mockConfirmAddonPurchase = vi.mocked(confirmAddonPurchase);

interface MockPaymentRow {
  id: string;
  organization_id: string;
  payment_type: "plan_subscription" | "addon";
  plan_key: string | null;
  addon_key: string | null;
  addon_quantity: number | null;
  amount_fcfa: number;
  provider_reference: string;
  status: "pending" | "completed" | "failed" | "refunded" | "cancelled";
}

/**
 * Mock Supabase minimal mais STATEFUL (contrairement au pattern
 * "résultat fixe par table" utilisé ailleurs dans le projet) : nécessaire
 * ici pour tester fidèlement la garde d'idempotence
 * `.update(...).eq("status", "pending")`, qui doit se comporter
 * différemment selon l'état ACTUEL de la ligne au moment de l'appel —
 * un résultat fixe ne peut pas représenter "la ligne est déjà passée à
 * completed entre deux appels".
 */
function configureSubscriptionPaymentsMock(initialRow: MockPaymentRow | null) {
  const state: MockPaymentRow | null = initialRow ? { ...initialRow } : null;
  let organizationSubscriptionsUpsertCount = 0;
  let auditLogsInsertCount = 0;

  mockFrom.mockImplementation((table: string) => {
    if (table === "subscription_payments") {
      let pendingUpdate: Record<string, unknown> | null = null;

      // Résout le terminal de la chaîne courante (`.maybeSingle()` OU un
      // `await` direct du builder via `.then()`) contre l'état courant.
      // Une SEULE des deux formes ci-dessous s'applique selon ce que la
      // chaîne a fait avant : `update()` a été appelé -> on rejoue la
      // garde `.eq("status","pending")` réelle ; sinon c'est une lecture
      // simple qui renvoie l'état courant tel quel.
      const resolveTerminal = () => {
        if (pendingUpdate) {
          if (state && state.status === "pending") {
            Object.assign(state, pendingUpdate);
            return { data: { id: state.id }, error: null };
          }
          return { data: null, error: null };
        }
        return { data: state ? { ...state } : null, error: null };
      };

      const builder: {
        select: () => typeof builder;
        eq: () => typeof builder;
        insert: () => Promise<{ error: null }>;
        update: (patch: Record<string, unknown>) => typeof builder;
        maybeSingle: () => Promise<{ data: unknown; error: null }>;
        then: (onFulfilled: (v: { data: unknown; error: null }) => unknown) => Promise<unknown>;
      } = {
        select: () => builder,
        eq: () => builder,
        insert: () => Promise.resolve({ error: null }),
        update: (patch: Record<string, unknown>) => {
          pendingUpdate = patch;
          return builder;
        },
        // Terminal explicite : lecture (`select().eq().maybeSingle()`) OU
        // mise à jour avec relecture (`update().eq().eq().select().maybeSingle()`,
        // utilisée par le webhook pour son id d'idempotence).
        maybeSingle: () => Promise.resolve(resolveTerminal()),
        // Terminal implicite : `await` direct du builder SANS `.maybeSingle()`
        // (`update().eq().eq()`, utilisée par cancelPendingPayment) — le
        // vrai query builder Supabase est "thenable", donc `await` sur le
        // builder appelle `.then()` directement.
        then: (onFulfilled) => Promise.resolve(resolveTerminal()).then(onFulfilled),
      };
      return builder;
    }

    if (table === "organization_subscriptions") {
      return {
        upsert: () => {
          organizationSubscriptionsUpsertCount++;
          return Promise.resolve({ error: null });
        },
      };
    }

    if (table === "audit_logs") {
      return {
        insert: () => {
          auditLogsInsertCount++;
          return Promise.resolve({ error: null });
        },
      };
    }

    return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
  });

  return {
    getState: () => state,
    getOrganizationSubscriptionsUpsertCount: () => organizationSubscriptionsUpsertCount,
    getAuditLogsInsertCount: () => auditLogsInsertCount,
  };
}

function makeWebhookEvent(reference: string, status: "complete" | "failed" = "complete"): NotchPayWebhookEvent {
  return {
    id: "evt_1",
    event: status === "complete" ? "payment.complete" : "payment.failed",
    data: {
      reference,
      status,
      amount: 5000,
      currency: "XAF",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handlePaymentWebhook — idempotence (critère d'acceptation)", () => {
  it("un abonnement confirmé : met à jour organization_subscriptions UNE SEULE fois, même si le webhook est rejoué", async () => {
    const mock = configureSubscriptionPaymentsMock({
      id: "pay-1",
      organization_id: "org-1",
      payment_type: "plan_subscription",
      plan_key: "business",
      addon_key: null,
      addon_quantity: null,
      amount_fcfa: 15000,
      provider_reference: "pay-1",
      status: "pending",
    });
    mockVerifyPayment.mockResolvedValue({ providerReference: "pay-1", status: "succeeded" });

    const event = makeWebhookEvent("pay-1");

    await handlePaymentWebhook(event);
    await handlePaymentWebhook(event); // rejeu — NotchPay documente des retries

    expect(mock.getOrganizationSubscriptionsUpsertCount()).toBe(1);
    expect(mock.getState()?.status).toBe("completed");
    expect(mockNotifyOrgAdmins).toHaveBeenCalledTimes(1);
  });

  it("un achat d'add-on confirmé : appelle confirmAddonPurchase UNE SEULE fois sur rejeu, jamais organization_subscriptions", async () => {
    const mock = configureSubscriptionPaymentsMock({
      id: "pay-2",
      organization_id: "org-1",
      payment_type: "addon",
      plan_key: null,
      addon_key: "extra_ai_credits_100",
      addon_quantity: 2,
      amount_fcfa: 4000,
      provider_reference: "pay-2",
      status: "pending",
    });
    mockVerifyPayment.mockResolvedValue({ providerReference: "pay-2", status: "succeeded" });

    const event = makeWebhookEvent("pay-2");
    await handlePaymentWebhook(event);
    await handlePaymentWebhook(event);

    expect(mockConfirmAddonPurchase).toHaveBeenCalledTimes(1);
    expect(mockConfirmAddonPurchase).toHaveBeenCalledWith({
      id: "pay-2",
      organizationId: "org-1",
      addonKey: "extra_ai_credits_100",
      addonQuantity: 2,
    });
    expect(mock.getOrganizationSubscriptionsUpsertCount()).toBe(0);
  });

  it("aucune ligne locale pour la référence reçue : ignore silencieusement, ne lève jamais", async () => {
    configureSubscriptionPaymentsMock(null);
    const event = makeWebhookEvent("ref-inconnue");

    await expect(handlePaymentWebhook(event)).resolves.not.toThrow();
    expect(mockVerifyPayment).not.toHaveBeenCalled();
  });

  it("un paiement déjà 'completed' ignore un nouvel event sans revérifier ni notifier à nouveau", async () => {
    const mock = configureSubscriptionPaymentsMock({
      id: "pay-3",
      organization_id: "org-1",
      payment_type: "plan_subscription",
      plan_key: "business",
      addon_key: null,
      addon_quantity: null,
      amount_fcfa: 15000,
      provider_reference: "pay-3",
      status: "completed",
    });

    await handlePaymentWebhook(makeWebhookEvent("pay-3"));

    expect(mockVerifyPayment).not.toHaveBeenCalled();
    expect(mock.getOrganizationSubscriptionsUpsertCount()).toBe(0);
    expect(mockNotifyOrgAdmins).not.toHaveBeenCalled();
  });

  it("échec confirmé côté provider (re-vérifié via l'API, jamais sur la seule foi du webhook) : marque failed et notifie", async () => {
    configureSubscriptionPaymentsMock({
      id: "pay-4",
      organization_id: "org-1",
      payment_type: "plan_subscription",
      plan_key: "starter",
      addon_key: null,
      addon_quantity: null,
      amount_fcfa: 5000,
      provider_reference: "pay-4",
      status: "pending",
    });
    mockVerifyPayment.mockResolvedValue({ providerReference: "pay-4", status: "failed" });

    await handlePaymentWebhook(makeWebhookEvent("pay-4", "failed"));

    expect(mockVerifyPayment).toHaveBeenCalledWith("pay-4"); // jamais de confiance aveugle au seul event.data.status
    expect(mockNotifyOrgAdmins).toHaveBeenCalledTimes(1);
  });
});

describe("initiatePayment", () => {
  it("crée une ligne pending puis renvoie l'URL de checkout du provider", async () => {
    configureSubscriptionPaymentsMock(null);
    mockListPlans.mockResolvedValue([
      { key: "business", name: "Business", priceFcfa: 15000, description: null },
    ] as never);
    mockCreatePayment.mockImplementation(async (req: { orderId: string }) => ({
      providerReference: req.orderId,
      paymentUrl: "https://pay.notchpay.co/checkout/abc",
      status: "pending",
    }));

    const result = await initiatePayment("org-1", "business" as never, "user-1", "user@example.com");

    expect(result.paymentUrl).toBe("https://pay.notchpay.co/checkout/abc");
    expect(mockCreatePayment).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", amount: 15000, currency: "XAF", customerEmail: "user@example.com" }),
    );
  });

  it("rejette un plan inconnu avant tout appel provider", async () => {
    mockListPlans.mockResolvedValue([]);
    await expect(initiatePayment("org-1", "inexistant" as never, "user-1", "user@example.com")).rejects.toThrow();
    expect(mockCreatePayment).not.toHaveBeenCalled();
  });
});

describe("processSubscriptionRenewals — relance J-3 et passage past_due (Lot N)", () => {
  interface MockSubRow {
    organization_id: string;
    status: "trialing" | "active" | "past_due";
    trial_end: string | null;
    current_period_end: string | null;
    last_renewal_reminder_sent_at: string | null;
  }

  function configureRenewalMocks(subscriptions: MockSubRow[]) {
    const subState = subscriptions.map((s) => ({ ...s }));
    const updateCalls: Array<{ organizationId: string; patch: Record<string, unknown> }> = [];

    mockFrom.mockImplementation((table: string) => {
      if (table === "organization_subscriptions") {
        let mode: "read" | "update" = "read";
        let patch: Record<string, unknown> = {};
        const filters: Array<{ col: string; val: unknown }> = [];

        const builder = {
          select: () => builder,
          in: () => builder, // le mock ne filtre pas réellement : subState ne contient que trialing/active, comme le ferait la vraie requête
          update: (p: Record<string, unknown>) => {
            mode = "update";
            patch = p;
            return builder;
          },
          eq: (col: string, val: unknown) => {
            filters.push({ col, val });
            return builder;
          },
          is: (col: string, val: unknown) => {
            filters.push({ col, val });
            return builder;
          },
          // Utilisé par generateRenewalPaymentLink (lecture d'UNE ligne par
          // organization_id) — distinct de la lecture liste (.in()) utilisée
          // par processSubscriptionRenewals lui-même.
          maybeSingle: () => {
            const orgFilter = filters.find((f) => f.col === "organization_id");
            const row = subState.find((s) => s.organization_id === orgFilter?.val);
            return Promise.resolve({ data: row ? { ...row } : null, error: null });
          },
          then: (onFulfilled: (v: { data?: unknown; error: null }) => unknown) => {
            if (mode === "read") {
              return Promise.resolve({ data: subState.map((s) => ({ ...s })), error: null }).then(onFulfilled);
            }
            const orgFilter = filters.find((f) => f.col === "organization_id");
            const row = subState.find((s) => s.organization_id === orgFilter?.val);
            const guardsPass =
              !!row &&
              filters.every((f) => f.col === "organization_id" || (row as unknown as Record<string, unknown>)[f.col] === f.val);
            if (row && guardsPass) {
              updateCalls.push({ organizationId: row.organization_id, patch });
              Object.assign(row, patch);
            }
            return Promise.resolve({ error: null }).then(onFulfilled);
          },
        };
        return builder;
      }

      if (table === "memberships") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () => Promise.resolve({ data: { user_id: "owner-1" }, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }

      if (table === "subscription_payments") {
        return { insert: () => Promise.resolve({ error: null }) };
      }

      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
    });

    mockGetUserById.mockResolvedValue({ data: { user: { email: "owner@example.com" } }, error: null });
    mockListPlans.mockResolvedValue([{ key: "starter", name: "Starter", priceFcfa: 5000, description: null }] as never);
    // providerReference doit correspondre au paymentId généré côté service
    // (randomUUID, imprévisible) pour ne pas déclencher le log défensif
    // "diffère du paymentId local" — on le fait écho depuis orderId reçu.
    mockCreatePayment.mockImplementation(async (req: { orderId: string }) => ({
      providerReference: req.orderId,
      paymentUrl: "https://pay.notchpay.co/checkout/renewal",
      status: "pending",
    }));

    return { subState, updateCalls };
  }

  function daysFromNow(days: number): string {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  it("échéance dans 2 jours (< J-3), jamais relancée : envoie une relance avec lien de paiement et marque last_renewal_reminder_sent_at", async () => {
    const { updateCalls } = configureRenewalMocks([
      {
        organization_id: "org-1",
        status: "trialing",
        trial_end: daysFromNow(2),
        current_period_end: null,
        last_renewal_reminder_sent_at: null,
      },
    ]);

    const result = await processSubscriptionRenewals();

    expect(result).toEqual({ remindersSent: 1, markedPastDue: 0, skipped: 0 });
    expect(mockNotifyOrgAdmins).toHaveBeenCalledTimes(1);
    expect(mockNotifyOrgAdmins.mock.calls[0]![0]).toMatchObject({ organizationId: "org-1" });
    expect(updateCalls).toContainEqual(
      expect.objectContaining({ organizationId: "org-1", patch: expect.objectContaining({ last_renewal_reminder_sent_at: expect.any(String) }) }),
    );
  });

  it("critère d'acceptation : une échéance déjà relancée n'est jamais relancée une seconde fois", async () => {
    configureRenewalMocks([
      {
        organization_id: "org-1",
        status: "trialing",
        trial_end: daysFromNow(1),
        current_period_end: null,
        last_renewal_reminder_sent_at: daysFromNow(-1), // relance déjà envoyée hier pour cette échéance
      },
    ]);

    const result = await processSubscriptionRenewals();

    expect(result).toEqual({ remindersSent: 0, markedPastDue: 0, skipped: 1 });
    expect(mockNotifyOrgAdmins).not.toHaveBeenCalled();
  });

  it("échéance dépassée : passe past_due et notifie, sans relance de paiement", async () => {
    const { subState } = configureRenewalMocks([
      {
        organization_id: "org-2",
        status: "active",
        trial_end: null,
        current_period_end: daysFromNow(-1),
        last_renewal_reminder_sent_at: daysFromNow(-4),
      },
    ]);

    const result = await processSubscriptionRenewals();

    expect(result).toEqual({ remindersSent: 0, markedPastDue: 1, skipped: 0 });
    expect(subState[0]!.status).toBe("past_due");
    expect(mockNotifyOrgAdmins).toHaveBeenCalledTimes(1);
  });

  it("échéance hors fenêtre J-3 (dans 10 jours) : ignorée, aucune relance ni notification", async () => {
    configureRenewalMocks([
      {
        organization_id: "org-3",
        status: "active",
        trial_end: null,
        current_period_end: daysFromNow(10),
        last_renewal_reminder_sent_at: null,
      },
    ]);

    const result = await processSubscriptionRenewals();

    expect(result).toEqual({ remindersSent: 0, markedPastDue: 0, skipped: 1 });
    expect(mockNotifyOrgAdmins).not.toHaveBeenCalled();
  });
});

describe("cancelPendingPayment", () => {
  it("annule un paiement pending (best-effort côté provider) et met à jour le statut local", async () => {
    const mock = configureSubscriptionPaymentsMock({
      id: "pay-5",
      organization_id: "org-1",
      payment_type: "plan_subscription",
      plan_key: "starter",
      addon_key: null,
      addon_quantity: null,
      amount_fcfa: 5000,
      provider_reference: "pay-5",
      status: "pending",
    });

    await cancelPendingPayment("org-1", "pay-5");

    expect(mockCancelPayment).toHaveBeenCalledWith("pay-5");
    expect(mock.getState()?.status).toBe("cancelled");
  });

  it("refuse d'annuler un paiement déjà completed", async () => {
    configureSubscriptionPaymentsMock({
      id: "pay-6",
      organization_id: "org-1",
      payment_type: "plan_subscription",
      plan_key: "starter",
      addon_key: null,
      addon_quantity: null,
      amount_fcfa: 5000,
      provider_reference: "pay-6",
      status: "completed",
    });

    await expect(cancelPendingPayment("org-1", "pay-6")).rejects.toThrow();
    expect(mockCancelPayment).not.toHaveBeenCalled();
  });
});
