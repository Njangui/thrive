import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();
const mockRpc = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

import { resolveProviderCredential, resolveCredential } from "./secrets-resolver";

function mockConnectionLookup(result: { data: unknown; error: { message: string } | null }) {
  mockFrom.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve(result),
          }),
        }),
      }),
    }),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ZERNIO_API_KEY;
  delete process.env.MISTRAL_API_KEY;
});

describe("resolveProviderCredential (clé plateforme mono-tenant, inchangée)", () => {
  it("lit la variable d'environnement correspondante", () => {
    process.env.ZERNIO_API_KEY = "platform-zernio-key";
    expect(resolveProviderCredential("zernio")).toBe("platform-zernio-key");
  });

  it("lève si la variable n'est pas configurée", () => {
    expect(() => resolveProviderCredential("zernio")).toThrow();
  });
});

describe("resolveCredential — critère d'acceptation Lot N : repli vers la clé plateforme", () => {
  it("aucune ligne provider_connections pour ce tenant : retombe sur resolveProviderCredential (comportement inchangé)", async () => {
    process.env.ZERNIO_API_KEY = "platform-zernio-key";
    mockConnectionLookup({ data: null, error: null });

    const result = await resolveCredential("org-1", "messaging", "zernio");

    expect(result).toBe("platform-zernio-key");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("ligne provider_connections sans credential_reference (compte connecté mais jamais dédié) : retombe aussi sur la clé plateforme", async () => {
    process.env.ZERNIO_API_KEY = "platform-zernio-key";
    mockConnectionLookup({ data: { credential_reference: null }, error: null });

    const result = await resolveCredential("org-1", "messaging", "zernio");

    expect(result).toBe("platform-zernio-key");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("erreur de lecture provider_connections : retombe sur la clé plateforme plutôt que de lever", async () => {
    process.env.ZERNIO_API_KEY = "platform-zernio-key";
    mockConnectionLookup({ data: null, error: { message: "connexion perdue" } });

    const result = await resolveCredential("org-1", "messaging", "zernio");

    expect(result).toBe("platform-zernio-key");
  });

  it("credential_reference configuré : lit le secret via vault_read_secret et l'utilise, jamais la clé plateforme", async () => {
    process.env.ZERNIO_API_KEY = "platform-zernio-key";
    mockConnectionLookup({ data: { credential_reference: "secret-uuid-123" }, error: null });
    mockRpc.mockResolvedValue({ data: "tenant-dedicated-zernio-key", error: null });

    const result = await resolveCredential("org-1", "messaging", "zernio");

    expect(mockRpc).toHaveBeenCalledWith("vault_read_secret", { secret_id: "secret-uuid-123" });
    expect(result).toBe("tenant-dedicated-zernio-key");
  });

  it("credential_reference configuré mais lecture Vault en échec : lève, ne retombe JAMAIS silencieusement sur la clé plateforme (risque d'isolation)", async () => {
    process.env.ZERNIO_API_KEY = "platform-zernio-key";
    mockConnectionLookup({ data: { credential_reference: "secret-uuid-123" }, error: null });
    mockRpc.mockResolvedValue({ data: null, error: { message: "secret introuvable" } });

    await expect(resolveCredential("org-1", "messaging", "zernio")).rejects.toThrow();
  });
});
