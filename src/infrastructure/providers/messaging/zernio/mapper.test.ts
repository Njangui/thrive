import { describe, it, expect } from "vitest";
import { mapZernioEventToDomainEvent, mapZernioPostEventToDomainEvent } from "./mapper";
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

describe("mapZernioPostEventToDomainEvent — Lot M, Partie 2", () => {
  it("post.published (agrégé, avec platforms[] CONFIRMÉ) -> SOCIAL_POST_STATUS_UPDATED", () => {
    const event = mapZernioPostEventToDomainEvent(
      {
        id: "evt_post_1",
        event: "post.published",
        post: {
          _id: "zpost_1",
          status: "published",
          platforms: [
            { platform: "facebook", accountId: { _id: "acc_1", username: "MaBoutique" }, status: "published", platformPostUrl: "https://facebook.com/x" },
          ],
        },
        timestamp: "2026-08-31T09:00:00.000Z",
      },
      ORG_ID,
    );

    expect(event).not.toBeNull();
    expect(event?.type).toBe("SOCIAL_POST_STATUS_UPDATED");
    expect(event?.payload.providerPostId).toBe("zpost_1");
    expect(event?.payload.overallStatus).toBe("published");
    expect(event?.payload.targets).toEqual([
      { platform: "facebook", accountId: "acc_1", status: "published", platformPostId: undefined, platformPostUrl: "https://facebook.com/x", errorMessage: undefined },
    ]);
  });

  it("post.failed sans platforms[] détaillé -> statut agrégé quand même reflété, targets vide", () => {
    const event = mapZernioPostEventToDomainEvent(
      { id: "evt_post_2", event: "post.failed", post: { id: "zpost_2", status: "failed", error: "Compte déconnecté" }, timestamp: "2026-08-31T09:00:00.000Z" },
      ORG_ID,
    );

    expect(event?.payload.providerPostId).toBe("zpost_2");
    expect(event?.payload.overallStatus).toBe("failed");
    expect(event?.payload.overallErrorMessage).toBe("Compte déconnecté");
    expect(event?.payload.targets).toEqual([]);
  });

  it("post.platform.failed (granularité fine, un seul résultat) -> un seul target", () => {
    const event = mapZernioPostEventToDomainEvent(
      {
        id: "evt_post_3",
        event: "post.platform.failed",
        postId: "zpost_3",
        platform: "tiktok",
        accountId: "acc_3",
        error: "video too short for Reels",
        timestamp: "2026-08-31T09:00:00.000Z",
      },
      ORG_ID,
    );

    expect(event?.payload.providerPostId).toBe("zpost_3");
    expect(event?.payload.overallStatus).toBeUndefined();
    expect(event?.payload.targets).toEqual([
      { platform: "tiktok", accountId: "acc_3", status: "failed", platformPostUrl: undefined, errorMessage: "video too short for Reels" },
    ]);
  });

  it("ignore post.scheduled (déjà reflété par nos propres actions, pas par le webhook)", () => {
    const event = mapZernioPostEventToDomainEvent(
      { id: "evt_post_4", event: "post.scheduled", post: { id: "zpost_4", status: "scheduled" }, timestamp: "2026-08-31T09:00:00.000Z" },
      ORG_ID,
    );
    expect(event).toBeNull();
  });

  it("ignore un événement post.* sans id de post exploitable (jamais deviné)", () => {
    const event = mapZernioPostEventToDomainEvent(
      { id: "evt_post_5", event: "post.published", timestamp: "2026-08-31T09:00:00.000Z" },
      ORG_ID,
    );
    expect(event).toBeNull();
  });
});
