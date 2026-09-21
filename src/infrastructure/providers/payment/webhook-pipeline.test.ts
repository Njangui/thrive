import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  handlePaymentWebhook: vi.fn(),
  insert: vi.fn(),
  updateCalls: [] as Array<{ table: string; payload: Record<string, unknown>; filters: Array<[string, string]> }>,
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/application/services/subscription-payment-service", () => ({ handlePaymentWebhook: mocks.handlePaymentWebhook }));
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    from: (table: string) => ({
      insert: (row: unknown) => mocks.insert(table, row),
      update: (payload: Record<string, unknown>) => {
        const call = { table, payload, filters: [] as Array<[string, string]> };
        mocks.updateCalls.push(call);
        const chain = {
          eq(column: string, value: string) {
            call.filters.push([column, value]);
            return chain;
          },
          then(resolve: (value: { error: null }) => void) {
            resolve({ error: null });
          },
        };
        return chain;
      },
    }),
  }),
}));

import { handlePaymentWebhookRequest, type PaymentWebhookConfig } from "./webhook-pipeline";

function makeConfig(overrides: Partial<PaymentWebhookConfig> = {}): PaymentWebhookConfig {
  return {
    providerName: "fapshi",
    verify: vi.fn(() => true),
    parse: (raw) => {
      const event = JSON.parse(raw) as { transId: string; status: string };
      return { externalEventId: event.transId, eventType: event.status, providerReference: event.transId };
    },
    ...overrides,
  };
}
function makeRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://cresyva.test/api/webhooks/fapshi", { method: "POST", body, headers });
}
const BODY = JSON.stringify({ transId: "TX-1", status: "SUCCESSFUL" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateCalls.length = 0;
  mocks.checkRateLimit.mockResolvedValue(null);
  mocks.insert.mockResolvedValue({ error: null });
  mocks.handlePaymentWebhook.mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("handlePaymentWebhookRequest — garde-fous avant tout traitement", () => {
  it("rate limit dépassé -> 429 + Retry-After, la requête n'est même pas vérifiée", async () => {
    mocks.checkRateLimit.mockResolvedValue(30);
    const config = makeConfig();

    const res = await handlePaymentWebhookRequest(makeRequest(BODY), config);

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(config.verify).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("clé de rate limit = 1re adresse de x-forwarded-for, « unknown » sans en-tête", async () => {
    await handlePaymentWebhookRequest(makeRequest(BODY, { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }), makeConfig());
    await handlePaymentWebhookRequest(makeRequest(BODY), makeConfig());

    expect(mocks.checkRateLimit).toHaveBeenNthCalledWith(1, "webhook", "203.0.113.9");
    expect(mocks.checkRateLimit).toHaveBeenNthCalledWith(2, "webhook", "unknown");
  });

  it("authentification invalide -> 401, rien n'est écrit ni traité", async () => {
    const res = await handlePaymentWebhookRequest(makeRequest(BODY), makeConfig({ verify: () => false }));

    expect(res.status).toBe(401);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.handlePaymentWebhook).not.toHaveBeenCalled();
  });

  it("corps illisible (parse lève) -> 400, rien n'est écrit ni traité", async () => {
    const res = await handlePaymentWebhookRequest(makeRequest("pas du json"), makeConfig());

    expect(res.status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.handlePaymentWebhook).not.toHaveBeenCalled();
  });
});

describe("handlePaymentWebhookRequest — idempotence (webhook_events)", () => {
  it("livraison dupliquée (23505) -> 200 sans retraiter le paiement", async () => {
    mocks.insert.mockResolvedValue({ error: { code: "23505", message: "duplicate key" } });

    const res = await handlePaymentWebhookRequest(makeRequest(BODY), makeConfig());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.handlePaymentWebhook).not.toHaveBeenCalled();
    expect(mocks.updateCalls).toHaveLength(0);
  });

  it("échec d'écriture de la table d'audit -> 200 quand même (ne jamais provoquer de re-livraison en boucle), rien traité", async () => {
    mocks.insert.mockResolvedValue({ error: { code: "XX000", message: "db down" } });

    const res = await handlePaymentWebhookRequest(makeRequest(BODY), makeConfig());

    expect(res.status).toBe(200);
    expect(mocks.handlePaymentWebhook).not.toHaveBeenCalled();
  });
});

describe("handlePaymentWebhookRequest — traitement", () => {
  it("nominal : l'événement est réservé AVANT le traitement, puis marqué « processed »", async () => {
    const res = await handlePaymentWebhookRequest(makeRequest(BODY), makeConfig());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.insert).toHaveBeenCalledWith("webhook_events", {
      organization_id: null,
      provider: "fapshi",
      external_event_id: "TX-1",
      event_type: "SUCCESSFUL",
      payload_hash: crypto.createHash("sha256").update(BODY).digest("hex"),
      status: "received",
    });
    expect(mocks.handlePaymentWebhook).toHaveBeenCalledWith("TX-1");
    expect(mocks.insert.mock.invocationCallOrder[0]).toBeLessThan(mocks.handlePaymentWebhook.mock.invocationCallOrder[0] as number);
    expect(mocks.updateCalls).toHaveLength(1);
    expect(mocks.updateCalls[0]?.payload).toMatchObject({ status: "processed", error_message: null });
    expect(mocks.updateCalls[0]?.filters).toEqual([["provider", "fapshi"], ["external_event_id", "TX-1"]]);
  });

  it("échec du traitement -> toujours 200, événement marqué « failed » avec le message d'erreur", async () => {
    mocks.handlePaymentWebhook.mockRejectedValue(new Error("crédit impossible"));

    const res = await handlePaymentWebhookRequest(makeRequest(BODY), makeConfig());

    expect(res.status).toBe(200);
    expect(mocks.updateCalls[0]?.payload).toMatchObject({ status: "failed", error_message: "crédit impossible" });
  });

  it("échec avec une valeur qui n'est pas une Error -> message converti en chaîne", async () => {
    mocks.handlePaymentWebhook.mockRejectedValue("échec brut");

    await handlePaymentWebhookRequest(makeRequest(BODY), makeConfig());

    expect(mocks.updateCalls[0]?.payload).toMatchObject({ status: "failed", error_message: "échec brut" });
  });
});
