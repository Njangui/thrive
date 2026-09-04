import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./marketing-service", () => ({ pauseScheduledPostsForProduct: vi.fn(async () => {}) }));
vi.mock("./notification-service", () => ({ notifyOrgAdmins: vi.fn(async () => {}) }));
vi.mock("./analytics-service", () => ({ trackEvent: vi.fn(async () => {}) }));

const tableResults = new Map<string, { data: unknown; error: unknown; count?: number }>();
const rangeCalls: { from: number; to: number }[] = [];
const eqCalls: { table: string; args: unknown[] }[] = [];
// Lot 1 — `markOrderCompleted` passe maintenant par `supabase.rpc(...)`
// (voir 0038_atomic_order_stock_transaction.sql) plutôt que par une suite
// d'appels `.from()` : le résultat du RPC est configurable par test via
// `rpcResult`, et chaque appel est journalisé dans `rpcCalls` pour
// vérifier les paramètres envoyés.
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
const rpcCalls: { fn: string; args: unknown }[] = [];

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
    maybeSingle: vi.fn(async () => resultFor()),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(resultFor()).then(resolve, reject),
  };
  return builder;
}

const mockFrom = vi.fn((table: string) => makeBuilder(table));
const mockRpc = vi.fn(async (fn: string, args: unknown) => {
  rpcCalls.push({ fn, args });
  return rpcResult;
});

vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

import { listOrdersForOrg, getOrderDetail, markOrderCompleted } from "./order-service";
import { pauseScheduledPostsForProduct } from "./marketing-service";
import { notifyOrgAdmins } from "./notification-service";

const mockPauseScheduledPostsForProduct = vi.mocked(pauseScheduledPostsForProduct);
const mockNotifyOrgAdmins = vi.mocked(notifyOrgAdmins);

beforeEach(() => {
  vi.clearAllMocks();
  tableResults.clear();
  rangeCalls.length = 0;
  eqCalls.length = 0;
  rpcCalls.length = 0;
  rpcResult = { data: null, error: null };
});

describe("listOrdersForOrg", () => {
  it("calcule .range() depuis page/pageSize", async () => {
    tableResults.set("orders", { data: [], error: null, count: 0 });
    await listOrdersForOrg("org-1", { page: 2, pageSize: 50 });
    expect(rangeCalls).toEqual([{ from: 50, to: 99 }]);
  });

  it("applique le filtre de statut uniquement quand fourni", async () => {
    tableResults.set("orders", { data: [], error: null, count: 0 });
    await listOrdersForOrg("org-1", { status: "completed", page: 1, pageSize: 50 });
    const statusFilter = eqCalls.find((c) => c.table === "orders" && c.args[0] === "status");
    expect(statusFilter).toBeDefined();
  });

  it("mappe le contact imbriqué et convertit total_amount en nombre", async () => {
    tableResults.set("orders", {
      data: [
        {
          id: "order-1",
          status: "pending",
          total_amount: "15000",
          currency: "XAF",
          created_at: "2026-08-01T00:00:00Z",
          contacts: { full_name: "Awa", phone_e164: "+237600000000" },
        },
      ],
      error: null,
      count: 1,
    });

    const result = await listOrdersForOrg("org-1", { page: 1, pageSize: 50 });
    expect(result.orders[0]).toMatchObject({ id: "order-1", totalAmount: 15000, contactName: "Awa" });
  });
});

describe("getOrderDetail", () => {
  it("lève NotFoundError si la commande n'existe pas pour cette org", async () => {
    tableResults.set("orders", { data: null, error: null });
    await expect(getOrderDetail("org-1", "order-x")).rejects.toThrow(/introuvable/i);
  });

  it("assemble la commande et ses articles", async () => {
    tableResults.set("orders", {
      data: {
        id: "order-1",
        status: "confirmed",
        total_amount: "5000",
        currency: "XAF",
        notes: null,
        created_at: "2026-08-01T00:00:00Z",
        contacts: { full_name: "Awa", phone_e164: "+237600000000" },
      },
      error: null,
    });
    tableResults.set("order_items", {
      data: [{ id: "item-1", label: "Sac", unit_price: "2500", quantity: 2 }],
      error: null,
    });

    const detail = await getOrderDetail("org-1", "order-1");
    expect(detail.totalAmount).toBe(5000);
    expect(detail.items).toEqual([{ id: "item-1", label: "Sac", unitPrice: 2500, quantity: 2 }]);
  });
});

describe("markOrderCompleted — Lot 1 (transaction atomique, section 19/71)", () => {
  it("appelle complete_order_transaction avec les bons paramètres", async () => {
    rpcResult = {
      data: [
        {
          already_completed: false,
          result_order_id: "order-1",
          total_amount: 5000,
          currency: "XAF",
          newly_out_of_stock_product_ids: [],
        },
      ],
      error: null,
    };

    await markOrderCompleted("org-1", "order-1", "user-1");

    expect(rpcCalls).toEqual([
      {
        fn: "complete_order_transaction",
        args: { p_order_id: "order-1", p_organization_id: "org-1", p_actor_user_id: "user-1" },
      },
    ]);
  });

  it("idempotent : already_completed=true ne déclenche ni notification ni pause de publication", async () => {
    rpcResult = {
      data: [
        {
          already_completed: true,
          result_order_id: "order-1",
          total_amount: 5000,
          currency: "XAF",
          newly_out_of_stock_product_ids: null,
        },
      ],
      error: null,
    };

    await markOrderCompleted("org-1", "order-1");

    expect(mockNotifyOrgAdmins).not.toHaveBeenCalled();
    expect(mockPauseScheduledPostsForProduct).not.toHaveBeenCalled();
  });

  it("met en pause les publications et notifie les admins pour chaque produit passé en rupture", async () => {
    rpcResult = {
      data: [
        {
          already_completed: false,
          result_order_id: "order-1",
          total_amount: 5000,
          currency: "XAF",
          newly_out_of_stock_product_ids: ["prod-1", "prod-2"],
        },
      ],
      error: null,
    };
    tableResults.set("products", { data: { name: "Sac à main" }, error: null });

    await markOrderCompleted("org-1", "order-1");

    expect(mockPauseScheduledPostsForProduct).toHaveBeenCalledTimes(2);
    expect(mockPauseScheduledPostsForProduct).toHaveBeenCalledWith("org-1", "prod-1");
    expect(mockPauseScheduledPostsForProduct).toHaveBeenCalledWith("org-1", "prod-2");
    expect(mockNotifyOrgAdmins).toHaveBeenCalledTimes(2);
  });

  it("lève une erreur explicite si la commande est introuvable (P0002)", async () => {
    rpcResult = { data: null, error: { code: "P0002", message: "no rows" } };

    await expect(markOrderCompleted("org-1", "order-x")).rejects.toThrow(/introuvable/i);
  });

  it("lève une erreur pour toute autre erreur RPC (jamais avalée silencieusement)", async () => {
    rpcResult = { data: null, error: { code: "XX000", message: "boom" } };

    await expect(markOrderCompleted("org-1", "order-1")).rejects.toThrow(/boom/);
  });
});
