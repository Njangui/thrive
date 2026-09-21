import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  // Doit être posé AVANT l'import de `@/lib/env` (validé au chargement du module par la route).
  process.env.FAPSHI_WEBHOOK_SECRET = "secret-de-test-fapshi";
  return { checkRateLimit: vi.fn(), handlePaymentWebhook: vi.fn(), insert: vi.fn() };
});

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/application/services/subscription-payment-service", () => ({ handlePaymentWebhook: mocks.handlePaymentWebhook }));
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    from: () => ({
      insert: mocks.insert,
      update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    }),
  }),
}));

import { POST } from "./route";

const TRANSACTION = { transId: "FAP2026ABC", status: "SUCCESSFUL", amount: 15000, externalId: "pay-local-1" };

function post(body: string, secret?: string): Request {
  return new Request("https://cresyva.test/api/webhooks/fapshi", { method: "POST", body, headers: secret ? { "x-wh-secret": secret } : {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue(null);
  mocks.insert.mockResolvedValue({ error: null });
  mocks.handlePaymentWebhook.mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/webhooks/fapshi", () => {
  it("sans en-tête x-wh-secret, ou avec un mauvais secret -> 401, rien d'écrit ni de traité", async () => {
    expect((await POST(post(JSON.stringify(TRANSACTION)))).status).toBe(401);
    expect((await POST(post(JSON.stringify(TRANSACTION), "mauvais-secret"))).status).toBe(401);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.handlePaymentWebhook).not.toHaveBeenCalled();
  });

  it("bon secret, corps non JSON -> 400", async () => {
    expect((await POST(post("<html>", "secret-de-test-fapshi"))).status).toBe(400);
    expect(mocks.handlePaymentWebhook).not.toHaveBeenCalled();
  });

  it("bon secret : le transId sert de clé d'idempotence ET de référence provider ; le statut brut est journalisé", async () => {
    const res = await POST(post(JSON.stringify(TRANSACTION), "secret-de-test-fapshi"));

    expect(res.status).toBe(200);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ provider: "fapshi", external_event_id: "FAP2026ABC", event_type: "SUCCESSFUL" }));
    expect(mocks.handlePaymentWebhook).toHaveBeenCalledWith("FAP2026ABC");
  });

  it("même transaction livrée deux fois -> le paiement n'est traité qu'UNE fois", async () => {
    mocks.insert.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { code: "23505", message: "duplicate key" } });

    const first = await POST(post(JSON.stringify(TRANSACTION), "secret-de-test-fapshi"));
    const second = await POST(post(JSON.stringify(TRANSACTION), "secret-de-test-fapshi"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.handlePaymentWebhook).toHaveBeenCalledTimes(1);
  });
});
