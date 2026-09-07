import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSendNotification = vi.fn();
const mockSetVapidDetails = vi.fn();

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: (...args: unknown[]) => mockSetVapidDetails(...args),
    sendNotification: (...args: unknown[]) => mockSendNotification(...args),
  },
}));

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

/**
 * push-service.ts lit `env.VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` une seule
 * fois, au chargement du module `@/lib/env` (comportement volontaire —
 * section 54, "échouer vite au démarrage"). Pour tester à la fois le cas
 * "VAPID configuré" et "VAPID absent" dans le même fichier, on modifie
 * process.env AVANT chaque import puis on force `vi.resetModules()` —
 * un unique import statique en tête de fichier ne permettrait de tester
 * qu'un seul des deux cas.
 */
async function importPushService(configured: boolean) {
  vi.resetModules();
  if (configured) {
    process.env.VAPID_PUBLIC_KEY = "test-vapid-public-key";
    process.env.VAPID_PRIVATE_KEY = "test-vapid-private-key";
  } else {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  }
  return import("./push-service");
}

function buildSubscriptionRow(overrides: Partial<{ id: string; endpoint: string }> = {}) {
  return {
    id: overrides.id ?? "sub-1",
    endpoint: overrides.endpoint ?? "https://push.example.com/ep-1",
    p256dh_key: "p256dh-1",
    auth_key: "auth-1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});

describe("sendPush", () => {
  it("ne fait rien (aucun appel DB ni réseau) si VAPID n'est pas configuré sur cet environnement", async () => {
    const { sendPush } = await importPushService(false);

    await expect(sendPush("org-1", "Titre", "Corps")).resolves.toBeUndefined();
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("ne fait rien si l'organisation n'a aucune souscription active", async () => {
    mockFrom.mockReturnValue({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) });

    const { sendPush } = await importPushService(true);
    await sendPush("org-1", "Titre", "Corps");

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("envoie une notification à chaque souscription active de l'organisation", async () => {
    const rows = [
      buildSubscriptionRow({ id: "sub-1" }),
      buildSubscriptionRow({ id: "sub-2", endpoint: "https://push.example.com/ep-2" }),
    ];
    mockFrom.mockReturnValue({ select: () => ({ eq: () => Promise.resolve({ data: rows, error: null }) }) });
    mockSendNotification.mockResolvedValue(undefined);

    const { sendPush } = await importPushService(true);
    await sendPush("org-1", "Titre", "Corps", "/dashboard/notifications");

    expect(mockSetVapidDetails).toHaveBeenCalled();
    expect(mockSendNotification).toHaveBeenCalledTimes(2);
  });

  it("n'échoue jamais (ne lève pas) même si l'envoi réseau vers une souscription échoue — critère d'acceptation Lot I", async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => Promise.resolve({ data: [buildSubscriptionRow()], error: null }) }),
    });
    mockSendNotification.mockRejectedValue(new Error("network down"));

    const { sendPush } = await importPushService(true);
    await expect(sendPush("org-1", "Titre", "Corps")).resolves.toBeUndefined();
  });

  it("nettoie automatiquement une souscription expirée (410) après un échec d'envoi", async () => {
    const deleteEq = vi.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockImplementation(() => ({
      select: () => ({ eq: () => Promise.resolve({ data: [buildSubscriptionRow({ id: "sub-expired" })], error: null }) }),
      delete: () => ({ eq: deleteEq }),
    }));
    mockSendNotification.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));

    const { sendPush } = await importPushService(true);
    await sendPush("org-1", "Titre", "Corps");

    expect(deleteEq).toHaveBeenCalledWith("id", "sub-expired");
  });

  it("ne supprime PAS la souscription pour une erreur d'envoi qui n'est pas une expiration (ex: 500)", async () => {
    const deleteEq = vi.fn();
    mockFrom.mockImplementation(() => ({
      select: () => ({ eq: () => Promise.resolve({ data: [buildSubscriptionRow()], error: null }) }),
      delete: () => ({ eq: deleteEq }),
    }));
    mockSendNotification.mockRejectedValue(Object.assign(new Error("server error"), { statusCode: 500 }));

    const { sendPush } = await importPushService(true);
    await sendPush("org-1", "Titre", "Corps");

    expect(deleteEq).not.toHaveBeenCalled();
  });

  it("n'échoue jamais même si la lecture des souscriptions lève une exception inattendue", async () => {
    mockFrom.mockImplementation(() => {
      throw new Error("connexion DB perdue");
    });

    const { sendPush } = await importPushService(true);
    await expect(sendPush("org-1", "Titre", "Corps")).resolves.toBeUndefined();
  });
});

describe("saveSubscription", () => {
  it("upsert la ligne avec onConflict sur endpoint (ré-abonnement idempotent)", async () => {
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockReturnValue({ upsert });

    const { saveSubscription } = await importPushService(true);
    await saveSubscription("org-1", "user-1", {
      endpoint: "https://push.example.com/ep",
      keys: { p256dh: "p", auth: "a" },
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "org-1",
        user_id: "user-1",
        endpoint: "https://push.example.com/ep",
        p256dh_key: "p",
        auth_key: "a",
      }),
      { onConflict: "endpoint" },
    );
  });

  it("lève une erreur explicite (jamais silencieuse) si l'écriture DB échoue", async () => {
    mockFrom.mockReturnValue({ upsert: () => Promise.resolve({ data: null, error: { message: "boom" } }) });

    const { saveSubscription } = await importPushService(true);
    await expect(
      saveSubscription("org-1", "user-1", { endpoint: "ep", keys: { p256dh: "p", auth: "a" } }),
    ).rejects.toThrow(/Impossible d'enregistrer/);
  });
});

describe("isPushConfigured", () => {
  it("reflète la présence des deux clés VAPID", async () => {
    const configured = await importPushService(true);
    expect(configured.isPushConfigured()).toBe(true);

    const notConfigured = await importPushService(false);
    expect(notConfigured.isPushConfigured()).toBe(false);
  });
});
