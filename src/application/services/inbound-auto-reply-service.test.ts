import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  routeMessage: vi.fn(),
  escalateToHuman: vi.fn(async () => {}),
  notifyUnanswered: vi.fn(async () => {}),
  resolveMessagingPolicy: vi.fn(),
  inserts: [] as Record<string, unknown>[],
  contactUpdates: [] as Record<string, unknown>[],
}));

vi.mock("./conversation-orchestrator", () => ({ routeMessage: mocks.routeMessage }));
vi.mock("./messaging-policy-service", () => ({ resolveMessagingPolicy: mocks.resolveMessagingPolicy }));
vi.mock("./contact-broadcast-service", () => ({ detectBroadcastOptOut: (text: string) => /^\s*stop\s*$/i.test(text) }));
vi.mock("./handoff-service", async () => {
  const actual = await vi.importActual<typeof import("./handoff-service")>("./handoff-service");
  return { ...actual, escalateToHuman: mocks.escalateToHuman, notifyUnansweredInboundMessage: mocks.notifyUnanswered };
});
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.maybeSingle = vi.fn(async () => ({ data: table === "conversations" ? { contact_id: "contact-1" } : null }));
      builder.insert = vi.fn(async (row: Record<string, unknown>) => { mocks.inserts.push(row); return { error: null }; });
      builder.update = vi.fn((patch: Record<string, unknown>) => { if (table === "contacts") mocks.contactUpdates.push(patch); return builder; });
      builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
      return builder;
    },
  }),
}));

import { processInboundAutoReply, SEMI_AUTOMATIC_COURTESY_MESSAGE, BROADCAST_OPT_OUT_CONFIRMATION } from "./inbound-auto-reply-service";

const send = vi.fn(async () => {});
const base = { organizationId: "org-1", conversationId: "conv-1", content: "Bonjour", handoffStatus: "ai", handoffReason: null, contactFullName: "Awa", send };
const answer = (over: Record<string, unknown> = {}) => ({ intent: "faq", replyText: "Réponse FAQ", aiInvoked: false, handoffReason: null, replyImageUrl: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inserts.length = 0;
  mocks.contactUpdates.length = 0;
  mocks.resolveMessagingPolicy.mockResolvedValue({ mode: "automatic", allowAI: true });
  mocks.routeMessage.mockResolvedValue(answer());
});

describe("processInboundAutoReply", () => {
  it("automatique : FAQ/catalogue/IA autorisée, réponse envoyée et enregistrée (sender ai)", async () => {
    expect(await processInboundAutoReply(base)).toBe("replied");
    expect(mocks.routeMessage).toHaveBeenCalledWith("org-1", "conv-1", "Bonjour", { allowAI: true });
    expect(send).toHaveBeenCalledWith({ text: "Réponse FAQ", imageUrl: null });
    expect(mocks.inserts[0]).toMatchObject({ direction: "outbound", sender: "ai", content: "Réponse FAQ" });
  });

  it("semi-automatique (Discover) : jamais d'IA — allowAI=false transmis à l'orchestrateur", async () => {
    mocks.resolveMessagingPolicy.mockResolvedValue({ mode: "semi_automatic", allowAI: false });
    await processInboundAutoReply(base);
    expect(mocks.routeMessage).toHaveBeenCalledWith("org-1", "conv-1", "Bonjour", { allowAI: false });
  });

  it("semi-automatique sans correspondance : escalade « semi_automatic » + accusé de réception poli", async () => {
    mocks.resolveMessagingPolicy.mockResolvedValue({ mode: "semi_automatic", allowAI: false });
    mocks.routeMessage.mockResolvedValue(answer({ intent: "human_escalation", replyText: null }));
    expect(await processInboundAutoReply(base)).toBe("escalated");
    expect(mocks.escalateToHuman).toHaveBeenCalledWith("org-1", "conv-1", "semi_automatic");
    expect(send).toHaveBeenCalledWith({ text: SEMI_AUTOMATIC_COURTESY_MESSAGE });
    expect(mocks.notifyUnanswered).not.toHaveBeenCalled();
  });

  it("déjà escaladé en semi-automatique (deterministic_only) : pas de nouvelle escalade, le commerçant est notifié", async () => {
    mocks.resolveMessagingPolicy.mockResolvedValue({ mode: "semi_automatic", allowAI: false });
    mocks.routeMessage.mockResolvedValue(answer({ intent: "human_escalation", replyText: null }));
    expect(await processInboundAutoReply({ ...base, handoffStatus: "pending_human", handoffReason: "semi_automatic" })).toBe("unanswered");
    expect(mocks.escalateToHuman).not.toHaveBeenCalled();
    expect(mocks.notifyUnanswered).toHaveBeenCalledTimes(1);
  });

  it("plainte détectée : escalade avec la raison de l'orchestrateur", async () => {
    mocks.routeMessage.mockResolvedValue(answer({ replyText: null, handoffReason: "complaint" }));
    expect(await processInboundAutoReply(base)).toBe("escalated");
    expect(mocks.escalateToHuman).toHaveBeenCalledWith("org-1", "conv-1", "complaint");
  });

  it("prise en charge humaine ou offre sans messagerie : aucune réponse automatique, message notifié", async () => {
    expect(await processInboundAutoReply({ ...base, handoffStatus: "human" })).toBe("unanswered");
    mocks.resolveMessagingPolicy.mockResolvedValue({ mode: "off", allowAI: false });
    expect(await processInboundAutoReply(base)).toBe("unanswered");
    expect(mocks.routeMessage).not.toHaveBeenCalled();
    expect(mocks.notifyUnanswered).toHaveBeenCalledTimes(2);
  });

  it("réponses désactivées sur ce compte (autoReplyAllowed=false) : notifié, orchestrateur jamais appelé", async () => {
    expect(await processInboundAutoReply({ ...base, autoReplyAllowed: false })).toBe("unanswered");
    expect(mocks.routeMessage).not.toHaveBeenCalled();
  });

  it("« STOP » : désinscription des diffusions + confirmation, sans passer par l'orchestrateur", async () => {
    expect(await processInboundAutoReply({ ...base, content: "STOP" })).toBe("replied");
    expect(mocks.contactUpdates[0]).toMatchObject({ broadcast_opt_out: true });
    expect(send).toHaveBeenCalledWith({ text: BROADCAST_OPT_OUT_CONFIRMATION });
    expect(mocks.routeMessage).not.toHaveBeenCalled();
  });
});
