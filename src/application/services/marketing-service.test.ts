import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./entitlements-service", () => ({
  canUseFeature: vi.fn(),
  isFeatureEnabled: vi.fn(),
}));

// Lot O : la vérification d'appartenance des comptes ciblés passe par le
// registre `social_accounts` / `youtube_accounts` (mocké ici).
vi.mock("./social-account-registry-service", () => ({
  assertTargetsBelongToOrganization: vi.fn(),
}));

// Lot M — table-based builder (même pattern que whatsapp-group-service.test.ts)
// pour pouvoir tester handlePostStatusWebhook sans mocker Supabase en entier.
const tableResults = new Map<string, { data: unknown; error: unknown }>();
const updateCalls: { table: string; values: unknown; filters: [string, unknown][] }[] = [];

function makeBuilder(table: string) {
  const resultFor = () => tableResults.get(table) ?? { data: null, error: null };
  let pendingUpdate: { values: unknown; filters: [string, unknown][] } | null = null;
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      pendingUpdate?.filters.push([column, value]);
      return builder;
    }),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    update: vi.fn((values: unknown) => {
      pendingUpdate = { values, filters: [] };
      updateCalls.push({ table, values, filters: pendingUpdate.filters });
      return builder;
    }),
    maybeSingle: vi.fn(async () => resultFor()),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(resultFor()).then(resolve, reject),
  };
  return builder;
}

const mockFrom = vi.fn((table: string) => makeBuilder(table));
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

vi.mock("./notification-service", () => ({
  notifyOrgAdmins: vi.fn(),
}));
vi.mock("./analytics-service", () => ({
  trackEvent: vi.fn(),
}));

const mockGetSocialPublishingProvider = vi.fn();
vi.mock("@/infrastructure/providers/registry", () => ({
  getSocialPublishingProvider: (...args: unknown[]) => mockGetSocialPublishingProvider(...args),
}));

import {
  addHoursToNaiveIso,
  createCampaignFromProducts,
  handlePostStatusWebhook,
  pauseScheduledPostsForProduct,
} from "./marketing-service";
import { isFeatureEnabled } from "./entitlements-service";
import { assertTargetsBelongToOrganization } from "./social-account-registry-service";
import { ValidationError } from "@/lib/errors";
import { notifyOrgAdmins } from "./notification-service";
import { trackEvent } from "./analytics-service";
import type { SocialPostStatusUpdatedEvent } from "@/domain/events/domain-events";

const mockIsFeatureEnabled = vi.mocked(isFeatureEnabled);
const mockAssertTargetsBelong = vi.mocked(assertTargetsBelongToOrganization);
const mockNotifyOrgAdmins = vi.mocked(notifyOrgAdmins);
const mockTrackEvent = vi.mocked(trackEvent);

function postEvent(overrides: Partial<SocialPostStatusUpdatedEvent["payload"]>): SocialPostStatusUpdatedEvent {
  return {
    type: "SOCIAL_POST_STATUS_UPDATED",
    organizationId: "org-1",
    occurredAt: "2026-09-01T10:00:00.000Z",
    externalEventId: "evt-1",
    sourceProvider: "zernio",
    payload: {
      providerPostId: "zpost-1",
      targets: [],
      ...overrides,
    },
  };
}

describe("addHoursToNaiveIso", () => {
  it("décale de N heures sans changer le format", () => {
    expect(addHoursToNaiveIso("2026-09-01T18:00:00", 24)).toBe("2026-09-02T18:00:00");
  });

  it("étale 3 produits sur 3 créneaux distincts espacés de 24h (section 29)", () => {
    const slots = [0, 1, 2].map((i) => addHoursToNaiveIso("2026-09-01T18:00:00", i * 24));
    expect(slots).toEqual(["2026-09-01T18:00:00", "2026-09-02T18:00:00", "2026-09-03T18:00:00"]);
    // Pas de doublon involontaire (section 29)
    expect(new Set(slots).size).toBe(3);
  });

  it("gère le changement de mois correctement", () => {
    expect(addHoursToNaiveIso("2026-08-31T20:00:00", 24)).toBe("2026-09-01T20:00:00");
  });

  it("gère un décalage de 0 heure (premier produit de la campagne)", () => {
    expect(addHoursToNaiveIso("2026-09-01T18:00:00", 0)).toBe("2026-09-01T18:00:00");
  });
});

describe("createCampaignFromProducts — enforcement freemium v2 (plafonds cumulés à la connexion, appartenance à la publication)", () => {
  const baseInput = {
    organizationId: "org-1",
    name: "Promo rentrée",
    productIds: ["p1"],
    firstSlotAt: "2026-09-01T18:00:00",
    intervalHours: 24,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSocialPublishingProvider.mockResolvedValue({ listAccounts: vi.fn().mockResolvedValue([]) });
  });

  it("refuse AVANT tout accès DB si le réseau ciblé n'est pas inclus dans l'offre", async () => {
    mockIsFeatureEnabled.mockResolvedValue({ enabled: false, limit: 0 });

    await expect(
      createCampaignFromProducts({ ...baseInput, targets: [{ platform: "tiktok", accountId: "acc-1" }] }),
    ).rejects.toThrow(/n'est pas inclus dans votre offre/);

    expect(mockIsFeatureEnabled).toHaveBeenCalledWith("org-1", "tiktok_accounts");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("refuse AVANT tout accès DB un compte qui n'appartient pas à l'organisation (clé Zernio partagée par la plateforme)", async () => {
    mockIsFeatureEnabled.mockResolvedValue({ enabled: true, limit: 3 });
    mockAssertTargetsBelong.mockRejectedValue(new ValidationError("Un compte ciblé n'appartient pas à votre organisation."));

    await expect(
      createCampaignFromProducts({ ...baseInput, targets: [{ platform: "facebook", accountId: "acc-autre-tenant" }] }),
    ).rejects.toThrow(/n'appartient pas/);

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("autorisé : réseau inclus + comptes de l'organisation — la vérification reçoit exactement les cibles demandées", async () => {
    mockIsFeatureEnabled.mockResolvedValue({ enabled: true, limit: 3 });
    mockAssertTargetsBelong.mockResolvedValue(undefined);

    // Pas de configuration DB au-delà des gardes : la fonction échoue plus
    // loin (campagne non créée, mock par défaut) — seuls les points
    // d'application des droits nous intéressent ici.
    await expect(
      createCampaignFromProducts({
        ...baseInput,
        targets: [
          { platform: "facebook", accountId: "acc-1" },
          { platform: "facebook", accountId: "acc-2" },
        ],
      }),
    ).rejects.toThrow();

    // Un seul contrôle « réseau inclus » par plateforme, quel que soit le nombre de comptes.
    expect(mockIsFeatureEnabled).toHaveBeenCalledTimes(1);
    expect(mockAssertTargetsBelong).toHaveBeenCalledWith("org-1", [
      { platform: "facebook", accountId: "acc-1" },
      { platform: "facebook", accountId: "acc-2" },
    ]);
  });
});

describe("handlePostStatusWebhook — Lot M, Partie 2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableResults.clear();
    updateCalls.length = 0;
  });

  it("met à jour social_posts + social_post_targets et trackEvent sur post.published", async () => {
    tableResults.set("social_posts", { data: { id: "post-1", status: "scheduled" }, error: null });

    const result = await handlePostStatusWebhook(
      postEvent({
        overallStatus: "published",
        targets: [
          { platform: "facebook", accountId: "acc-1", status: "published", platformPostUrl: "https://fb.example/1" },
        ],
      }),
    );

    expect(result).toEqual({ handled: true });

    const postUpdate = updateCalls.find((c) => c.table === "social_posts");
    expect(postUpdate?.values).toEqual({ status: "published", error_message: null });
    expect(postUpdate?.filters).toContainEqual(["id", "post-1"]);

    const targetUpdate = updateCalls.find((c) => c.table === "social_post_targets");
    expect(targetUpdate?.values).toMatchObject({ status: "published", platform_post_url: "https://fb.example/1" });
    expect(targetUpdate?.filters).toContainEqual(["post_id", "post-1"]);
    expect(targetUpdate?.filters).toContainEqual(["platform", "facebook"]);

    expect(mockTrackEvent).toHaveBeenCalledWith("org-1", "publication_published", "social_post", "post-1", {
      providerPostId: "zpost-1",
    });
    expect(mockNotifyOrgAdmins).not.toHaveBeenCalled();
  });

  it("notifie les admins et met à jour le statut sur post.failed, sans trackEvent (rien n'a été publié)", async () => {
    tableResults.set("social_posts", { data: { id: "post-2", status: "scheduled" }, error: null });

    await handlePostStatusWebhook(
      postEvent({
        overallStatus: "failed",
        overallErrorMessage: "Le compte Instagram a été déconnecté.",
        targets: [{ platform: "instagram", accountId: "acc-2", status: "failed", errorMessage: "account disconnected" }],
      }),
    );

    const postUpdate = updateCalls.find((c) => c.table === "social_posts");
    expect(postUpdate?.values).toEqual({
      status: "failed",
      error_message: "Le compte Instagram a été déconnecté.",
    });

    expect(mockNotifyOrgAdmins).toHaveBeenCalledTimes(1);
    const notifyArg = mockNotifyOrgAdmins.mock.calls[0]![0];
    expect(notifyArg).toMatchObject({
      organizationId: "org-1",
      relatedEntityType: "social_post",
      relatedEntityId: "post-2",
    });
    expect(notifyArg.body).toContain("instagram");

    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  it("post.partial : notifie ET trackEvent (au moins une plateforme a réellement publié)", async () => {
    tableResults.set("social_posts", { data: { id: "post-3", status: "scheduled" }, error: null });

    await handlePostStatusWebhook(
      postEvent({
        overallStatus: "partial",
        targets: [
          { platform: "facebook", accountId: "acc-1", status: "published" },
          { platform: "tiktok", accountId: "acc-3", status: "failed", errorMessage: "video too short" },
        ],
      }),
    );

    expect(mockNotifyOrgAdmins).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
  });

  it("idempotent : ne recompte pas trackEvent si le post était déjà 'published' avant cet événement", async () => {
    tableResults.set("social_posts", { data: { id: "post-4", status: "published" }, error: null });

    await handlePostStatusWebhook(
      postEvent({
        targets: [{ platform: "facebook", accountId: "acc-1", status: "published" }],
      }),
    );

    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  it("aucun social_posts correspondant : ne plante pas, ne notifie pas, retourne handled=false", async () => {
    tableResults.set("social_posts", { data: null, error: null });

    const result = await handlePostStatusWebhook(postEvent({ overallStatus: "published" }));

    expect(result).toEqual({ handled: false });
    expect(mockNotifyOrgAdmins).not.toHaveBeenCalled();
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });
});

describe("pauseScheduledPostsForProduct — Lot 3 (audit master prompt §43/§95 : ne jamais marquer 'paused' sans confirmation)", () => {
  beforeEach(() => {
    tableResults.clear();
    updateCalls.length = 0;
    mockGetSocialPublishingProvider.mockReset();
    mockNotifyOrgAdmins.mockClear();
  });

  it("sans provider_post_id (jamais transmis à Zernio) : marque paused directement, aucun appel cancelPost", async () => {
    tableResults.set("social_posts", { data: [{ id: "post-1", provider_post_id: null }], error: null });
    mockGetSocialPublishingProvider.mockResolvedValue({ cancelPost: vi.fn() });

    await pauseScheduledPostsForProduct("org-1", "prod-1");

    expect(updateCalls).toContainEqual(
      expect.objectContaining({ table: "social_posts", values: { status: "paused" } }),
    );
    expect(mockNotifyOrgAdmins).not.toHaveBeenCalled();
  });

  it("provider_post_id présent + annulation confirmée : marque paused, efface error_message", async () => {
    tableResults.set("social_posts", { data: [{ id: "post-2", provider_post_id: "zpost-2" }], error: null });
    const cancelPost = vi.fn().mockResolvedValue(undefined);
    mockGetSocialPublishingProvider.mockResolvedValue({ cancelPost });

    await pauseScheduledPostsForProduct("org-1", "prod-1");

    expect(cancelPost).toHaveBeenCalledWith("zpost-2");
    expect(updateCalls).toContainEqual(
      expect.objectContaining({ table: "social_posts", values: { status: "paused", error_message: null } }),
    );
    expect(mockNotifyOrgAdmins).not.toHaveBeenCalled();
  });

  it("critère d'acceptation : provider_post_id présent + annulation ÉCHOUÉE -> ne marque JAMAIS paused, notifie l'admin", async () => {
    tableResults.set("social_posts", { data: [{ id: "post-3", provider_post_id: "zpost-3" }], error: null });
    const cancelPost = vi.fn().mockRejectedValue(new Error("Zernio indisponible"));
    mockGetSocialPublishingProvider.mockResolvedValue({ cancelPost });

    await pauseScheduledPostsForProduct("org-1", "prod-1");

    const pausedUpdate = updateCalls.find(
      (c) => c.table === "social_posts" && (c.values as { status?: string }).status === "paused",
    );
    expect(pausedUpdate).toBeUndefined(); // jamais "paused" sans confirmation réelle

    const errorUpdate = updateCalls.find((c) => c.table === "social_posts" && "error_message" in (c.values as object));
    expect((errorUpdate?.values as { error_message: string }).error_message).toContain("Zernio indisponible");

    expect(mockNotifyOrgAdmins).toHaveBeenCalledTimes(1);
  });

  it("aucun provider social connecté (compte déconnecté entre-temps) : ne marque pas paused non plus, notifie", async () => {
    tableResults.set("social_posts", { data: [{ id: "post-4", provider_post_id: "zpost-4" }], error: null });
    mockGetSocialPublishingProvider.mockRejectedValue(new Error("aucune connexion sociale"));

    await pauseScheduledPostsForProduct("org-1", "prod-1");

    const pausedUpdate = updateCalls.find(
      (c) => c.table === "social_posts" && (c.values as { status?: string }).status === "paused",
    );
    expect(pausedUpdate).toBeUndefined();
    expect(mockNotifyOrgAdmins).toHaveBeenCalledTimes(1);
  });

  it("plusieurs posts en échec pour le même produit : une seule notification agrégée, pas une par post", async () => {
    tableResults.set("social_posts", {
      data: [
        { id: "post-5", provider_post_id: "zpost-5" },
        { id: "post-6", provider_post_id: "zpost-6" },
      ],
      error: null,
    });
    const cancelPost = vi.fn().mockRejectedValue(new Error("timeout"));
    mockGetSocialPublishingProvider.mockResolvedValue({ cancelPost });

    await pauseScheduledPostsForProduct("org-1", "prod-1");

    expect(cancelPost).toHaveBeenCalledTimes(2);
    expect(mockNotifyOrgAdmins).toHaveBeenCalledTimes(1);
    expect(mockNotifyOrgAdmins.mock.calls[0]![0]).toMatchObject({ body: expect.stringContaining("2 publication") });
  });
});
