import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./plans-repository", () => ({
  countOrganizationRows: vi.fn(),
}));

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import {
  getRecentAuditLogs,
  listAuditLogFilterOptions,
  formatAuditLogsAsCsv,
  getPlatformUsageByOrganization,
  type AdminAuditLogEntry,
} from "./admin-observability-service";
import { countOrganizationRows } from "./plans-repository";

const mockCountOrganizationRows = vi.mocked(countOrganizationRows);

interface QueryResult {
  data?: unknown;
  error?: { message: string } | null;
}

/**
 * Fabrique un query builder minimal — même esprit que les autres fichiers
 * de test du projet (ai-credits-service.test.ts, marketing-service.test.ts) :
 * chaque méthode de chaînage retourne le builder lui-même, et `then` résout
 * toujours le même résultat, peu importe la séquence d'appels précédente
 * (select/eq/order/limit — la logique testée est dans le service, pas dans
 * ce mock).
 */
function configureSupabase(byTable: Record<string, QueryResult>) {
  mockFrom.mockImplementation((table: string) => {
    const result: QueryResult = byTable[table] ?? { data: null, error: null };
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (onFulfilled: (v: QueryResult) => unknown) => Promise.resolve(result).then(onFulfilled),
    };
    return builder;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("getRecentAuditLogs", () => {
  it("mappe les lignes audit_logs, y compris le nom d'organisation jointe", async () => {
    configureSupabase({
      audit_logs: {
        data: [
          {
            id: "log-1",
            organization_id: "org-1",
            actor_user_id: "user-1",
            action: "ORGANIZATION_SUSPENDED",
            entity_type: "organization",
            entity_id: "org-1",
            before_state: { status: "active" },
            after_state: { status: "suspended" },
            created_at: "2026-08-01T10:00:00Z",
            organizations: { name: "Salon Élégance" },
          },
        ],
        error: null,
      },
    });

    const logs = await getRecentAuditLogs();

    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual({
      id: "log-1",
      organizationId: "org-1",
      organizationName: "Salon Élégance",
      actorUserId: "user-1",
      action: "ORGANIZATION_SUSPENDED",
      entityType: "organization",
      entityId: "org-1",
      beforeState: { status: "active" },
      afterState: { status: "suspended" },
      createdAt: "2026-08-01T10:00:00Z",
    });
  });

  it("retourne un tableau vide sans planter si audit_logs est vide", async () => {
    configureSupabase({ audit_logs: { data: [], error: null } });
    await expect(getRecentAuditLogs()).resolves.toEqual([]);
  });

  it("lève une erreur explicite si la lecture échoue", async () => {
    configureSupabase({ audit_logs: { data: null, error: { message: "timeout" } } });
    await expect(getRecentAuditLogs()).rejects.toThrow(/timeout/);
  });

  it("gère une organisation absente (organization_id null) sans planter", async () => {
    configureSupabase({
      audit_logs: {
        data: [
          {
            id: "log-2",
            organization_id: null,
            actor_user_id: "user-1",
            action: "SOME_PLATFORM_LEVEL_ACTION",
            entity_type: null,
            entity_id: null,
            before_state: null,
            after_state: null,
            created_at: "2026-08-01T10:00:00Z",
            organizations: null,
          },
        ],
        error: null,
      },
    });

    const logs = await getRecentAuditLogs();
    expect(logs[0]?.organizationName).toBeNull();
  });
});

describe("listAuditLogFilterOptions", () => {
  it("dé-duplique et trie les actions/entity_types déjà vus", async () => {
    configureSupabase({
      audit_logs: {
        data: [
          { action: "ORGANIZATION_PLAN_CHANGED", entity_type: "organization_subscription" },
          { action: "ORGANIZATION_SUSPENDED", entity_type: "organization" },
          { action: "ORGANIZATION_SUSPENDED", entity_type: "organization" },
          { action: "AI_CREDITS_GRANTED", entity_type: null },
        ],
        error: null,
      },
    });

    const options = await listAuditLogFilterOptions();

    expect(options.actions).toEqual(["AI_CREDITS_GRANTED", "ORGANIZATION_PLAN_CHANGED", "ORGANIZATION_SUSPENDED"]);
    expect(options.entityTypes).toEqual(["organization", "organization_subscription"]);
  });

  it("retourne des listes vides (jamais d'exception) si la lecture échoue", async () => {
    configureSupabase({ audit_logs: { data: null, error: { message: "timeout" } } });
    await expect(listAuditLogFilterOptions()).resolves.toEqual({ actions: [], entityTypes: [] });
  });
});

describe("formatAuditLogsAsCsv", () => {
  const SAMPLE_LOG: AdminAuditLogEntry = {
    id: "log-1",
    organizationId: "org-1",
    organizationName: "Salon Élégance",
    actorUserId: "user-1",
    action: "ORGANIZATION_SUSPENDED",
    entityType: "organization",
    entityId: "org-1",
    beforeState: null,
    afterState: null,
    createdAt: "2026-08-01T10:00:00Z",
  };

  it("inclut toujours la ligne d'en-tête, même sans donnée", () => {
    const csv = formatAuditLogsAsCsv([]);
    expect(csv).toBe('"Date","Entreprise","Action","Type d\'entité","Id entité","Acteur"');
  });

  it("produit une ligne par entrée avec les bons champs", () => {
    const csv = formatAuditLogsAsCsv([SAMPLE_LOG]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('"2026-08-01T10:00:00Z","Salon Élégance","ORGANIZATION_SUSPENDED","organization","org-1","user-1"');
  });

  it("échappe correctement les guillemets internes (avant/après state ou noms avec guillemets)", () => {
    const csv = formatAuditLogsAsCsv([{ ...SAMPLE_LOG, organizationName: 'Salon "Le Chic"' }]);
    expect(csv).toContain('"Salon ""Le Chic"""');
  });

  it("remplace les valeurs null par une chaîne vide plutôt que la chaîne 'null'", () => {
    const csv = formatAuditLogsAsCsv([{ ...SAMPLE_LOG, organizationName: null, entityType: null, entityId: null, actorUserId: null }]);
    expect(csv).not.toContain("null");
  });
});

describe("getPlatformUsageByOrganization", () => {
  it("agrège les compteurs par organisation en réutilisant countOrganizationRows", async () => {
    configureSupabase({ organizations: { data: [{ id: "org-1" }, { id: "org-2" }], error: null } });
    mockCountOrganizationRows.mockImplementation(async (table: string, orgId: string) => {
      if (table === "products") return orgId === "org-1" ? 5 : 0;
      if (table === "conversations") return orgId === "org-1" ? 12 : 3;
      if (table === "whatsapp_groups") return 0; // table pas encore fusionnée (Lot F)
      return 0;
    });

    const usage = await getPlatformUsageByOrganization();

    expect(usage).toEqual([
      { organizationId: "org-1", productsCount: 5, conversationsCount: 12, whatsappGroupsCount: 0 },
      { organizationId: "org-2", productsCount: 0, conversationsCount: 3, whatsappGroupsCount: 0 },
    ]);
  });

  it("ne plante jamais si whatsapp_groups n'existe pas encore (Lot F non fusionné) — countOrganizationRows gère déjà l'absence", async () => {
    configureSupabase({ organizations: { data: [{ id: "org-1" }], error: null } });
    mockCountOrganizationRows.mockResolvedValue(0);

    await expect(getPlatformUsageByOrganization()).resolves.toEqual([
      { organizationId: "org-1", productsCount: 0, conversationsCount: 0, whatsappGroupsCount: 0 },
    ]);
  });

  it("retourne un tableau vide si aucune organisation n'existe", async () => {
    configureSupabase({ organizations: { data: [], error: null } });
    await expect(getPlatformUsageByOrganization()).resolves.toEqual([]);
  });

  it("lève une erreur explicite si la lecture des organisations échoue", async () => {
    configureSupabase({ organizations: { data: null, error: { message: "timeout" } } });
    await expect(getPlatformUsageByOrganization()).rejects.toThrow(/timeout/);
  });
});
