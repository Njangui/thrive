import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Interaction entre deux lots (fusion #15) : Telegram Omnichannel v3
 * (omnichannel-publication-service.ts) et WhatsApp Coexistence (numéro dédié
 * aux Groupes). Un numéro en Coexistence ne supporte PAS l'API Groupes : l'envoi
 * immédiat vers un groupe doit donc passer par le fournisseur du numéro dédié
 * (`getWhatsAppGroupsProvider`), jamais par le profil de messagerie 1:1
 * (`getMessagingProvider(..., "zernio")`). Un simple merge de texte ne détecte
 * pas ce conflit — d'où ce test.
 */

const mocks = vi.hoisted(() => ({
  getWhatsAppGroupsProvider: vi.fn(),
  getMessagingProvider: vi.fn(),
  getSocialPublishingProvider: vi.fn(),
  listConnectedGroups: vi.fn(),
  createBroadcast: vi.fn(),
  getProductsByIds: vi.fn(),
  getTelegramChannelStatus: vi.fn(),
  groupSendMessage: vi.fn(),
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
vi.mock("./catalog-service", () => ({ getProductsByIds: mocks.getProductsByIds }));
vi.mock("./telegram-channel-service", () => ({ getTelegramChannelStatus: mocks.getTelegramChannelStatus }));
vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: vi.fn() }));

import { publishOmnichannel, type PublicationTarget } from "./omnichannel-publication-service";

const groupTarget: PublicationTarget = {
  id: "whatsapp_group:g1",
  type: "whatsapp_group",
  platform: "whatsapp",
  label: "WhatsApp · Clients VIP",
  accountId: "g1",
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
  mocks.groupSendMessage.mockResolvedValue({ externalMessageId: "m1" });
  mocks.getWhatsAppGroupsProvider.mockResolvedValue({ sendMessage: mocks.groupSendMessage });
  mocks.listConnectedGroups.mockResolvedValue([{ id: "g1", externalId: "ext-1", name: "Clients VIP", isSendable: true }]);
});

describe("publishOmnichannel — groupes WhatsApp", () => {
  it("envoi immédiat : passe par le fournisseur du numéro DÉDIÉ, jamais par la messagerie 1:1", async () => {
    const result = await publishOmnichannel(baseInput);

    expect(result.published).toBe(1);
    expect(mocks.getWhatsAppGroupsProvider).toHaveBeenCalledWith("org-1");
    expect(mocks.getMessagingProvider).not.toHaveBeenCalled();
    expect(mocks.groupSendMessage).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ to: "ext-1", channel: "whatsapp", externalThreadId: "ext-1" }),
    );
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
    mocks.listConnectedGroups.mockResolvedValue([{ id: "g1", externalId: "ext-1", name: "Clients VIP", isSendable: false }]);

    await expect(publishOmnichannel(baseInput)).rejects.toThrow("n'est pas encore activé");
    expect(mocks.groupSendMessage).not.toHaveBeenCalled();
  });
});
