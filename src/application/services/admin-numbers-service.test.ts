import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./admin-organizations-service", () => ({
  writeAdminAuditLog: vi.fn(),
}));

interface QueryResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import {
  assignPhoneNumberToOrganization,
  unassignPhoneNumber,
} from "./admin-numbers-service";
import { writeAdminAuditLog } from "./admin-organizations-service";
import { ValidationError, NotFoundError } from "@/lib/errors";

const mockWriteAdminAuditLog = vi.mocked(writeAdminAuditLog);

/**
 * Même esprit que ai-credits-service.test.ts / admin-observability-
 * service.test.ts : un seul résultat statique par table, peu importe la
 * séquence exacte d'appels (select/eq/maybeSingle pour la lecture avant
 * écriture, update/eq pour la mutation elle-même). Suffisant ici car ni
 * `assignPhoneNumberToOrganization` ni `unassignPhoneNumber` ne
 * dépendent du contenu du résultat de l'UPDATE (seul `error` est
 * inspecté après coup) — la logique testée porte sur les branches de
 * validation avant l'écriture, pas sur la mutation elle-même.
 */
function configureSupabase(byTable: Record<string, QueryResult>) {
  mockFrom.mockImplementation((table: string) => {
    const result: QueryResult = byTable[table] ?? { data: null, error: null };
    const builder = {
      select: () => builder,
      eq: () => builder,
      update: () => builder,
      maybeSingle: () => Promise.resolve(result),
      then: (onFulfilled: (v: QueryResult) => unknown) => Promise.resolve(result).then(onFulfilled),
    };
    return builder;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assignPhoneNumberToOrganization", () => {
  it("assigne un numéro disponible et écrit un audit log avec avant/après", async () => {
    configureSupabase({
      phone_numbers: {
        data: { id: "num-1", phone_e164: "+237690000000", organization_id: null, status: "available" },
        error: null,
      },
    });

    await assignPhoneNumberToOrganization("num-1", "org-1", "admin-1");

    expect(mockWriteAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "admin-1",
        organizationId: "org-1",
        entityId: "num-1",
        action: "PHONE_NUMBER_ASSIGNED",
        beforeState: { phone_e164: "+237690000000", organization_id: null },
        afterState: { phone_e164: "+237690000000", organization_id: "org-1" },
      }),
    );
  });

  it("réassigner un numéro déjà assigné à la MÊME organisation reste autorisé (idempotent)", async () => {
    configureSupabase({
      phone_numbers: {
        data: { id: "num-1", phone_e164: "+237690000000", organization_id: "org-1", status: "assigned" },
        error: null,
      },
    });

    await expect(assignPhoneNumberToOrganization("num-1", "org-1", "admin-1")).resolves.not.toThrow();
  });

  it("refuse d'assigner un numéro déjà assigné à une AUTRE organisation", async () => {
    configureSupabase({
      phone_numbers: {
        data: { id: "num-1", phone_e164: "+237690000000", organization_id: "org-2", status: "assigned" },
        error: null,
      },
    });

    await expect(assignPhoneNumberToOrganization("num-1", "org-1", "admin-1")).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mockWriteAdminAuditLog).not.toHaveBeenCalled();
  });

  it("refuse d'assigner un numéro suspendu", async () => {
    configureSupabase({
      phone_numbers: {
        data: { id: "num-1", phone_e164: "+237690000000", organization_id: null, status: "suspended" },
        error: null,
      },
    });

    await expect(assignPhoneNumberToOrganization("num-1", "org-1", "admin-1")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("lève NotFoundError si le numéro n'existe pas", async () => {
    configureSupabase({ phone_numbers: { data: null, error: null } });

    await expect(assignPhoneNumberToOrganization("num-inconnu", "org-1", "admin-1")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("unassignPhoneNumber", () => {
  it("retire un numéro assigné et conserve l'organisation d'origine dans l'audit log (before_state)", async () => {
    configureSupabase({
      phone_numbers: {
        data: { id: "num-1", phone_e164: "+237690000000", organization_id: "org-1" },
        error: null,
      },
    });

    await unassignPhoneNumber("num-1", "admin-1");

    expect(mockWriteAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1", // jamais null : c'est l'organisation qui perd le numéro
        action: "PHONE_NUMBER_UNASSIGNED",
        beforeState: { phone_e164: "+237690000000", organization_id: "org-1" },
        afterState: { phone_e164: "+237690000000", organization_id: null },
      }),
    );
  });

  it("refuse de retirer un numéro qui n'est assigné à aucune organisation", async () => {
    configureSupabase({
      phone_numbers: { data: { id: "num-1", phone_e164: "+237690000000", organization_id: null }, error: null },
    });

    await expect(unassignPhoneNumber("num-1", "admin-1")).rejects.toBeInstanceOf(ValidationError);
    expect(mockWriteAdminAuditLog).not.toHaveBeenCalled();
  });

  it("lève NotFoundError si le numéro n'existe pas", async () => {
    configureSupabase({ phone_numbers: { data: null, error: null } });

    await expect(unassignPhoneNumber("num-inconnu", "admin-1")).rejects.toBeInstanceOf(NotFoundError);
  });
});
