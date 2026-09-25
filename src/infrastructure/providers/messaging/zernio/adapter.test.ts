import { describe, it, expect, vi } from "vitest";
import { ZernioAdapter } from "./adapter";
import type { ZernioClient } from "./client";

function makeClient(sendInboxMessage = vi.fn().mockResolvedValue({ id: "msg_1", status: "sent" })) {
  return { sendInboxMessage } as unknown as ZernioClient;
}

/**
 * Conversations 1:1 uniquement (session WhatsApp). Le CTA URL n'est PAS utilisé pour
 * les groupes : l'API Groupes ne prend pas en charge les messages interactifs — voir
 * ZernioInteractiveCtaUrl (fusion #17).
 */
describe("ZernioAdapter.sendMessage — bouton CTA URL (corrigé 19/09/2026, confirmé via docs.zernio.com + github.com/zernio-dev/chat-sdk-adapter)", () => {
  it("un seul bouton -> envoie un message interactif cta_url, jamais le texte brut en double", async () => {
    const sendInboxMessage = vi.fn().mockResolvedValue({ id: "msg_1", status: "sent" });
    const adapter = new ZernioAdapter(makeClient(sendInboxMessage), "profile_1", "account_1");

    await adapter.sendMessage("org_1", {
      to: "contact_1",
      channel: "whatsapp",
      content: "Sac en cuir — 25 000 FCFA",
      externalThreadId: "conv_zernio_1",
      buttons: [{ text: "Voir plus", url: "https://monsalon.flexco .app/produits/sac-en-cuir" }],
    });

    expect(sendInboxMessage).toHaveBeenCalledWith("conv_zernio_1", {
      accountId: "account_1",
      interactive: {
        type: "cta_url",
        body: { text: "Sac en cuir — 25 000 FCFA" },
        action: { name: "cta_url", parameters: { display_text: "Voir plus", url: "https://monsalon.flexco .app/produits/sac-en-cuir" } },
      },
    });
  });

  it("aucun bouton -> message texte simple, inchangé", async () => {
    const sendInboxMessage = vi.fn().mockResolvedValue({ id: "msg_1", status: "sent" });
    const adapter = new ZernioAdapter(makeClient(sendInboxMessage), "profile_1", "account_1");

    await adapter.sendMessage("org_1", {
      to: "contact_1",
      channel: "whatsapp",
      content: "Bonjour !",
      externalThreadId: "conv_zernio_1",
    });

    expect(sendInboxMessage).toHaveBeenCalledWith("conv_zernio_1", {
      accountId: "account_1",
      message: "Bonjour !",
      attachmentUrl: undefined,
      attachmentType: undefined,
    });
  });

  it("plusieurs boutons -> repli sur le texte simple (cta_url ne supporte qu'un seul bouton par message WhatsApp)", async () => {
    const sendInboxMessage = vi.fn().mockResolvedValue({ id: "msg_1", status: "sent" });
    const adapter = new ZernioAdapter(makeClient(sendInboxMessage), "profile_1", "account_1");

    await adapter.sendMessage("org_1", {
      to: "contact_1",
      channel: "whatsapp",
      content: "Deux produits avec leurs liens en texte",
      externalThreadId: "conv_zernio_1",
      buttons: [
        { text: "Voir : A", url: "https://monsalon.flexco .app/produits/a" },
        { text: "Voir : B", url: "https://monsalon.flexco .app/produits/b" },
      ],
    });

    const call = sendInboxMessage.mock.calls[0]![1] as Record<string, unknown>;
    expect(call.interactive).toBeUndefined();
    expect(call.message).toBe("Deux produits avec leurs liens en texte");
  });
});

describe("ZernioAdapter.sendMessage — pièce jointe seule (comportement conservé de la branche multi-numéros/vocaux)", () => {
  it("vocal sans texte, sans bouton -> `message` omis (undefined), jamais une chaîne vide", async () => {
    const sendInboxMessage = vi.fn().mockResolvedValue({ id: "msg_1", status: "sent" });
    const adapter = new ZernioAdapter(makeClient(sendInboxMessage), "profile_1", "account_1");

    await adapter.sendMessage("org_1", {
      to: "contact_1",
      channel: "whatsapp",
      content: "",
      externalThreadId: "conv_zernio_1",
      attachmentUrl: "https://cdn.example.com/vocal.ogg",
      attachmentType: "audio",
    });

    expect(sendInboxMessage).toHaveBeenCalledWith("conv_zernio_1", {
      accountId: "account_1",
      message: undefined,
      attachmentUrl: "https://cdn.example.com/vocal.ogg",
      attachmentType: "audio",
    });
  });
});
