import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CatalogProductSummary } from "./catalog-service";

vi.mock("./entitlements-service", () => ({
  canUseFeature: vi.fn(),
}));

vi.mock("@/infrastructure/providers/registry", () => ({
  getMessagingProvider: vi.fn(),
}));

vi.mock("./notification-service", () => ({
  notifyOrgAdmins: vi.fn(async () => {}),
}));

/**
 * Mock générique du query builder Supabase : chaque méthode de chaînage
 * renvoie le builder lui-même (comme le vrai client), et le builder est
 * "thenable" pour les chaînes qui s'arrêtent avant `.single()`/
 * `.maybeSingle()` — exactement le comportement du vrai PostgrestFilterBuilder.
 * Nécessaire ici (contrairement à platform-admin-service.test.ts, qui
 * mocke UNE seule forme de chaîne fixe) car whatsapp-group-service.ts
 * enchaîne plusieurs formes différentes selon la table appelée.
 */
const tableResults = new Map<string, { data: unknown; error: unknown }>();
const insertCalls: { table: string; rows: unknown }[] = [];

function makeBuilder(table: string) {
  const resultFor = () => tableResults.get(table) ?? { data: null, error: null };
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    insert: vi.fn((rows: unknown) => {
      insertCalls.push({ table, rows });
      return builder;
    }),
    update: vi.fn(() => builder),
    upsert: vi.fn((rows: unknown) => {
      insertCalls.push({ table, rows });
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

vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import { createBroadcast, connectGroups, formatGroupBroadcastMessage } from "./whatsapp-group-service";
import { canUseFeature } from "./entitlements-service";

const mockCanUseFeature = vi.mocked(canUseFeature);

function futureIso(hoursFromNow = 2): string {
  return new Date(Date.now() + hoursFromNow * 3600_000).toISOString();
}

beforeEach(() => {
  vi.clearAllMocks();
  tableResults.clear();
  insertCalls.length = 0;
});

describe("formatGroupBroadcastMessage", () => {
  const PRODUCTS: CatalogProductSummary[] = [
    {
      id: "p1",
      name: "Sac en cuir",
      slug: "sac-en-cuir",
      unitPrice: 25000,
      description: "Fait main",
      categoryName: "Maroquinerie",
    },
  ];

  it("liste chaque produit avec nom, prix, description, lien — jamais 'undefined'", () => {
    const message = formatGroupBroadcastMessage(PRODUCTS);

    expect(message).toContain("Sac en cuir");
    // fr-FR utilise une espace fine insécable (U+202F) comme séparateur —
    // on matche sur les chiffres et "FCFA" plutôt que l'espace exact.
    expect(message).toMatch(/25.000\sFCFA/);
    expect(message).toContain("Fait main");
    expect(message).toContain("/produits/sac-en-cuir");
    expect(message).not.toContain("undefined");
  });

  it("retourne une chaîne vide pour un catalogue vide (jamais un message vide envoyé aux groupes)", () => {
    expect(formatGroupBroadcastMessage([])).toBe("");
  });
});

describe("createBroadcast — validations avant tout accès DB", () => {
  it("refuse sans produit sélectionné", async () => {
    await expect(createBroadcast("org-1", [], ["g1"], futureIso(), "user-1")).rejects.toThrow(/produit/i);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("refuse sans groupe sélectionné", async () => {
    await expect(createBroadcast("org-1", ["p1"], [], futureIso(), "user-1")).rejects.toThrow(/groupe/i);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("refuse une date de programmation dans le passé", async () => {
    const pastIso = new Date(Date.now() - 3600_000).toISOString();
    await expect(createBroadcast("org-1", ["p1"], ["g1"], pastIso, "user-1")).rejects.toThrow(/futur/i);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("refuse une date invalide", async () => {
    await expect(createBroadcast("org-1", ["p1"], ["g1"], "pas-une-date", "user-1")).rejects.toThrow(/date/i);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("createBroadcast — intégrité IDOR (groupes/produits doivent appartenir à l'org)", () => {
  it("refuse si un groupe ciblé est introuvable ou déconnecté, sans rien écrire", async () => {
    // Seul g1 revient comme connecté pour cette org — g2 est absent (autre
    // org, id invalide, ou déconnecté).
    tableResults.set("whatsapp_groups", { data: [{ id: "g1", status: "connected" }], error: null });

    await expect(createBroadcast("org-1", ["p1"], ["g1", "g2"], futureIso(), "user-1")).rejects.toThrow(
      /introuvables ou déconnectés/i,
    );

    expect(insertCalls.find((c) => c.table === "group_broadcasts")).toBeUndefined();
  });

  it("refuse si un produit ciblé n'appartient pas à l'organisation", async () => {
    tableResults.set("whatsapp_groups", { data: [{ id: "g1", status: "connected" }], error: null });
    tableResults.set("products", { data: [], error: null }); // aucun produit trouvé pour cette org

    await expect(createBroadcast("org-1", ["p1"], ["g1"], futureIso(), "user-1")).rejects.toThrow(/produits sélectionnés sont introuvables/i);

    expect(insertCalls.find((c) => c.table === "group_broadcasts")).toBeUndefined();
  });
});

describe("createBroadcast — critère d'acceptation central : une ligne PAR GROUPE, jamais par (produit x groupe)", () => {
  it("10 produits x 4 groupes créent 4 group_broadcast_targets, pas 40", async () => {
    tableResults.set("whatsapp_groups", {
      data: [
        { id: "g1", status: "connected" },
        { id: "g2", status: "connected" },
        { id: "g3", status: "connected" },
        { id: "g4", status: "connected" },
      ],
      error: null,
    });
    tableResults.set("products", {
      data: Array.from({ length: 10 }, (_, i) => ({
        id: `p${i}`,
        name: `Produit ${i}`,
        slug: `produit-${i}`,
        unit_price: 1000,
        description: null,
        categories: null,
      })),
      error: null,
    });
    tableResults.set("group_broadcasts", { data: { id: "broadcast-1" }, error: null });

    const productIds = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const groupIds = ["g1", "g2", "g3", "g4"];

    const result = await createBroadcast("org-1", productIds, groupIds, futureIso(), "user-1");

    expect(result).toEqual({ broadcastId: "broadcast-1", targetCount: 4, productCount: 10 });

    const targetsInsert = insertCalls.find((c) => c.table === "group_broadcast_targets");
    expect(targetsInsert).toBeDefined();
    expect((targetsInsert!.rows as unknown[]).length).toBe(4);

    const productsInsert = insertCalls.find((c) => c.table === "group_broadcast_products");
    expect((productsInsert!.rows as unknown[]).length).toBe(10);
  });

  it("déduplique les groupes/produits envoyés en double avant de créer les lignes", async () => {
    tableResults.set("whatsapp_groups", { data: [{ id: "g1", status: "connected" }], error: null });
    tableResults.set("products", {
      data: [{ id: "p1", name: "Produit", slug: "produit", unit_price: 1000, description: null, categories: null }],
      error: null,
    });
    tableResults.set("group_broadcasts", { data: { id: "broadcast-1" }, error: null });

    const result = await createBroadcast("org-1", ["p1", "p1"], ["g1", "g1"], futureIso(), "user-1");

    expect(result.targetCount).toBe(1);
    expect(result.productCount).toBe(1);
  });
});

describe("connectGroups — enforcement Lot B (entitlements)", () => {
  it("refuse la connexion AVANT toute écriture si le quota whatsapp_groups est dépassé", async () => {
    tableResults.set("whatsapp_groups", { data: [], error: null }); // aucun groupe existant pour cette org
    mockCanUseFeature.mockResolvedValue({ allowed: false, limit: 3, used: 3, remaining: 0 });

    await expect(
      connectGroups("org-1", [{ externalId: "ext-4", name: "Groupe 4" }], "user-1"),
    ).rejects.toThrow(/limite/i);

    expect(mockCanUseFeature).toHaveBeenCalledWith("org-1", "whatsapp_groups", 1);
    expect(insertCalls.find((c) => c.table === "whatsapp_groups")).toBeUndefined();
  });

  it("ne compte pas contre le quota un groupe déjà connecté (no-op idempotent)", async () => {
    tableResults.set("whatsapp_groups", {
      data: [{ external_id: "ext-1", status: "connected" }],
      error: null,
    });

    const result = await connectGroups("org-1", [{ externalId: "ext-1", name: "Groupe 1" }], "user-1");

    expect(result.skipped).toEqual([{ externalId: "ext-1", reason: "Déjà connecté" }]);
    expect(result.connected).toEqual([]);
    expect(mockCanUseFeature).not.toHaveBeenCalled();
  });

  it("vérifie le quota sur le lot ENTIER en un seul appel atomique (jamais N vérifications séquentielles)", async () => {
    tableResults.set("whatsapp_groups", { data: [], error: null });
    mockCanUseFeature.mockResolvedValue({ allowed: true, limit: 10, used: 0, remaining: 10 });
    tableResults.set("whatsapp_groups", { data: [], error: null });

    await connectGroups(
      "org-1",
      [
        { externalId: "ext-1", name: "Groupe 1" },
        { externalId: "ext-2", name: "Groupe 2" },
      ],
      "user-1",
    );

    expect(mockCanUseFeature).toHaveBeenCalledTimes(1);
    expect(mockCanUseFeature).toHaveBeenCalledWith("org-1", "whatsapp_groups", 2);
  });
});
