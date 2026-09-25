import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Distinction MESSAGERIE WhatsApp / GROUPES WhatsApp dans le webhook Zernio.
 * Deux comptes Zernio différents : les numéros de messagerie (clients en tête-à-tête, réponses
 * automatiques, CRM) et le numéro DÉDIÉ aux groupes (`provider_type = 'whatsapp_groups'`).
 */
const m = vi.hoisted(() => ({
  resolveByAccount: vi.fn(),
  resolveAnyStatus: vi.fn(),
  resolveByPost: vi.fn(),
  resolveBySocialProfile: vi.fn(),
  resolveGroupsAccount: vi.fn(),
  resolveSocialAccount: vi.fn(),
  handleInboundMessage: vi.fn(),
  processInboundAutoReply: vi.fn(),
  evaluateInboxChannel: vi.fn(),
  activateGroup: vi.fn(),
  isGroupThread: vi.fn(),
  insertEvent: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/env", () => ({ env: { ZERNIO_WEBHOOK_SIGNING_SECRET: "secret" } }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    from: () => ({
      insert: m.insertEvent,
      update: (payload: Record<string, unknown>) => {
        m.updates.push(payload);
        return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
      },
    }),
  }),
}));
vi.mock("@/infrastructure/providers/messaging/zernio/webhook-handler", () => ({
  verifyZernioSignature: () => true,
  hashPayload: () => "hash",
  parseZernioWebhookPayload: (raw: string) => {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value : [value];
  },
}));
vi.mock("@/infrastructure/providers/messaging/zernio/resolve-organization", () => ({
  resolveOrganizationIdByZernioAccount: m.resolveByAccount,
  resolveOrganizationIdByZernioAccountAnyStatus: m.resolveAnyStatus,
  resolveOrganizationIdByProviderPostId: m.resolveByPost,
  resolveOrganizationIdBySocialProfile: m.resolveBySocialProfile,
  resolveOrganizationIdByWhatsAppGroupsAccount: m.resolveGroupsAccount,
}));
vi.mock("@/application/services/conversation-service", () => ({ handleInboundMessage: m.handleInboundMessage }));
vi.mock("@/application/services/inbound-auto-reply-service", () => ({ processInboundAutoReply: m.processInboundAutoReply }));
vi.mock("@/application/services/first-comment-service", () => ({ handleTikTokUrlResolvedWebhook: vi.fn() }));
vi.mock("@/application/services/comment-auto-reply-service", () => ({ processCommentAutoReply: vi.fn() }));
vi.mock("@/application/services/inbox-channel-policy", () => ({ evaluateInboxChannel: m.evaluateInboxChannel }));
vi.mock("@/application/services/social-account-registry-service", () => ({ resolveOrganizationIdBySocialAccount: m.resolveSocialAccount, setSocialAccountStatus: vi.fn() }));
vi.mock("@/infrastructure/providers/registry", () => ({ getMessagingProviderForChannel: vi.fn() }));
vi.mock("@/application/services/whatsapp-group-service", () => ({ activateGroupFromInboundConversation: m.activateGroup }));
vi.mock("@/application/services/whatsapp-group-threads", () => ({ isWhatsAppGroupThread: m.isGroupThread }));
vi.mock("@/application/services/marketing-service", () => ({ handlePostStatusWebhook: vi.fn() }));
vi.mock("@/application/services/provider-connection-service", () => ({ handleAccountStatusChanged: vi.fn() }));
vi.mock("@/application/services/notification-service", () => ({ notifyOrgAdmins: vi.fn() }));
vi.mock("@/application/services/social-post-tracking-service", () => ({ trackExternalPost: vi.fn(), handleIncomingComment: vi.fn() }));

import { POST } from "./route";

let counter = 0;
function inbound(overrides: { accountId: string; conversationId: string; platform?: string; text?: string | null }) {
  counter += 1;
  return {
    id: `evt-${counter}`,
    event: "message.received",
    timestamp: "2026-09-21T10:00:00.000Z",
    account: { id: overrides.accountId, platform: overrides.platform ?? "whatsapp" },
    conversation: { id: overrides.conversationId, platform: overrides.platform ?? "whatsapp", contactId: "contact-1", contactName: "Awa", contactPhone: "+237600000000" },
    message: overrides.text === null ? { id: "msg-1" } : { id: "msg-1", text: overrides.text ?? "Bonjour, vous avez des sacs ?" },
  };
}
function deliver(event: unknown) {
  return POST(new Request("https://flexco .test/api/webhooks/zernio", { method: "POST", body: JSON.stringify(event), headers: { "x-zernio-signature": "sig" } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  m.updates.length = 0;
  m.resolveByAccount.mockResolvedValue(null);
  m.resolveAnyStatus.mockResolvedValue(null);
  m.resolveByPost.mockResolvedValue(null);
  m.resolveBySocialProfile.mockResolvedValue(null);
  m.resolveGroupsAccount.mockResolvedValue(null);
  m.resolveSocialAccount.mockResolvedValue(null);
  m.insertEvent.mockResolvedValue({ error: null });
  m.handleInboundMessage.mockResolvedValue({ conversationId: "conv-db-1", handoffStatus: "none", handoffReason: null });
  m.processInboundAutoReply.mockResolvedValue(undefined);
  m.evaluateInboxChannel.mockResolvedValue({ allowed: true, autoReply: true });
  m.activateGroup.mockResolvedValue(undefined);
  m.isGroupThread.mockResolvedValue(false);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Webhook Zernio — MESSAGERIE WhatsApp (clients en tête-à-tête)", () => {
  it("message client sur un numéro de messagerie : contact + conversation créés, réponse automatique évaluée", async () => {
    m.resolveByAccount.mockResolvedValue("org-1");

    const res = await deliver(inbound({ accountId: "acc-msg", conversationId: "conv-client-1" }));

    expect(res.status).toBe(200);
    expect(m.handleInboundMessage).toHaveBeenCalledTimes(1);
    expect(m.processInboundAutoReply).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1", conversationId: "conv-db-1", autoReplyAllowed: true }));
    expect(m.isGroupThread).toHaveBeenCalledWith("org-1", "conv-client-1");
  });

  it("le canal n'est pas WhatsApp (Messenger) : aucune vérification de groupe WhatsApp", async () => {
    m.resolveByAccount.mockResolvedValue("org-1");

    await deliver(inbound({ accountId: "acc-fb", conversationId: "conv-fb-1", platform: "facebook" }));

    expect(m.isGroupThread).not.toHaveBeenCalled();
    expect(m.handleInboundMessage).toHaveBeenCalledTimes(1);
  });

  it("défense en profondeur : un fil qui est un groupe WhatsApp connu, même reçu par un compte de messagerie, n'est PAS traité comme un client", async () => {
    m.resolveByAccount.mockResolvedValue("org-1");
    m.isGroupThread.mockResolvedValue(true);

    const res = await deliver(inbound({ accountId: "acc-msg", conversationId: "grp-1" }));

    expect(res.status).toBe(200);
    expect(m.handleInboundMessage).not.toHaveBeenCalled();
    expect(m.processInboundAutoReply).not.toHaveBeenCalled();
    expect(m.updates.at(-1)).toMatchObject({ status: "processed" });
  });
});

describe("Webhook Zernio — GROUPES WhatsApp (numéro dédié)", () => {
  it("message reçu sur le numéro de groupes : le groupe est ACTIVÉ, et RIEN d'autre (ni contact, ni réponse automatique, ni alerte)", async () => {
    m.resolveGroupsAccount.mockResolvedValue("org-1");

    const res = await deliver(inbound({ accountId: "acc-groupes", conversationId: "grp-1" }));

    expect(res.status).toBe(200);
    expect(m.activateGroup).toHaveBeenCalledWith("org-1", "grp-1");
    expect(m.evaluateInboxChannel).not.toHaveBeenCalled();
    expect(m.handleInboundMessage).not.toHaveBeenCalled();
    expect(m.processInboundAutoReply).not.toHaveBeenCalled();
    expect(m.updates.at(-1)).toMatchObject({ status: "processed" });
  });

  it("message de groupe sans texte (média seul) : le groupe est activé quand même", async () => {
    m.resolveGroupsAccount.mockResolvedValue("org-1");

    await deliver(inbound({ accountId: "acc-groupes", conversationId: "grp-2", text: null }));

    expect(m.activateGroup).toHaveBeenCalledWith("org-1", "grp-2");
    expect(m.handleInboundMessage).not.toHaveBeenCalled();
  });

  it("un numéro de MESSAGERIE prime : le résolveur des groupes n'est même pas interrogé", async () => {
    m.resolveByAccount.mockResolvedValue("org-1");

    await deliver(inbound({ accountId: "acc-msg", conversationId: "conv-client-2" }));

    expect(m.resolveGroupsAccount).not.toHaveBeenCalled();
  });

  it("compte inconnu partout : événement ignoré (aucun tenant), rien n'est écrit", async () => {
    const res = await deliver(inbound({ accountId: "acc-inconnu", conversationId: "conv-x" }));

    expect(res.status).toBe(200);
    expect(m.insertEvent).not.toHaveBeenCalled();
    expect(m.activateGroup).not.toHaveBeenCalled();
    expect(m.handleInboundMessage).not.toHaveBeenCalled();
  });
});
