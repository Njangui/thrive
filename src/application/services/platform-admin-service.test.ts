import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Mock des deux clients Supabase utilisés par `requirePlatformAdmin()` :
 *  - `server-session-client` : simule `auth.getUser()`.
 *  - `server-client` (service-role) : simule la lecture de
 *    `platform_admins` via `.from().select().eq().maybeSingle()`.
 * Pas de pattern de référence direct dans le projet pour mocker ces deux
 * clients (les tests existants mockent des services applicatifs, pas les
 * clients Supabase eux-mêmes — voir conversation-orchestrator.test.ts) ;
 * ce fichier introduit ce pattern minimal pour platform-admin-service.
 */
const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock("@/infrastructure/supabase/server-session-client", () => ({
  getSupabaseServerSessionClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}));

vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: vi.fn(() => ({ from: mockFrom })),
}));

import { requirePlatformAdmin } from "./platform-admin-service";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";

beforeEach(() => {
  mockGetUser.mockReset();
  mockMaybeSingle.mockReset();
  mockEq.mockClear();
  mockSelect.mockClear();
  mockFrom.mockClear();
});

describe("requirePlatformAdmin", () => {
  it("lève AuthenticationError si aucune session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(AuthenticationError);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("lève AuthorizationError si connecté mais absent de platform_admins", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user_1" } } });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(AuthorizationError);
    expect(mockFrom).toHaveBeenCalledWith("platform_admins");
    expect(mockEq).toHaveBeenCalledWith("user_id", "user_1");
  });

  it("lève AuthorizationError (jamais un accès par défaut) si la lecture DB échoue", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user_1" } } });
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: "connexion perdue" } });

    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("retourne l'admin si présent dans platform_admins", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user_1" } } });
    mockMaybeSingle.mockResolvedValue({ data: { role: "super_admin" }, error: null });

    const result = await requirePlatformAdmin();

    expect(result).toEqual({ userId: "user_1", role: "super_admin" });
  });
});
