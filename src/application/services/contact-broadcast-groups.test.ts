import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Une diffusion vers des CONTACTS (« Diffusions ») n'est PAS une diffusion vers des GROUPES WhatsApp
 * (« Groupes WhatsApp ») : un fil de groupe ne doit jamais devenir destinataire d'une campagne de contacts.
 */
const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown>,
  ops: [] as Array<{ table: string; op: string; payload?: unknown }>,
  groupThreadIds: new Set<string>(),
  sendMessage: vi.fn(),
}));

vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const result = (): { data: unknown; error: unknown } => {
        const value = db.tables[table];
        return typeof value === "function" ? (value as (f: Record<string, unknown>) => { data: unknown; error: unknown })(filters) : ((value as { data: unknown; error: unknown } | undefined) ?? { data: [], error: null });
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        in: () => builder,
        gte: () => builder,
        lte: () => builder,
        order: () => builder,
        limit: () => builder,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        update: (payload: unknown) => {
          db.ops.push({ table, op: "update", payload });
          return builder;
        },
        insert: (payload: unknown) => {
          db.ops.push({ table, op: "insert", payload });
          return Promise.resolve({ error: null });
        },
        maybeSingle: () => {
          const r = result();
          return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error ?? null });
        },
        then: (resolve: (value: unknown) => void) => resolve(result()),
      };
      return builder;
    },
  }),
}));
vi.mock("@/infrastructure/providers/registry", () => ({ getMessagingProviderForChannel: vi.fn(async () => ({ sendMessage: db.sendMessage })) }));
vi.mock("./feature-gate-service", () => ({ assertGatedFeature: vi.fn() }));
vi.mock("./entitlements-service", () => ({ isFeatureEnabled: vi.fn(async () => ({ enabled: true, limit: 50 })) }));
vi.mock("./notification-service", () => ({ notifyOrgAdmins: vi.fn(async () => undefined) }));

import { previewBroadcastAudience, processDueContactBroadcasts } from "./contact-broadcast-service";

beforeEach(() => {
  vi.clearAllMocks();
  db.ops.length = 0;
  db.groupThreadIds = new Set(["grp-1"]);
  db.tables = {
    whatsapp_groups: (filters: Record<string, unknown>) =>
      filters.external_id !== undefined
        ? { data: db.groupThreadIds.has(String(filters.external_id)) ? { id: "g-1" } : null, error: null }
        : { data: [...db.groupThreadIds].map((external_id) => ({ external_id })), error: null },
  };
  db.sendMessage.mockResolvedValue({ providerMessageId: "m-1", status: "sent" });
});

describe("Diffusion vers des contacts — jamais vers un fil de groupe WhatsApp", () => {
  it("l'audience exclut les fils de groupe WhatsApp, garde les clients WhatsApp et les autres canaux", async () => {
    db.tables.conversations = {
      data: [
        { id: "c1", channel: "whatsapp", contact_id: "k1", external_thread_id: "conv-client-1", last_message_at: "2026-09-21T10:00:00Z" },
        { id: "c2", channel: "whatsapp", contact_id: "k2", external_thread_id: "grp-1", last_message_at: "2026-09-21T10:05:00Z" },
        { id: "c3", channel: "telegram", contact_id: "k3", external_thread_id: "grp-1", last_message_at: "2026-09-21T10:06:00Z" },
      ],
      error: null,
    };

    const preview = await previewBroadcastAudience("org-1", { channels: ["whatsapp", "telegram"], recentDays: 30 });

    expect(preview.total).toBe(2);
    expect(preview.byChannel).toEqual({ whatsapp: 1, telegram: 1 });
  });

  it("à l'envoi (destinataires figés à la création) : le fil de groupe est IGNORÉ, le client reçoit le message", async () => {
    const now = new Date("2026-09-21T12:00:00Z");
    db.tables.contact_broadcasts = { data: [{ id: "b1", organization_id: "org-1", content: "Soldes -20 %", name: "Soldes", status: "processing" }], error: null };
    db.tables.contact_broadcast_recipients = (filters: Record<string, unknown>) =>
      filters.status === "pending"
        ? {
            data: [
              { id: "r1", contact_id: "k2", conversation_id: "c2", channel: "whatsapp", conversations: { external_thread_id: "grp-1", provider_account_id: "acc-1" }, contacts: { phone_e164: null, broadcast_opt_out: false } },
              { id: "r2", contact_id: "k1", conversation_id: "c1", channel: "whatsapp", conversations: { external_thread_id: "conv-client-1", provider_account_id: "acc-1" }, contacts: { phone_e164: "+237611111111", broadcast_opt_out: false } },
            ],
            error: null,
          }
        : { data: [{ status: "skipped" }, { status: "sent" }], error: null };
    db.tables.messages = { data: { created_at: "2026-09-21T11:00:00Z" }, error: null };

    await processDueContactBroadcasts(now);

    expect(db.sendMessage).toHaveBeenCalledTimes(1);
    expect(db.sendMessage).toHaveBeenCalledWith("org-1", expect.objectContaining({ to: "+237611111111", channel: "whatsapp", externalThreadId: "conv-client-1" }));
    const recipientUpdates = db.ops.filter((op) => op.table === "contact_broadcast_recipients" && op.op === "update").map((op) => op.payload as { status: string; error_message: string | null });
    expect(recipientUpdates[0]).toMatchObject({ status: "skipped" });
    expect(recipientUpdates[0]?.error_message).toMatch(/groupe WhatsApp/);
    expect(recipientUpdates[1]).toMatchObject({ status: "sent" });
  });
});
