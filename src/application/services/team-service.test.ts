import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CurrentMembership } from "./auth-service";

vi.mock("@/infrastructure/providers/registry", () => ({
  getEmailProvider: vi.fn(),
}));

/**
 * Mock générique à file d'attente (extension du pattern déjà établi dans
 * whatsapp-group-service.test.ts) : contrairement à ce fichier-là,
 * team-service.ts interroge PARFOIS la même table plusieurs fois dans un
 * seul appel avec des résultats différents attendus à chaque fois (ex:
 * inviteMember lit `team_invitations` une fois pour chercher une
 * invitation existante, puis l'insère) — d'où une file (queue) par table
 * plutôt qu'une valeur unique. Le dernier élément poussé reste la valeur
 * par défaut une fois la file épuisée, pour les tests qui ne poussent
 * qu'une seule valeur (comportement identique à l'ancien Map simple).
 */
interface MockResult {
  data: unknown;
  error: unknown;
  count?: number;
}

const tableResultQueues = new Map<string, MockResult[]>();
const insertCalls: { table: string; rows: unknown }[] = [];
const updateCalls: { table: string; patch: unknown }[] = [];
const deleteCalls: { table: string }[] = [];
type GetUserByIdResult = { data: { user: { email: string | null } | null }; error: null };
let mockGetUserById = vi.fn(
  async (_id: string): Promise<GetUserByIdResult> => ({
    data: { user: { email: null } },
    error: null,
  }),
);

function pushResult(table: string, result: MockResult) {
  const queue = tableResultQueues.get(table) ?? [];
  queue.push(result);
  tableResultQueues.set(table, queue);
}

function nextResult(table: string): MockResult {
  const queue = tableResultQueues.get(table);
  if (!queue || queue.length === 0) return { data: null, error: null };
  return queue.length > 1 ? queue.shift()! : queue[0]!;
}

function makeBuilder(table: string) {
  const resultFor = () => nextResult(table);
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    insert: vi.fn((rows: unknown) => {
      insertCalls.push({ table, rows });
      return builder;
    }),
    update: vi.fn((patch: unknown) => {
      updateCalls.push({ table, patch });
      return builder;
    }),
    upsert: vi.fn((rows: unknown) => {
      insertCalls.push({ table, rows });
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

vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    from: mockFrom,
    auth: { admin: { getUserById: (...args: [string]) => mockGetUserById(...args) } },
  }),
}));

import {
  inviteMember,
  acceptInvitation,
  updateMemberRole,
  removeMember,
  listMembers,
} from "./team-service";
import { getEmailProvider } from "@/infrastructure/providers/registry";

const mockGetEmailProvider = vi.mocked(getEmailProvider);

beforeEach(() => {
  vi.clearAllMocks();
  tableResultQueues.clear();
  insertCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  mockGetUserById = vi.fn(async (_id: string): Promise<GetUserByIdResult> => ({ data: { user: { email: null } }, error: null }));
});

describe("inviteMember", () => {
  it("refuse le rôle owner, sans toucher la base", async () => {
    await expect(inviteMember("org-1", "test@example.com", "owner", "user-1")).rejects.toThrow(/Propriétaire/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("refuse une adresse email invalide", async () => {
    await expect(inviteMember("org-1", "pas-un-email", "admin", "user-1")).rejects.toThrow(/email/i);
  });

  it("crée l'invitation même si l'envoi d'email échoue — jamais bloquant", async () => {
    pushResult("organizations", { data: { name: "Ma Boutique" }, error: null });
    pushResult("team_invitations", { data: null, error: null }); // pas d'invitation existante
    pushResult("team_invitations", { data: { id: "inv-1" }, error: null }); // insert

    mockGetEmailProvider.mockRejectedValue(new Error("RESEND_API_KEY manquant"));

    const result = await inviteMember("org-1", "collegue@example.com", "employee", "user-1");

    expect(result.invitationId).toBe("inv-1");
    expect(result.emailDelivered).toBe(false);
    expect(result.emailError).toMatch(/RESEND_API_KEY/);
    expect(result.inviteUrl).toContain("/invite/accept?token=");

    const invitationInsert = insertCalls.find((c) => c.table === "team_invitations");
    expect(invitationInsert).toBeDefined();
    expect((invitationInsert!.rows as { email: string }).email).toBe("collegue@example.com");
  });

  it("révoque l'invitation pending existante avant d'en créer une nouvelle", async () => {
    pushResult("organizations", { data: { name: "Ma Boutique" }, error: null });
    pushResult("team_invitations", { data: { id: "old-inv" }, error: null }); // invitation existante
    pushResult("team_invitations", { data: { id: "new-inv" }, error: null }); // insert

    mockGetEmailProvider.mockResolvedValue({
      providerName: "console-log",
      sendEmail: vi.fn(async () => ({ delivered: false })),
    });

    await inviteMember("org-1", "collegue@example.com", "admin", "user-1");

    const revokeUpdate = updateCalls.find(
      (c) => c.table === "team_invitations" && (c.patch as { status?: string }).status === "revoked",
    );
    expect(revokeUpdate).toBeDefined();
  });
});

describe("acceptInvitation", () => {
  it("refuse une invitation déjà acceptée", async () => {
    pushResult("team_invitations", {
      data: { id: "inv-1", organization_id: "org-1", role: "employee", status: "accepted", expires_at: new Date(Date.now() + 100000).toISOString() },
      error: null,
    });
    await expect(acceptInvitation("token-1", "user-2")).rejects.toThrow(/déjà été acceptée/);
  });

  it("refuse une invitation révoquée", async () => {
    pushResult("team_invitations", {
      data: { id: "inv-1", organization_id: "org-1", role: "employee", status: "revoked", expires_at: new Date(Date.now() + 100000).toISOString() },
      error: null,
    });
    await expect(acceptInvitation("token-1", "user-2")).rejects.toThrow(/révoquée/);
  });

  it("refuse et marque expirée une invitation dont la date est dépassée", async () => {
    pushResult("team_invitations", {
      data: {
        id: "inv-1",
        organization_id: "org-1",
        role: "employee",
        status: "pending",
        expires_at: new Date(Date.now() - 1000).toISOString(),
      },
      error: null,
    });

    await expect(acceptInvitation("token-1", "user-2")).rejects.toThrow(/expiré/);

    const expireUpdate = updateCalls.find(
      (c) => c.table === "team_invitations" && (c.patch as { status?: string }).status === "expired",
    );
    expect(expireUpdate).toBeDefined();
  });

  it("crée la membership et marque l'invitation acceptée — chemin nominal", async () => {
    pushResult("team_invitations", {
      data: {
        id: "inv-1",
        organization_id: "org-1",
        role: "manager",
        status: "pending",
        expires_at: new Date(Date.now() + 100000).toISOString(),
        organizations: { name: "Ma Boutique" },
      },
      error: null,
    });

    const result = await acceptInvitation("token-1", "user-2");

    expect(result).toEqual({ organizationId: "org-1", organizationName: "Ma Boutique" });

    const membershipUpsert = insertCalls.find((c) => c.table === "memberships");
    expect(membershipUpsert).toBeDefined();
    expect(membershipUpsert!.rows).toEqual({ organization_id: "org-1", user_id: "user-2", role: "manager" });

    const acceptUpdate = updateCalls.find(
      (c) => c.table === "team_invitations" && (c.patch as { status?: string }).status === "accepted",
    );
    expect(acceptUpdate).toBeDefined();
  });
});

const adminActor: CurrentMembership = { userId: "admin-1", organizationId: "org-1", role: "admin" };
const ownerActor: CurrentMembership = { userId: "owner-1", organizationId: "org-1", role: "owner" };

describe("updateMemberRole — un Admin ne peut jamais toucher un Owner", () => {
  it("refuse quand la cible est owner et l'appelant seulement admin", async () => {
    pushResult("memberships", { data: { role: "owner" }, error: null });

    await expect(updateMemberRole("org-1", "target-1", "employee", adminActor)).rejects.toThrow(/Propriétaire/);
    expect(updateCalls.find((c) => c.table === "memberships")).toBeUndefined();
  });

  it("refuse de rétrograder le dernier Owner, même par un autre Owner", async () => {
    pushResult("memberships", { data: { role: "owner" }, error: null }); // getTargetMembership
    pushResult("memberships", { data: null, error: null, count: 1 }); // countOwners

    await expect(updateMemberRole("org-1", "target-1", "admin", ownerActor)).rejects.toThrow(/au moins un Propriétaire/);
  });

  it("autorise un Owner à changer le rôle d'un Admin", async () => {
    pushResult("memberships", { data: { role: "admin" }, error: null });

    await updateMemberRole("org-1", "target-1", "manager", ownerActor);

    const update = updateCalls.find((c) => c.table === "memberships");
    expect(update).toBeDefined();
    expect(update!.patch).toEqual({ role: "manager" });
  });
});

describe("removeMember — même protection que updateMemberRole", () => {
  it("refuse quand la cible est owner et l'appelant seulement admin", async () => {
    pushResult("memberships", { data: { role: "owner" }, error: null });

    await expect(removeMember("org-1", "target-1", adminActor)).rejects.toThrow(/Propriétaire/);
    expect(deleteCalls.length).toBe(0);
  });

  it("refuse de retirer le dernier Owner", async () => {
    pushResult("memberships", { data: { role: "owner" }, error: null });
    pushResult("memberships", { data: null, error: null, count: 1 });

    await expect(removeMember("org-1", "target-1", ownerActor)).rejects.toThrow(/dernier Propriétaire/);
  });

  it("retire normalement un membre non-owner", async () => {
    pushResult("memberships", { data: { role: "employee" }, error: null });

    await removeMember("org-1", "target-1", adminActor);
    expect(deleteCalls.find((c) => c.table === "memberships")).toBeDefined();
  });
});

describe("listMembers", () => {
  it("résout l'email de chaque membre sans bloquer si l'API Admin échoue pour l'un d'eux", async () => {
    pushResult("memberships", {
      data: [
        { user_id: "user-1", role: "owner", created_at: "2026-01-01T00:00:00Z" },
        { user_id: "user-2", role: "employee", created_at: "2026-01-02T00:00:00Z" },
      ],
      error: null,
    });
    mockGetUserById = vi.fn(
      async (id: string): Promise<GetUserByIdResult> =>
        id === "user-1"
          ? { data: { user: { email: "owner@example.com" } }, error: null }
          : { data: { user: null }, error: null },
    );

    const members = await listMembers("org-1");

    expect(members).toHaveLength(2);
    expect(members[0]).toMatchObject({ userId: "user-1", email: "owner@example.com", role: "owner" });
    expect(members[1]).toMatchObject({ userId: "user-2", email: null, role: "employee" });
  });
});
