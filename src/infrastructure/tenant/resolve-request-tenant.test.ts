import { describe, it, expect, vi, beforeEach } from "vitest";

// Même pattern table-based builder que marketing-service.test.ts /
// whatsapp-group-service.test.ts — évite de mocker Supabase en entier.
const tableResults = new Map<string, { data: unknown; error: unknown }>();

function makeBuilder() {
  let currentTable = "";
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => tableResults.get(currentTable) ?? { data: null, error: null }),
  };
  return { builder, setTable: (t: string) => { currentTable = t; } };
}

const { builder, setTable } = makeBuilder();
const mockFrom = vi.fn((table: string) => {
  setTable(table);
  return builder;
});
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import { getTenantPublicOrigin } from "./resolve-request-tenant";

beforeEach(() => {
  tableResults.clear();
});

describe("getTenantPublicOrigin — corrigé 19/09/2026 (un lien produit pointait vers le domaine générique de la plateforme au lieu de celui du tenant)", () => {
  it("préfère le domaine custom vérifié quand il existe", async () => {
    tableResults.set("tenant_domains", { data: { domain: "habynex.com" }, error: null });
    tableResults.set("organizations", { data: { slug: "habynex" }, error: null });

    expect(await getTenantPublicOrigin("org-1")).toBe("https://habynex.com");
  });

  it("retombe sur le sous-domaine plateforme ({slug}.NEXT_PUBLIC_ROOT_DOMAIN) si aucun domaine custom vérifié", async () => {
    tableResults.set("tenant_domains", { data: null, error: null });
    tableResults.set("organizations", { data: { slug: "habynex" }, error: null });

    expect(await getTenantPublicOrigin("org-1")).toBe("https://habynex.localhost:3000");
  });

  it("ne lève jamais : organisation introuvable -> repli sur NEXT_PUBLIC_APP_URL plutôt que de faire échouer tout un envoi", async () => {
    tableResults.set("tenant_domains", { data: null, error: null });
    tableResults.set("organizations", { data: null, error: null });

    await expect(getTenantPublicOrigin("org-inconnu")).resolves.toBe("http://localhost:3000");
  });
});
