import { beforeEach, describe, expect, it, vi } from "vitest";
import { FapshiAdapter } from "./adapter";
import type { FapshiClient } from "./client";
import type { FapshiTransactionStatus } from "./types";

const client = {
  initiatePay: vi.fn(),
  paymentStatus: vi.fn(),
  expirePay: vi.fn(),
};
const adapter = new FapshiAdapter(client as unknown as FapshiClient);

beforeEach(() => {
  vi.clearAllMocks();
  client.initiatePay.mockResolvedValue({ message: "ok", link: "https://checkout.fapshi.test/abc", transId: "FAP-777", dateInitiated: "2026-09-21" });
});

const baseRequest = { organizationId: "org-1", orderId: "pay-local-1", amount: 15000, currency: "XAF", customerEmail: "client@exemple.cm", description: "Abonnement Pro" };

describe("FapshiAdapter.createPayment", () => {
  it("mappe la requête du port vers initiate-pay et renvoie la référence GÉNÉRÉE par Fapshi (jamais l'orderId)", async () => {
    const result = await adapter.createPayment(baseRequest);

    expect(client.initiatePay).toHaveBeenCalledWith({ amount: 15000, email: "client@exemple.cm", externalId: "pay-local-1", userId: "org-1", message: "Abonnement Pro" });
    expect(result).toEqual({ providerReference: "FAP-777", paymentUrl: "https://checkout.fapshi.test/abc", status: "pending" });
    expect(result.providerReference).not.toBe(baseRequest.orderId);
  });

  it("refuse toute devise autre que XAF, sans appeler Fapshi", async () => {
    await expect(adapter.createPayment({ ...baseRequest, currency: "NGN" })).rejects.toThrow(/ne traite que le XAF.*"NGN"/);
    expect(client.initiatePay).not.toHaveBeenCalled();
  });

  it("montant minimum 100 XAF : 99 refusé, 100 accepté", async () => {
    await expect(adapter.createPayment({ ...baseRequest, amount: 99 })).rejects.toThrow(/minimum accepté est 100 XAF/);
    expect(client.initiatePay).not.toHaveBeenCalled();

    await expect(adapter.createPayment({ ...baseRequest, amount: 100 })).resolves.toMatchObject({ status: "pending" });
    expect(client.initiatePay).toHaveBeenCalledTimes(1);
  });

  it("laisse remonter l'erreur du client (le service applicatif décide quoi en faire)", async () => {
    client.initiatePay.mockRejectedValue(new Error("Fapshi initiatePay a échoué (500): boom"));
    await expect(adapter.createPayment(baseRequest)).rejects.toThrow("boom");
  });
});

describe("FapshiAdapter.verifyPayment / getPaymentStatus", () => {
  it.each<[FapshiTransactionStatus, "pending" | "succeeded" | "failed"]>([
    ["SUCCESSFUL", "succeeded"],
    ["CREATED", "pending"],
    ["PENDING", "pending"],
    ["FAILED", "failed"],
    ["EXPIRED", "failed"],
  ])("statut Fapshi %s -> %s", async (fapshiStatus, expected) => {
    const transaction = { transId: "FAP-1", status: fapshiStatus, amount: 15000 };
    client.paymentStatus.mockResolvedValue(transaction);

    const result = await adapter.verifyPayment("FAP-1");

    expect(client.paymentStatus).toHaveBeenCalledWith("FAP-1");
    expect(result).toEqual({ providerReference: "FAP-1", status: expected, rawPayload: transaction });
  });

  it("getPaymentStatus lit le même endpoint que verifyPayment", async () => {
    client.paymentStatus.mockResolvedValue({ transId: "FAP-2", status: "SUCCESSFUL", amount: 100 });

    const result = await adapter.getPaymentStatus("FAP-2");

    expect(client.paymentStatus).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("succeeded");
  });
});

describe("FapshiAdapter — divers", () => {
  it("cancelPayment expire le lien côté Fapshi", async () => {
    client.expirePay.mockResolvedValue({});
    await adapter.cancelPayment("FAP-3");
    expect(client.expirePay).toHaveBeenCalledWith("FAP-3");
  });

  it("providerName = 'fapshi' (doit correspondre à webhook_events.provider et à la config de la route)", () => {
    expect(adapter.providerName).toBe("fapshi");
  });
});
