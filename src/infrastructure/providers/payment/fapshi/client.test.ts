import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FapshiClient } from "./client";

const BASE = "https://sandbox.fapshi.test";
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("FapshiClient — requêtes", () => {
  it("initiatePay : POST /initiate-pay avec apiuser + apikey et le payload en JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "ok", link: "https://checkout.fapshi.test/x", transId: "TX-1", dateInitiated: "2026-09-21" }));
    const client = new FapshiClient("user", "key", BASE);

    const result = await client.initiatePay({ amount: 5000, email: "a@b.cm", externalId: "pay-1", userId: "org-1", message: "Abonnement" });

    expect(result.transId).toBe("TX-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/initiate-pay`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ apiuser: "user", apikey: "key", "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ amount: 5000, email: "a@b.cm", externalId: "pay-1", userId: "org-1", message: "Abonnement" });
  });

  it("paymentStatus : GET /payment-status/:transId, identifiant encodé dans l'URL", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ transId: "TX/1 ?", status: "PENDING", amount: 5000 }));
    const client = new FapshiClient("user", "key", BASE);

    await client.paymentStatus("TX/1 ?");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/payment-status/TX%2F1%20%3F`);
    expect(init.method).toBeUndefined();
    expect(init.headers).toMatchObject({ apiuser: "user", apikey: "key" });
  });

  it("expirePay : POST /expire-pay avec { transId }", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ transId: "TX-9", status: "EXPIRED", amount: 5000 }));
    const client = new FapshiClient("user", "key", BASE);

    await client.expirePay("TX-9");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/expire-pay`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ transId: "TX-9" });
  });
});

describe("FapshiClient — configuration et erreurs", () => {
  it.each([
    ["apiuser absent", undefined, "key"],
    ["apikey absente", "user", undefined],
    ["apiuser vide", "", "key"],
  ])("%s -> erreur explicite, AUCUN appel réseau", async (_label, apiUser, apiKey) => {
    const client = new FapshiClient(apiUser, apiKey, BASE);

    await expect(client.initiatePay({ amount: 500 })).rejects.toThrow(/FAPSHI_API_USER\/FAPSHI_API_KEY manquants/);
    await expect(client.paymentStatus("TX-1")).rejects.toThrow(/manquants/);
    await expect(client.expirePay("TX-1")).rejects.toThrow(/manquants/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("réponse HTTP en erreur -> l'exception porte le statut ET le corps renvoyé par Fapshi", async () => {
    fetchMock.mockResolvedValue(new Response("amount cannot be less than 100", { status: 400 }));
    const client = new FapshiClient("user", "key", BASE);

    await expect(client.initiatePay({ amount: 50 })).rejects.toThrow("Fapshi initiatePay a échoué (400): amount cannot be less than 100");
  });

  it("corps d'erreur illisible -> l'exception est quand même levée avec le statut (pas de crash sur text())", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, text: () => Promise.reject(new Error("socket hang up")) } as unknown as Response);
    const client = new FapshiClient("user", "key", BASE);

    await expect(client.paymentStatus("TX-1")).rejects.toThrow("Fapshi paymentStatus a échoué (502): ");
  });
});
