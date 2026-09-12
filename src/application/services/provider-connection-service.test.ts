import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

const mockNotifyOrgAdmins = vi.fn();
vi.mock("./notification-service", () => ({
  notifyOrgAdmins: (...args: unknown[]) => mockNotifyOrgAdmins(...args),
}));

import { handleAccountStatusChanged } from "./provider-connection-service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleAccountStatusChanged (Lot 3, audit master prompt §32/§44)", () => {
  it("déconnexion : met à jour provider_connections ET notifie (\"connexion perdue\")", async () => {
    const eqCalls: Array<[string, unknown]> = [];
    mockFrom.mockReturnValue({
      update: () => ({
        eq: (col: string, val: unknown) => {
          eqCalls.push([col, val]);
          return { eq: (c: string, v: unknown) => { eqCalls.push([c, v]); return { eq: (c2: string, v2: unknown) => { eqCalls.push([c2, v2]); return Promise.resolve({ error: null }); } }; } };
        },
      }),
    });

    await handleAccountStatusChanged("org-1", "acc_42", "error");

    expect(eqCalls).toContainEqual(["organization_id", "org-1"]);
    expect(eqCalls).toContainEqual(["metadata->>accountId", "acc_42"]);
    expect(mockNotifyOrgAdmins).toHaveBeenCalledTimes(1);
    expect(mockNotifyOrgAdmins.mock.calls[0]![0]).toMatchObject({ organizationId: "org-1", title: "Connexion perdue." });
  });

  it("reconnexion : met à jour le statut mais ne notifie PAS (pas de spam sur un retour à la normale)", async () => {
    mockFrom.mockReturnValue({
      update: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) }),
    });

    await handleAccountStatusChanged("org-1", "acc_42", "connected");

    expect(mockNotifyOrgAdmins).not.toHaveBeenCalled();
  });

  it("propage une erreur de mise à jour plutôt que de l'avaler silencieusement", async () => {
    mockFrom.mockReturnValue({
      update: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: { message: "boom" } }) }) }) }),
    });

    await expect(handleAccountStatusChanged("org-1", "acc_42", "error")).rejects.toThrow(/boom/);
    expect(mockNotifyOrgAdmins).not.toHaveBeenCalled();
  });
});
