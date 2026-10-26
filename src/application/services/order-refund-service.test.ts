import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeDb } from "../../../tests/helpers/fake-supabase";

vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: () => ({}) }));
const raiseAlert = vi.fn();
vi.mock("./alert-service", async () => {
  const actual = await vi.importActual<typeof import("./alert-service")>("./alert-service");
  return { ...actual, raiseAlert: (...a: unknown[]) => raiseAlert(...a) };
});
vi.mock("@/infrastructure/providers/registry", () => ({ getEmailProvider: async () => ({}), getMessagingProviderForChannel: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://app.test" } }));

import { alertRefundOverThreshold, getRefundedTotal, getRefundThreshold, recordOrderRefund } from "./order-refund-service";
import { NotFoundError, ValidationError } from "@/lib/errors";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ORDER = "00000000-0000-4000-8000-000000000020";
let db: FakeDb; let rpcArgs: Record<string, unknown>;
const input = { organizationId: ORG, orderId: ORDER, amount: 1000, reason: "Produit défectueux", actorUserId: "user-1", actorMembershipId: "mem-1" };
beforeEach(() => { db = new FakeDb(); raiseAlert.mockReset(); raiseAlert.mockResolvedValue({ status: "raised" }); });

describe("recordOrderRefund (appel SQL atomique)", () => {
  it("transmet l'acteur et renvoie cumul + reste calculés", async () => {
    db.rpcHandlers.record_order_refund = (a) => { rpcArgs = a; return { data: [{ refund_id: "r-1", order_total: 4500, refunded_total: 1000, currency: "XAF" }], error: null }; };
    const r = await recordOrderRefund(input, db as unknown as SupabaseClient);
    expect(rpcArgs).toEqual({ p_organization_id: ORG, p_order_id: ORDER, p_amount: 1000, p_reason: "Produit défectueux", p_actor_user_id: "user-1", p_actor_membership_id: "mem-1" });
    expect(r).toEqual({ refundId: "r-1", orderTotal: 4500, refundedTotal: 1000, currency: "XAF", remaining: 3500 });
  });
  it.each([["ORDER_NOT_FOUND", NotFoundError], ["ORDER_NOT_COMPLETED", ValidationError], ["REFUND_EXCEEDS_TOTAL", ValidationError], ["REFUND_AMOUNT_INVALID", ValidationError]])("%s → erreur métier lisible", async (code, Err) => {
    db.rpcHandlers.record_order_refund = () => ({ data: null, error: { message: code } });
    await expect(recordOrderRefund(input, db as unknown as SupabaseClient)).rejects.toBeInstanceOf(Err);
  });
  it("erreur inconnue : propagée, jamais avalée", async () => {
    db.rpcHandlers.record_order_refund = () => ({ data: null, error: { message: "connexion perdue" } });
    await expect(recordOrderRefund(input, db as unknown as SupabaseClient)).rejects.toThrow(/connexion perdue/);
  });
});

describe("lectures", () => {
  it("total remboursé : filtré par organisation ET commande", async () => {
    db.seed("order_refunds", [{ organization_id: ORG, order_id: ORDER, amount: 1000 }, { organization_id: ORG, order_id: ORDER, amount: 250.5 }, { organization_id: OTHER, order_id: ORDER, amount: 9999 }, { organization_id: ORG, order_id: "autre", amount: 7 }]);
    expect(await getRefundedTotal(ORG, ORDER, db as unknown as SupabaseClient)).toBe(1250.5);
    expect(await getRefundedTotal(OTHER, "inconnue", db as unknown as SupabaseClient)).toBe(0);
  });
  it("seuil : celui du propriétaire (réglages d'alertes), sinon aucun — jamais de valeur par défaut", async () => {
    expect(await getRefundThreshold(ORG, db as unknown as SupabaseClient)).toBeUndefined();
    db.seed("alert_settings", [{ organization_id: ORG, triggers: { refund_over_threshold: { enabled: true, threshold: 50000 } } }]);
    expect(await getRefundThreshold(ORG, db as unknown as SupabaseClient)).toBe(50000);
    expect(await getRefundThreshold(OTHER, db as unknown as SupabaseClient)).toBeUndefined();
  });
});

describe("alerte", () => {
  it("lève l'alerte critique avec la valeur et une clé de déduplication par remboursement", async () => {
    await alertRefundOverThreshold({ organizationId: ORG, orderId: ORDER, refundId: "r-1", amount: 60000, currency: "XAF" });
    expect(raiseAlert).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG, trigger: "refund_over_threshold", value: 60000, dedupeKey: "refund:r-1" }));
  });
  it("un échec d'alerte ne casse jamais un remboursement déjà enregistré", async () => {
    raiseAlert.mockRejectedValue(new Error("panne"));
    await expect(alertRefundOverThreshold({ organizationId: ORG, orderId: ORDER, refundId: "r-1", amount: 1, currency: "XAF" })).resolves.toBeUndefined();
  });
});
