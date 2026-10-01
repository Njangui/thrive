import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./admin-organizations-service", () => ({
  writeAdminAuditLog: vi.fn(),
}));

interface QueryResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

const mockFrom = vi.fn();
const upsertCalls: { table: string; payload: unknown; options: unknown }[] = [];
const updateCalls: { table: string; payload: unknown }[] = [];
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import { resolveDomainRequest, setDomainRequestPaymentStatus } from "./admin-domains-service";
import { writeAdminAuditLog } from "./admin-organizations-service";
import { NotFoundError, ValidationError } from "@/lib/errors";

/**
 * Même esprit que admin-numbers-service.test.ts : un résultat statique par
 * table pour la lecture (`maybeSingle`), et les payloads d'`update`/`upsert`
 * interceptés séparément pour vérifier CE QUI est écrit (garde-fou paiement,
 * création de tenant_domains), pas seulement que l'appel a eu lieu.
 */
function configureSupabase(byTable: Record<string, QueryResult>) {
  mockFrom.mockImplementation((table: string) => {
    const result: QueryResult = byTable[table] ?? { data: null, error: null };
    const builder = {
      select: () => builder,
      eq: () => builder,
      update: (payload: unknown) => {
        updateCalls.push({ table, payload });
        return builder;
      },
      upsert: (payload: unknown, options: unknown) => {
        upsertCalls.push({ table, payload, options });
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle: () => Promise.resolve(result),
      then: (onFulfilled: (v: QueryResult) => unknown) => Promise.resolve(result).then(onFulfilled),
    };
    return builder;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  upsertCalls.length = 0;
  updateCalls.length = 0;
});

describe("resolveDomainRequest — garde-fou paiement avant enregistrement", () => {
  const pendingRequest = { id: "req-1", organization_id: "org-1", domain_name: "boutique-fatou.cm", status: "processing", payment_status: "unpaid", resolution_note: null, resolved_at: null };

  it("refuse de marquer « enregistrée » tant que le paiement n'est pas « payé »", async () => {
    configureSupabase({ domain_requests: { data: pendingRequest, error: null } });
    await expect(resolveDomainRequest("req-1", "registered", "admin-1")).rejects.toBeInstanceOf(ValidationError);
    expect(updateCalls.some((c) => c.table === "domain_requests")).toBe(false);
  });

  it("autorise « enregistrée » une fois payé, et crée la ligne tenant_domains (vérifiée)", async () => {
    configureSupabase({ domain_requests: { data: { ...pendingRequest, payment_status: "paid" }, error: null } });
    await resolveDomainRequest("req-1", "registered", "admin-1");

    expect(updateCalls.find((c) => c.table === "domain_requests")).toBeTruthy();
    const tenantDomainUpsert = upsertCalls.find((c) => c.table === "tenant_domains");
    expect(tenantDomainUpsert).toBeTruthy();
    expect(tenantDomainUpsert?.payload).toMatchObject({ organization_id: "org-1", domain: "boutique-fatou.cm", verified: true });
    expect(tenantDomainUpsert?.options).toMatchObject({ onConflict: "domain" });
  });

  it("un statut non « registered » (ex: annulée) ne touche jamais tenant_domains", async () => {
    configureSupabase({ domain_requests: { data: pendingRequest, error: null } });
    await resolveDomainRequest("req-1", "cancelled", "admin-1");
    expect(upsertCalls.some((c) => c.table === "tenant_domains")).toBe(false);
  });

  it("demande introuvable : NotFoundError, rien écrit", async () => {
    configureSupabase({ domain_requests: { data: null, error: null } });
    await expect(resolveDomainRequest("req-x", "registered", "admin-1")).rejects.toBeInstanceOf(NotFoundError);
    expect(updateCalls).toHaveLength(0);
  });
});

describe("setDomainRequestPaymentStatus", () => {
  it("consigne le changement dans le journal d'audit avec l'état avant/après", async () => {
    configureSupabase({ domain_requests: { data: { organization_id: "org-1", domain_name: "boutique-fatou.cm", payment_status: "unpaid" }, error: null } });
    await setDomainRequestPaymentStatus("req-1", "paid", "admin-1");
    expect(vi.mocked(writeAdminAuditLog)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "DOMAIN_REQUEST_PAYMENT_UPDATED", beforeState: { paymentStatus: "unpaid" }, afterState: { paymentStatus: "paid" } }),
    );
  });
});
