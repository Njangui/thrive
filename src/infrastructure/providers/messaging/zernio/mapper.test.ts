import { describe, it, expect } from "vitest";
import { mapZernioEventToDomainEvent } from "./mapper";
import type { ZernioInboxWebhookEvent } from "./types";

const ORG_ID = "org_123";

function buildEvent(overrides: Partial<ZernioInboxWebhookEvent> = {}): ZernioInboxWebhookEvent {
  return {
    id: "evt_abc",
    event: "message.received",
    message: { id: "msg_1", text: "Bonjour, vous avez des chaussures ?" },
    conversation: {
      id: "conv_1",
      contactId: "contact_1",
      contactName: "Awa",
      contactPhone: "+237600000000",
      platform: "whatsapp",
    },
    account: { id: "account_1", platform: "whatsapp" },
    timestamp: "2026-08-27T10:00:00.000Z",
    ...overrides,
  };
}

describe("mapZernioEventToDomainEvent", () => {
  it("traduit message.received en MESSAGE_RECEIVED normalisé", () => {
    const event = mapZernioEventToDomainEvent(buildEvent(), ORG_ID);

    expect(event).not.toBeNull();
    expect(event?.type).toBe("MESSAGE_RECEIVED");
    expect(event?.organizationId).toBe(ORG_ID);
    expect(event?.sourceProvider).toBe("zernio");
    expect(event?.externalEventId).toBe("evt_abc"); // clé de dédup officielle (payload.id)

    if (event?.type === "MESSAGE_RECEIVED") {
      expect(event.payload.content).toBe("Bonjour, vous avez des chaussures ?");
      expect(event.payload.externalThreadId).toBe("conv_1");
      expect(event.payload.phoneE164).toBe("+237600000000");
      expect(event.payload.channel).toBe("whatsapp");
    }
  });

  it("ignore un message sans texte plutôt que de planter (ex: pièce jointe pure)", () => {
    const event = mapZernioEventToDomainEvent(
      buildEvent({ message: { id: "msg_1" } }),
      ORG_ID,
    );
    expect(event).toBeNull();
  });

  it("ignore un événement sans conversation identifiable", () => {
    const event = mapZernioEventToDomainEvent(buildEvent({ conversation: undefined }), ORG_ID);
    expect(event).toBeNull();
  });

  it("ignore les types d'événements non mappés (pas d'invention de comportement)", () => {
    const event = mapZernioEventToDomainEvent(buildEvent({ event: "message.delivered" }), ORG_ID);
    expect(event).toBeNull();
  });

  it("retombe sur account.platform si conversation.platform est absent", () => {
    const event = mapZernioEventToDomainEvent(
      buildEvent({ conversation: { id: "conv_1", contactId: "c1" } }),
      ORG_ID,
    );
    if (event?.type === "MESSAGE_RECEIVED") {
      expect(event.payload.channel).toBe("whatsapp"); // vient de account.platform
    } else {
      throw new Error("event attendu");
    }
  });
});
