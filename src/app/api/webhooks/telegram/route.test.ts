import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Webhook du bot Telegram PLATEFORME (URL fixe) — voir la note en tête de
 * route.ts : ce fichier contenait par erreur une copie du webhook TENANT
 * (`telegram/tenant/[token]/route.ts`), jamais détecté avant `next build`
 * (la route sans segment dynamique déclarait un paramètre `token` qui
 * n'existe jamais). Ce test verrouille le comportement attendu pour éviter
 * la régression : vérification du secret, déduplication `telegram_platform`,
 * dispatch vers `handlePlatformBotMessage` (jamais la logique tenant).
 */
const m = vi.hoisted(() => ({
  handlePlatformBotMessage: vi.fn(),
  insertEvent: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/env", () => ({ env: { TELEGRAM_BOT_WEBHOOK_SECRET: "platform-secret" } }));
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    from: () => ({
      insert: m.insertEvent,
      update: (payload: Record<string, unknown>) => {
        m.updates.push(payload);
        return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
      },
    }),
  }),
}));
vi.mock("@/infrastructure/providers/telegram/webhook-handler", () => ({
  verifyTelegramSecretToken: (headerValue: string | null, expected: string) => headerValue === expected,
  hashPayload: () => "hash",
  parseTelegramUpdate: (raw: string) => JSON.parse(raw),
}));
vi.mock("@/application/services/telegram-bot-service", () => ({ handlePlatformBotMessage: m.handlePlatformBotMessage }));

import { POST } from "./route";

let counter = 0;
function update(overrides: { text?: string; chatId?: number } = {}) {
  counter += 1;
  return {
    update_id: 100000 + counter,
    message: {
      message_id: counter,
      chat: { id: overrides.chatId ?? 42, type: "private" },
      date: 1_700_000_000,
      text: overrides.text ?? "/mystats",
    },
  };
}
function deliver(body: unknown, secret: string | null = "platform-secret") {
  const headers: Record<string, string> = {};
  if (secret !== null) headers["x-telegram-bot-api-secret-token"] = secret;
  return POST(new Request("https://flexco .test/api/webhooks/telegram", { method: "POST", body: JSON.stringify(body), headers }));
}

beforeEach(() => {
  vi.clearAllMocks();
  m.updates.length = 0;
  m.insertEvent.mockResolvedValue({ error: null });
  m.handlePlatformBotMessage.mockResolvedValue(undefined);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Webhook Telegram — bot plateforme (URL fixe)", () => {
  it("secret invalide : rejeté, rien n'est écrit ni traité", async () => {
    const res = await deliver(update(), "mauvais-secret");

    expect(res.status).toBe(401);
    expect(m.insertEvent).not.toHaveBeenCalled();
    expect(m.handlePlatformBotMessage).not.toHaveBeenCalled();
  });

  it("secret absent : rejeté", async () => {
    const res = await deliver(update(), null);
    expect(res.status).toBe(401);
  });

  it("update valide : déduplication sous provider 'telegram_platform', message transmis à handlePlatformBotMessage", async () => {
    const evt = update({ text: "/mystats" });
    const res = await deliver(evt);

    expect(res.status).toBe(200);
    expect(m.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "telegram_platform", external_event_id: String(evt.update_id) }),
    );
    // Jamais 'organization_id' : le bot plateforme n'est rattaché à aucun tenant.
    expect(m.insertEvent.mock.calls[0]![0]).not.toHaveProperty("organization_id");
    expect(m.handlePlatformBotMessage).toHaveBeenCalledWith(evt.message);
    expect(m.updates.at(-1)).toMatchObject({ status: "processed" });
  });

  it("update dupliqué (contrainte unique violée) : ignoré silencieusement, jamais retraité", async () => {
    m.insertEvent.mockResolvedValue({ error: { code: "23505", message: "duplicate" } });

    const res = await deliver(update());

    expect(res.status).toBe(200);
    expect(m.handlePlatformBotMessage).not.toHaveBeenCalled();
  });

  it("échec de handlePlatformBotMessage : capturé, marqué 'failed', réponse 200 quand même (jamais de retry Telegram)", async () => {
    m.handlePlatformBotMessage.mockRejectedValue(new Error("boom"));

    const res = await deliver(update());

    expect(res.status).toBe(200);
    expect(m.updates.at(-1)).toMatchObject({ status: "failed" });
  });

  it("update sans message (ex: callback_query) : aucun crash, marqué 'processed'", async () => {
    counter += 1;
    const res = await deliver({ update_id: 999, callback_query: { id: "cb-1", from: { id: 1, is_bot: false, first_name: "A" } } });

    expect(res.status).toBe(200);
    expect(m.handlePlatformBotMessage).not.toHaveBeenCalled();
    expect(m.updates.at(-1)).toMatchObject({ status: "processed" });
  });
});
