import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./marketing-service", () => ({ pauseScheduledPostsForProduct: vi.fn(async () => {}) }));
vi.mock("./notification-service", () => ({ notifyOrgAdmins: vi.fn(async () => {}) }));

const tableResults = new Map<string, { data: unknown; error: unknown }>();
const insertCalls: { table: string; rows: unknown }[] = [];
const updateCalls: { table: string; patch: unknown }[] = [];
const deleteCalls: { table: string }[] = [];

// Lot 1 — mock pour `decrementStock`/`restockProduct`, qui passent
// désormais par `supabase.rpc("adjust_product_stock", ...)` (voir
// 0038_atomic_order_stock_transaction.sql) plutôt que par un
// read-then-write en mémoire applicative. Cohabite avec le mock `.from()`
// de Lot 2 ci-dessous — un seul client Supabase mocké pour tout le
// fichier, `rpc` et `from` sont deux méthodes distinctes du même objet.
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
const rpcCalls: { fn: string; args: unknown }[] = [];

function makeBuilder(table: string) {
  const resultFor = () => tableResults.get(table) ?? { data: null, error: null };
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    insert: vi.fn((rows: unknown) => {
      insertCalls.push({ table, rows });
      return builder;
    }),
    update: vi.fn((patch: unknown) => {
      updateCalls.push({ table, patch });
      return builder;
    }),
    delete: vi.fn(() => {
      deleteCalls.push({ table });
      return builder;
    }),
    maybeSingle: vi.fn(async () => resultFor()),
    single: vi.fn(async () => resultFor()),
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

import {
  formatProductDiscoveryMessage,
  createProduct,
  updateProduct,
  appendProductImage,
  removeProductImage,
  moveProductImage,
  setPrimaryProductImage,
  decrementStock,
  restockProduct,
} from "./catalog-service";
import type { CatalogProductSummary } from "./catalog-service";
import { pauseScheduledPostsForProduct } from "./marketing-service";
import { notifyOrgAdmins } from "./notification-service";

const mockPauseScheduledPostsForProduct = vi.mocked(pauseScheduledPostsForProduct);
const mockNotifyOrgAdmins = vi.mocked(notifyOrgAdmins);

beforeEach(() => {
  vi.clearAllMocks();
  tableResults.clear();
  insertCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  rpcCalls.length = 0;
  rpcResult = { data: null, error: null };
});

const PRODUCTS: CatalogProductSummary[] = [
  {
    id: "p1",
    name: "Sneakers Air Max",
    slug: "sneakers-air-max",
    unitPrice: 35000,
    description: "Confortables et légères",
    categoryName: "Chaussures",
  },
  {
    id: "p2",
    name: "T-shirt Premium",
    slug: "t-shirt-premium",
    unitPrice: 12000,
    description: null,
    categoryName: null,
  },
];

describe("formatProductDiscoveryMessage", () => {
  it("liste chaque produit avec nom, prix, catégorie, description, lien (section 15)", () => {
    const message = formatProductDiscoveryMessage(PRODUCTS, "https://monsalon.sme-os.app", "https://monsalon.sme-os.app/produits");

    expect(message).toContain("Sneakers Air Max");
    expect(message).toMatch(/35.000\sFCFA/);
    expect(message).toContain("Chaussures");
    expect(message).toContain("Confortables et légères");
    expect(message).toContain("https://monsalon.sme-os.app/produits/sneakers-air-max");
    expect(message).toContain("T-shirt Premium");
    expect(message).toMatch(/12.000\sFCFA/);
    expect(message).toContain("Voir tous les produits");
  });

  it("ne plante pas et propose une alternative si le catalogue est vide (jamais inventer de produit)", () => {
    const message = formatProductDiscoveryMessage([], "https://x.sme-os.app", "https://x.sme-os.app/produits");
    expect(message).not.toContain("undefined");
    expect(message.length).toBeGreaterThan(0);
  });
});

describe("createProduct — compareAtPrice (prix barré / promotion)", () => {
  it("garde compareAtPrice quand il est strictement supérieur au prix courant", async () => {
    tableResults.set("products", { data: { id: "prod-1" }, error: null });

    await createProduct({ organizationId: "org-1", name: "Sac", unitPrice: 10000, compareAtPrice: 15000 });

    const insert = insertCalls.find((c) => c.table === "products");
    expect((insert!.rows as { compare_at_price: number | null }).compare_at_price).toBe(15000);
  });

  it("ignore silencieusement un compareAtPrice inférieur ou égal au prix courant (jamais une promo à l'envers)", async () => {
    tableResults.set("products", { data: { id: "prod-1" }, error: null });

    await createProduct({ organizationId: "org-1", name: "Sac", unitPrice: 10000, compareAtPrice: 8000 });

    const insert = insertCalls.find((c) => c.table === "products");
    expect((insert!.rows as { compare_at_price: number | null }).compare_at_price).toBeNull();
  });
});

describe("updateProduct — compareAtPrice", () => {
  it("un compareAtPrice omis (undefined) ne touche pas la colonne", async () => {
    tableResults.set("products", { data: { id: "prod-1" }, error: null });
    await updateProduct("prod-1", "org-1", { name: "Sac", unitPrice: 10000 });

    const update = updateCalls.find((c) => c.table === "products");
    expect(update!.patch).not.toHaveProperty("compare_at_price");
  });

  it("null explicite retire la promotion", async () => {
    tableResults.set("products", { data: { id: "prod-1" }, error: null });
    await updateProduct("prod-1", "org-1", { name: "Sac", unitPrice: 10000, compareAtPrice: null });

    const update = updateCalls.find((c) => c.table === "products");
    expect((update!.patch as { compare_at_price: number | null }).compare_at_price).toBeNull();
  });

  it("rejette un compareAtPrice invalide (<= prix courant) même en édition", async () => {
    tableResults.set("products", { data: { id: "prod-1" }, error: null });
    await updateProduct("prod-1", "org-1", { name: "Sac", unitPrice: 10000, compareAtPrice: 10000 });

    const update = updateCalls.find((c) => c.table === "products");
    expect((update!.patch as { compare_at_price: number | null }).compare_at_price).toBeNull();
  });
});

describe("galerie multi-photos (Lot 2, master prompt §15)", () => {
  it("appendProductImage place la nouvelle photo à la position suivante (jamais en position 0, jamais n'écrase la principale)", async () => {
    tableResults.set("product_images", {
      data: [
        { id: "img-1", url: "https://x/1.jpg", position: 0 },
        { id: "img-2", url: "https://x/2.jpg", position: 1 },
      ],
      error: null,
    });

    await appendProductImage("org-1", "prod-1", "https://x/3.jpg");

    const insert = insertCalls.find((c) => c.table === "product_images");
    expect((insert!.rows as { position: number }).position).toBe(2);
  });

  it("appendProductImage place la première photo en position 0", async () => {
    tableResults.set("product_images", { data: [], error: null });
    await appendProductImage("org-1", "prod-1", "https://x/1.jpg");

    const insert = insertCalls.find((c) => c.table === "product_images");
    expect((insert!.rows as { position: number }).position).toBe(0);
  });

  it("removeProductImage lève NotFoundError si la photo n'appartient pas au produit/org", async () => {
    tableResults.set("product_images", { data: null, error: null });
    await expect(removeProductImage("org-1", "prod-1", "img-x")).rejects.toThrow(/introuvable/i);
  });

  it("moveProductImage échange les positions de deux photos adjacentes", async () => {
    tableResults.set("product_images", {
      data: [
        { id: "img-1", url: "https://x/1.jpg", position: 0 },
        { id: "img-2", url: "https://x/2.jpg", position: 1 },
      ],
      error: null,
    });

    await moveProductImage("org-1", "prod-1", "img-2", "up");

    const updates = updateCalls.filter((c) => c.table === "product_images");
    expect(updates).toHaveLength(2);
    expect(updates).toEqual(
      expect.arrayContaining([{ table: "product_images", patch: { position: 0 } }, { table: "product_images", patch: { position: 1 } }]),
    );
  });

  it("moveProductImage ne fait rien (no-op) si la photo est déjà à l'extrémité", async () => {
    tableResults.set("product_images", {
      data: [
        { id: "img-1", url: "https://x/1.jpg", position: 0 },
        { id: "img-2", url: "https://x/2.jpg", position: 1 },
      ],
      error: null,
    });

    await moveProductImage("org-1", "prod-1", "img-1", "up");

    expect(updateCalls.filter((c) => c.table === "product_images")).toHaveLength(0);
  });

  it("setPrimaryProductImage échange avec l'actuelle principale plutôt que de supprimer/recréer", async () => {
    tableResults.set("product_images", {
      data: [
        { id: "img-1", url: "https://x/1.jpg", position: 0 },
        { id: "img-2", url: "https://x/2.jpg", position: 1 },
      ],
      error: null,
    });

    await setPrimaryProductImage("org-1", "prod-1", "img-2");

    expect(deleteCalls.filter((c) => c.table === "product_images")).toHaveLength(0);
    const updates = updateCalls.filter((c) => c.table === "product_images");
    expect(updates).toEqual(
      expect.arrayContaining([{ table: "product_images", patch: { position: 0 } }, { table: "product_images", patch: { position: 1 } }]),
    );
  });

  it("setPrimaryProductImage ne fait rien si la photo est déjà la principale", async () => {
    tableResults.set("product_images", { data: [{ id: "img-1", url: "https://x/1.jpg", position: 0 }], error: null });
    await setPrimaryProductImage("org-1", "prod-1", "img-1");
    expect(updateCalls.filter((c) => c.table === "product_images")).toHaveLength(0);
  });
});

describe("decrementStock — Lot 1 (primitif atomique partagé, section 10/19)", () => {
  it("appelle adjust_product_stock avec un delta négatif", async () => {
    rpcResult = {
      data: [{ new_stock: 3, new_status: "active", previous_status: "active", product_name: "Sac" }],
      error: null,
    };

    await decrementStock("org-1", "prod-1", 2, "Vente — commande order-1", "user-1");

    expect(rpcCalls).toEqual([
      { fn: "adjust_product_stock", args: { p_product_id: "prod-1", p_organization_id: "org-1", p_delta: -2 } },
    ]);
    expect(insertCalls).toContainEqual({
      table: "inventory_movements",
      rows: {
        organization_id: "org-1",
        product_id: "prod-1",
        movement_type: "out",
        quantity: 2,
        reason: "Vente — commande order-1",
        created_by: "user-1",
      },
    });
  });

  it("notifie et met en pause les publications UNIQUEMENT quand le statut bascule vers out_of_stock", async () => {
    rpcResult = {
      data: [{ new_stock: 0, new_status: "out_of_stock", previous_status: "active", product_name: "Sac à main" }],
      error: null,
    };

    await decrementStock("org-1", "prod-1", 1, "Vente");

    expect(mockPauseScheduledPostsForProduct).toHaveBeenCalledWith("org-1", "prod-1");
    expect(mockNotifyOrgAdmins).toHaveBeenCalledTimes(1);
    expect(mockNotifyOrgAdmins.mock.calls[0]![0]).toMatchObject({ organizationId: "org-1", relatedEntityId: "prod-1" });
  });

  it("ne notifie PAS si le produit était déjà out_of_stock (pas de nouvelle transition)", async () => {
    rpcResult = {
      data: [{ new_stock: 0, new_status: "out_of_stock", previous_status: "out_of_stock", product_name: "Sac" }],
      error: null,
    };

    await decrementStock("org-1", "prod-1", 1, "Vente");

    expect(mockPauseScheduledPostsForProduct).not.toHaveBeenCalled();
    expect(mockNotifyOrgAdmins).not.toHaveBeenCalled();
  });

  it("lève une erreur explicite si le produit est introuvable (P0002)", async () => {
    rpcResult = { data: null, error: { code: "P0002", message: "no rows" } };
    await expect(decrementStock("org-1", "prod-x", 1, "Vente")).rejects.toThrow(/introuvable/i);
  });
});

describe("restockProduct — Lot 1 (primitif atomique partagé, section 10)", () => {
  it("appelle adjust_product_stock avec un delta positif, sans notification", async () => {
    rpcResult = {
      data: [{ new_stock: 5, new_status: "active", previous_status: "out_of_stock", product_name: "Sac" }],
      error: null,
    };

    await restockProduct("org-1", "prod-1", 5, "user-1");

    expect(rpcCalls).toEqual([
      { fn: "adjust_product_stock", args: { p_product_id: "prod-1", p_organization_id: "org-1", p_delta: 5 } },
    ]);
    expect(insertCalls).toContainEqual({
      table: "inventory_movements",
      rows: {
        organization_id: "org-1",
        product_id: "prod-1",
        movement_type: "in",
        quantity: 5,
        reason: "Réapprovisionnement",
        created_by: "user-1",
      },
    });
    expect(mockNotifyOrgAdmins).not.toHaveBeenCalled();
  });
});
