import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./notification-service", () => ({ notifyOrgAdmins: vi.fn(async () => {}) }));
vi.mock("./analytics-service", () => ({ trackEvent: vi.fn(async () => {}) }));

const tableResults = new Map<string, { data: unknown; error: unknown; count?: number }>();
const insertCalls: { table: string; rows: unknown }[] = [];
const updateCalls: { table: string; patch: unknown }[] = [];
const rangeCalls: { from: number; to: number }[] = [];
const eqCalls: { table: string; args: unknown[] }[] = [];

function makeBuilder(table: string) {
  const resultFor = () => tableResults.get(table) ?? { data: null, error: null };
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn((...args: unknown[]) => {
      eqCalls.push({ table, args });
      return builder;
    }),
    order: vi.fn(() => builder),
    range: vi.fn((from: number, to: number) => {
      rangeCalls.push({ from, to });
      return builder;
    }),
    insert: vi.fn((rows: unknown) => {
      insertCalls.push({ table, rows });
      return builder;
    }),
    update: vi.fn((patch: unknown) => {
      updateCalls.push({ table, patch });
      return builder;
    }),
    maybeSingle: vi.fn(async () => resultFor()),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(resultFor()).then(resolve, reject),
  };
  return builder;
}

const mockFrom = vi.fn((table: string) => makeBuilder(table));

vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import { listLeadsForOrg, updateLeadStatus } from "./lead-service";

beforeEach(() => {
  vi.clearAllMocks();
  tableResults.clear();
  insertCalls.length = 0;
  updateCalls.length = 0;
  rangeCalls.length = 0;
  eqCalls.length = 0;
});

describe("listLeadsForOrg", () => {
  it("calcule .range() depuis page/pageSize (même convention que products/page.tsx)", async () => {
    tableResults.set("leads", { data: [], error: null, count: 0 });
    await listLeadsForOrg("org-1", { page: 3, pageSize: 20 });
    expect(rangeCalls).toEqual([{ from: 40, to: 59 }]);
  });

  it("applique le filtre de statut uniquement quand fourni", async () => {
    tableResults.set("leads", { data: [], error: null, count: 0 });
    await listLeadsForOrg("org-1", { status: "qualified", page: 1, pageSize: 50 });
    const statusFilter = eqCalls.find((c) => c.table === "leads" && c.args[0] === "status");
    expect(statusFilter).toBeDefined();
    expect(statusFilter!.args[1]).toBe("qualified");
  });

  it("mappe le contact imbriqué et le total", async () => {
    tableResults.set("leads", {
      data: [
        {
          id: "lead-1",
          status: "lead",
          source: "whatsapp",
          intent: null,
          score: 7,
          score_reason: "actif",
          last_contact_at: null,
          next_follow_up_at: null,
          created_at: "2026-08-01T00:00:00Z",
          contacts: { full_name: "Awa", phone_e164: "+237600000000" },
        },
      ],
      error: null,
      count: 1,
    });

    const result = await listLeadsForOrg("org-1", { page: 1, pageSize: 50 });

    expect(result.totalCount).toBe(1);
    expect(result.leads[0]).toMatchObject({ id: "lead-1", contactName: "Awa", contactPhone: "+237600000000" });
  });
});

describe("updateLeadStatus", () => {
  it("refuse un statut inconnu", async () => {
    await expect(updateLeadStatus("org-1", "lead-1", "interested" as never)).rejects.toThrow(/inconnu/);
  });

  it("ne réécrit rien si le statut est déjà celui demandé (idempotent)", async () => {
    tableResults.set("leads", { data: { id: "lead-1", status: "qualified" }, error: null });
    await updateLeadStatus("org-1", "lead-1", "qualified");
    expect(updateCalls.find((c) => c.table === "leads")).toBeUndefined();
    expect(insertCalls.find((c) => c.table === "lead_events")).toBeUndefined();
  });

  it("met à jour le statut et journalise un lead_event lors d'un vrai changement", async () => {
    tableResults.set("leads", { data: { id: "lead-1", status: "lead" }, error: null });
    await updateLeadStatus("org-1", "lead-1", "customer", "user-1");

    const update = updateCalls.find((c) => c.table === "leads");
    expect(update).toBeDefined();
    expect(update!.patch).toEqual({ status: "customer" });

    const event = insertCalls.find((c) => c.table === "lead_events");
    expect(event).toBeDefined();
    expect((event!.rows as { event_type: string }).event_type).toBe("STATUS_CHANGED");
  });

  it("lève NotFoundError si le prospect n'existe pas pour cette org", async () => {
    tableResults.set("leads", { data: null, error: null });
    await expect(updateLeadStatus("org-1", "lead-x", "lost")).rejects.toThrow(/introuvable/i);
  });
});
