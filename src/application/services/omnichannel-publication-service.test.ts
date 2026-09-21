import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Deux jeux de tests réunis à la fusion #17 (même nom de fichier sur deux branches) :
 *
 * 1. Interaction entre deux lots (fusion #15) : Telegram Omnichannel v3
 *    (omnichannel-publication-service.ts) et WhatsApp Coexistence (numéro dédié
 *    aux Groupes). Un numéro en Coexistence ne supporte PAS l'API Groupes : l'envoi
 *    immédiat vers un groupe doit donc passer par le fournisseur du numéro dédié
 *    (`getWhatsAppGroupsProvider`), jamais par le profil de messagerie 1:1
 *    (`getMessagingProvider(..., "zernio")`). Un simple merge de texte ne détecte
 *    pas ce conflit — d'où ce test.
 *
 * 2. Liens produit sur le domaine RÉEL du tenant + boutons Telegram (branche
 *    « liens tenant + boutons », ex-FUSION_14) — et, ajoutés à la fusion #17, les
 *    tests qui verrouillent les décisions de fusion : aucun bouton vers un groupe
 *    WhatsApp (messages interactifs non pris en charge par l'API Groupes), boutons
 *    Telegram conservés même quand la vidéo est téléversée (`uploadBinary`).
 */

const mocks = vi.hoisted(() => ({
  getWhatsAppGroupsProvider: vi.fn(),
  getMessagingProvider: vi.fn(),
  getSocialPublishingProvider: vi.fn(),
  listConnectedGroups: vi.fn(),
  createBroadcast: vi.fn(),
  getProductsByIds: vi.fn(),
  getTelegramChannelStatus: vi.fn(),
  getTenantPublicOrigin: vi.fn(),
  canUseFeature: vi.fn(),
  assertPublicationMediaAvailable: vi.fn(),
  telegramVideoLimitErrorForUrl: vi.fn(),
  groupSendMessage: vi.fn(),
  telegramSendMessage: vi.fn(),
  telegramInsert: vi.fn(),
}));

vi.mock("@/infrastructure/providers/registry", () => ({
  getWhatsAppGroupsProvider: mocks.getWhatsAppGroupsProvider,
  getMessagingProvider: mocks.getMessagingProvider,
  getSocialPublishingProvider: mocks.getSocialPublishingProvider,
}));
vi.mock("./whatsapp-group-service", () => ({
  listConnectedGroups: mocks.listConnectedGroups,
  createBroadcast: mocks.createBroadcast,
}));
vi.mock("./catalog-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./catalog-service")>();
  return { ...actual, getProductsByIds: mocks.getProductsByIds }; // garde buildProductButtons (pur) réel
});
vi.mock("./telegram-channel-service", () => ({ getTelegramChannelStatus: mocks.getTelegramChannelStatus }));
vi.mock("./entitlements-service", () => ({
  canUseFeature: mocks.canUseFeature,
  isFeatureEnabled: vi.fn(async () => ({ enabled: true, limit: -1 })),
  hasFeature: vi.fn(async () => true),
}));
vi.mock("./catalog-video-service", () => ({
  assertPublicationMediaAvailable: mocks.assertPublicationMediaAvailable,
  telegramVideoLimitErrorForUrl: mocks.telegramVideoLimitErrorForUrl,
}));
vi.mock("@/infrastructure/tenant/resolve-request-tenant", () => ({ getTenantPublicOrigin: mocks.getTenantPublicOrigin }));
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: () => ({ insert: mocks.telegramInsert }) }),
}));

import { publishOmnichannel, buildCatalogPublicationContent, type PublicationTarget } from "./omnichannel-publication-service";
import type { CatalogProductSummary } from "./catalog-service";

const ORIGIN = "https://habynex.cresyva.app";

const SAC: CatalogProductSummary = {
  id: "p1",
  name: "Sac en cuir",
  slug: "sac-en-cuir",
  unitPrice: 25000,
  description: "Fait main",
  categoryName: "Maroquinerie",
  imageUrl: null,
};

const VILLA: CatalogProductSummary = {
  id: "p2",
  name: "Villa à Awea",
  slug: "villa-a-awea",
  unitPrice: 50000,
  description: null,
  categoryName: "Studio",
  imageUrl: null,
};

describe("buildCatalogPublicationContent", () => {
  it("inclut le lien de CHAQUE produit sous le domaine du TENANT passé en paramètre — jamais un domaine générique en dur", () => {
    const content = buildCatalogPublicationContent([SAC], ORIGIN);
    expect(content).toContain(`${ORIGIN}/produits/sac-en-cuir`);
    expect(content).not.toContain("scholarmach");
    expect(content).not.toContain("sme-os.app");
  });

  it("includeLinks=false n'affiche aucun lien en clair (cas Telegram : le lien part dans un bouton, pas dans le texte)", () => {
    const content = buildCatalogPublicationContent([SAC, VILLA], ORIGIN, null, false);
    expect(content).not.toContain(ORIGIN);
    expect(content).toContain("Sac en cuir");
    expect(content).toContain("Villa à Awea");
  });

  it("garde le préfixe personnalisé en tête de message quand fourni", () => {
    const content = buildCatalogPublicationContent([SAC], ORIGIN, "Nouveautés de la semaine !");
    expect(content.startsWith("Nouveautés de la semaine !")).toBe(true);
  });
});

const groupTarget: PublicationTarget = {
  id: "whatsapp_group:g1",
  type: "whatsapp_group",
  platform: "whatsapp",
  label: "WhatsApp · Clients VIP",
  accountId: "g1",
  available: true,
};

const telegramTarget: PublicationTarget = {
  id: "telegram:123",
  type: "telegram",
  platform: "telegram",
  label: "Telegram · Clients",
  accountId: "123",
  available: true,
};

const baseInput = {
  organizationId: "org-1",
  actorUserId: "user-1",
  productIds: ["p1"],
  targets: [groupTarget],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProductsByIds.mockResolvedValue([
    { id: "p1", name: "Savon", unitPrice: 1500, categoryName: null, description: null, slug: null, imageUrl: null },
  ]);
  mocks.getTenantPublicOrigin.mockResolvedValue(ORIGIN);
  mocks.canUseFeature.mockResolvedValue({ allowed: true, limit: 10, used: 0, remaining: 10 });
  mocks.assertPublicationMediaAvailable.mockResolvedValue(undefined);
  mocks.telegramVideoLimitErrorForUrl.mockResolvedValue(null);
  mocks.groupSendMessage.mockResolvedValue({ providerMessageId: "m1", status: "sent" });
  mocks.telegramSendMessage.mockResolvedValue({ providerMessageId: "1", status: "sent" });
  mocks.telegramInsert.mockResolvedValue({ error: null });
  mocks.getWhatsAppGroupsProvider.mockResolvedValue({ sendMessage: mocks.groupSendMessage });
  mocks.getMessagingProvider.mockResolvedValue({ sendMessage: mocks.telegramSendMessage });
  mocks.listConnectedGroups.mockResolvedValue([
    { id: "g1", externalId: "ext-1", zernioConversationId: "conv-1", name: "Clients VIP", isSendable: true },
  ]);
});

describe("publishOmnichannel — groupes WhatsApp", () => {
  it("envoi immédiat : passe par le fournisseur du numéro DÉDIÉ, jamais par la messagerie 1:1", async () => {
    const result = await publishOmnichannel(baseInput);

    expect(result.published).toBe(1);
    expect(mocks.getWhatsAppGroupsProvider).toHaveBeenCalledWith("org-1");
    expect(mocks.getMessagingProvider).not.toHaveBeenCalled();
    expect(mocks.groupSendMessage).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ to: "ext-1", channel: "whatsapp" }),
    );
  });

  it("externalThreadId = la conversation Zernio du groupe (zernioConversationId), PAS l'identifiant du groupe (externalId)", async () => {
    await publishOmnichannel(baseInput);

    const sent = mocks.groupSendMessage.mock.calls[0]![1] as { externalThreadId?: string; to: string };
    expect(sent.to).toBe("ext-1");
    expect(sent.externalThreadId).toBe("conv-1");
    expect(sent.externalThreadId).not.toBe("ext-1");
  });

  it("aucun bouton vers un groupe (messages interactifs non pris en charge) : lien produit gardé EN TEXTE, domaine du tenant", async () => {
    mocks.getProductsByIds.mockResolvedValue([SAC]); // un SEUL produit avec slug : le cas où C mettait un bouton

    await publishOmnichannel(baseInput);

    const sent = mocks.groupSendMessage.mock.calls[0]![1] as { content: string; buttons?: unknown };
    expect(sent.buttons).toBeUndefined();
    expect(sent.content).toContain(`${ORIGIN}/produits/sac-en-cuir`);
  });

  it("publication programmée : déléguée à createBroadcast, aucun fournisseur d'envoi sollicité", async () => {
    const scheduledFor = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = await publishOmnichannel({ ...baseInput, scheduledFor });

    expect(result.scheduled).toBe(1);
    expect(mocks.createBroadcast).toHaveBeenCalledWith("org-1", ["p1"], ["g1"], scheduledFor, "user-1");
    expect(mocks.getWhatsAppGroupsProvider).not.toHaveBeenCalled();
    expect(mocks.getMessagingProvider).not.toHaveBeenCalled();
  });

  it("groupe non activé (ou suspendu, numéro dédié repris) : échec explicite, rien n'est envoyé", async () => {
    mocks.listConnectedGroups.mockResolvedValue([
      { id: "g1", externalId: "ext-1", zernioConversationId: null, name: "Clients VIP", isSendable: false },
    ]);

    await expect(publishOmnichannel(baseInput)).rejects.toThrow("n'est pas encore activé");
    expect(mocks.groupSendMessage).not.toHaveBeenCalled();
  });

  it("groupe 'activable' mais sans conversation Zernio : même échec explicite, jamais d'envoi avec un mauvais identifiant", async () => {
    mocks.listConnectedGroups.mockResolvedValue([
      { id: "g1", externalId: "ext-1", zernioConversationId: null, name: "Clients VIP", isSendable: true },
    ]);

    await expect(publishOmnichannel(baseInput)).rejects.toThrow("n'est pas encore activé");
    expect(mocks.groupSendMessage).not.toHaveBeenCalled();
  });
});

describe("publishOmnichannel — Telegram (liens tenant + boutons)", () => {
  const telegramInput = { ...baseInput, productIds: ["p1"], targets: [telegramTarget] };

  it("envoi immédiat : un bouton « Voir plus » sous le domaine du tenant, et aucun lien en clair dans le texte", async () => {
    mocks.getProductsByIds.mockResolvedValue([SAC]);

    const result = await publishOmnichannel(telegramInput);

    expect(result.published).toBe(1);
    expect(mocks.telegramSendMessage).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        to: "123",
        channel: "telegram",
        buttons: [{ text: "Voir plus", url: `${ORIGIN}/produits/sac-en-cuir` }],
      }),
    );
    const sent = mocks.telegramSendMessage.mock.calls[0]![1] as { content: string };
    expect(sent.content).not.toContain(ORIGIN);
    expect(sent.content).toContain("Sac en cuir");
  });

  it("plusieurs produits : un bouton par produit, dans l'ordre", async () => {
    mocks.getProductsByIds.mockResolvedValue([SAC, VILLA]);

    await publishOmnichannel({ ...telegramInput, productIds: ["p1", "p2"] });

    const sent = mocks.telegramSendMessage.mock.calls[0]![1] as { buttons: { text: string; url: string }[] };
    expect(sent.buttons.map((b) => b.text)).toEqual(["Voir : Sac en cuir", "Voir : Villa à Awea"]);
  });

  it("vidéo téléversée (uploadBinary, branche vidéos catalogue) : le bouton est CONSERVÉ — sinon le message n'aurait plus aucun lien", async () => {
    mocks.getProductsByIds.mockResolvedValue([SAC]);

    await publishOmnichannel({
      ...telegramInput,
      mediaUrls: ["https://cdn.example.com/promo.mp4"],
      mediaType: "video",
    });

    expect(mocks.telegramSendMessage).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        attachmentType: "video",
        uploadBinary: true,
        buttons: [{ text: "Voir plus", url: `${ORIGIN}/produits/sac-en-cuir` }],
      }),
    );
  });

  it("produit sans slug : aucun bouton, pas de champ `buttons` envoyé", async () => {
    // fixture de base : slug null
    await publishOmnichannel(telegramInput);

    const sent = mocks.telegramSendMessage.mock.calls[0]![1] as { buttons?: unknown };
    expect(sent.buttons).toBeUndefined();
  });

  it("publication programmée : boutons + texte sans lien enregistrés dans telegram_publications (migration 0065)", async () => {
    mocks.getProductsByIds.mockResolvedValue([SAC]);
    const scheduledFor = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const result = await publishOmnichannel({ ...telegramInput, scheduledFor });

    expect(result.scheduled).toBe(1);
    expect(mocks.telegramInsert).toHaveBeenCalledTimes(1);
    const row = mocks.telegramInsert.mock.calls[0]![0] as { buttons: unknown; content: string; status: string };
    expect(row.status).toBe("scheduled");
    expect(row.buttons).toEqual([{ text: "Voir plus", url: `${ORIGIN}/produits/sac-en-cuir` }]);
    expect(row.content).not.toContain(ORIGIN);
    expect(mocks.telegramSendMessage).not.toHaveBeenCalled();
  });
});
