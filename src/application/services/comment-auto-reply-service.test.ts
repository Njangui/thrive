import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  routeMessage: vi.fn(),
  hasFeature: vi.fn(),
  resolveMessagingPolicy: vi.fn(),
  getSocialAccountByAccountId: vi.fn(),
  notifyOrgAdmins: vi.fn(async () => {}),
  replyToComment: vi.fn(async () => {}),
  updates: [] as Record<string, unknown>[],
  counts: { account: 0, author: 0 },
}));

vi.mock("./conversation-orchestrator", () => ({ routeMessage: mocks.routeMessage }));
vi.mock("./entitlements-service", () => ({ hasFeature: mocks.hasFeature }));
vi.mock("./messaging-policy-service", () => ({ resolveMessagingPolicy: mocks.resolveMessagingPolicy }));
vi.mock("./social-account-registry-service", () => ({ getSocialAccountByAccountId: mocks.getSocialAccountByAccountId }));
vi.mock("./notification-service", () => ({ notifyOrgAdmins: mocks.notifyOrgAdmins }));
vi.mock("@/infrastructure/providers/registry", () => ({
  getSocialPublishingProvider: vi.fn(async () => ({ replyToComment: mocks.replyToComment })),
}));
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    from: () => {
      const builder: Record<string, unknown> = {};
      let isCount = false;
      builder.select = vi.fn((_c?: string, opts?: { head?: boolean }) => { isCount = Boolean(opts?.head); return builder; });
      builder.eq = vi.fn((column: string) => { if (column === "author_name") (builder as { _author?: boolean })._author = true; return builder; });
      builder.gte = vi.fn(() => builder);
      builder.update = vi.fn((patch: Record<string, unknown>) => { mocks.updates.push(patch); return builder; });
      builder.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(isCount ? { count: (builder as { _author?: boolean })._author ? mocks.counts.author : mocks.counts.account, error: null } : { error: null }).then(resolve);
      return builder;
    },
  }),
}));

import { clampPublicReply, isOwnComment, processCommentAutoReply, MAX_PUBLIC_REPLY_LENGTH } from "./comment-auto-reply-service";

const baseInput = {
  organizationId: "org-1",
  commentId: "c-1",
  platform: "facebook",
  accountId: "acc-1",
  providerPostId: "post-1",
  externalCommentId: "ext-1",
  authorExternalId: "user-9",
  authorName: "Awa",
  content: "Quel est le prix ?",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updates.length = 0;
  mocks.counts.account = 0;
  mocks.counts.author = 0;
  mocks.hasFeature.mockResolvedValue(true);
  mocks.resolveMessagingPolicy.mockResolvedValue({ mode: "automatic", allowAI: true });
  mocks.getSocialAccountByAccountId.mockResolvedValue({ organizationId: "org-1", accountId: "acc-1", username: "boutique", status: "connected", autoReplyComments: true });
  mocks.routeMessage.mockResolvedValue({ intent: "faq", replyText: "Le prix est de 5 000 FCFA.", aiInvoked: false, handoffReason: null, replyImageUrl: null });
});

describe("clampPublicReply / isOwnComment (purs)", () => {
  it("tronque sur une frontière de mot avec une ellipse", () => {
    const long = "mot ".repeat(400);
    const out = clampPublicReply(long);
    expect(out.length).toBeLessThanOrEqual(MAX_PUBLIC_REPLY_LENGTH);
    expect(out.endsWith("…")).toBe(true);
  });
  it("détecte un commentaire du compte lui-même (id ou nom, @ ignoré)", () => {
    expect(isOwnComment({ authorExternalId: "acc-1" }, { accountId: "acc-1", username: null })).toBe(true);
    expect(isOwnComment({ authorName: "@Boutique" }, { accountId: "acc-1", username: "boutique" })).toBe(true);
    expect(isOwnComment({ authorName: "Awa" }, { accountId: "acc-1", username: "boutique" })).toBe(false);
  });
});

describe("processCommentAutoReply", () => {
  it("TikTok (0 partout) et plateformes inconnues : ignorés, aucun appel IA/orchestrateur", async () => {
    expect(await processCommentAutoReply({ ...baseInput, platform: "linkedin" })).toBe("skipped");
    mocks.hasFeature.mockResolvedValue(false);
    expect(await processCommentAutoReply({ ...baseInput, platform: "tiktok" })).toBe("skipped");
    expect(mocks.routeMessage).not.toHaveBeenCalled();
  });

  it("répond via l'orchestrateur SANS conversation (null) et publie la réponse", async () => {
    expect(await processCommentAutoReply(baseInput)).toBe("replied");
    expect(mocks.routeMessage).toHaveBeenCalledWith("org-1", null, "Quel est le prix ?", { allowAI: true });
    expect(mocks.replyToComment).toHaveBeenCalledWith("post-1", "acc-1", "ext-1", "Le prix est de 5 000 FCFA.");
    expect(mocks.updates[0]).toMatchObject({ status: "replied", reply_sender: "ai", auto_reply_intent: "faq", needs_human: false });
  });

  it("compte désactivé par le commerçant (auto_reply_comments=false) : ignoré", async () => {
    mocks.getSocialAccountByAccountId.mockResolvedValue({ organizationId: "org-1", accountId: "acc-1", username: null, status: "connected", autoReplyComments: false });
    expect(await processCommentAutoReply(baseInput)).toBe("skipped");
    expect(mocks.routeMessage).not.toHaveBeenCalled();
  });

  it("compte d'une AUTRE organisation : ignoré (isolation multi-tenant)", async () => {
    mocks.getSocialAccountByAccountId.mockResolvedValue({ organizationId: "org-2", accountId: "acc-1", username: null, status: "connected", autoReplyComments: true });
    expect(await processCommentAutoReply(baseInput)).toBe("skipped");
  });

  it("son propre commentaire : marqué is_own, jamais de réponse (anti-boucle)", async () => {
    expect(await processCommentAutoReply({ ...baseInput, authorExternalId: "acc-1" })).toBe("skipped");
    expect(mocks.updates[0]).toEqual({ is_own: true });
    expect(mocks.replyToComment).not.toHaveBeenCalled();
  });

  it("plainte/remboursement : aucune réponse publique, escalade + notification", async () => {
    mocks.routeMessage.mockResolvedValue({ intent: "human_escalation", replyText: null, aiInvoked: false, handoffReason: "complaint", replyImageUrl: null });
    expect(await processCommentAutoReply(baseInput)).toBe("escalated");
    expect(mocks.replyToComment).not.toHaveBeenCalled();
    expect(mocks.updates[0]).toMatchObject({ needs_human: true, handoff_reason: "complaint" });
    expect(mocks.notifyOrgAdmins).toHaveBeenCalledTimes(1);
  });

  it("semi-automatique sans correspondance : escalade « semi_automatic », jamais d'IA", async () => {
    mocks.resolveMessagingPolicy.mockResolvedValue({ mode: "semi_automatic", allowAI: false });
    mocks.routeMessage.mockResolvedValue({ intent: "human_escalation", replyText: null, aiInvoked: false, handoffReason: null, replyImageUrl: null });
    expect(await processCommentAutoReply(baseInput)).toBe("escalated");
    expect(mocks.routeMessage).toHaveBeenCalledWith("org-1", null, expect.any(String), { allowAI: false });
    expect(mocks.updates[0]).toMatchObject({ needs_human: true, handoff_reason: "semi_automatic" });
  });

  it("plafond anti-spam par compte atteint : aucun appel coûteux", async () => {
    mocks.counts.account = 30;
    expect(await processCommentAutoReply(baseInput)).toBe("skipped");
    expect(mocks.routeMessage).not.toHaveBeenCalled();
  });

  it("échec d'envoi : commentaire marqué à traiter avec l'erreur, jamais silencieux", async () => {
    mocks.replyToComment.mockRejectedValueOnce(new Error("Zernio indisponible"));
    expect(await processCommentAutoReply(baseInput)).toBe("failed");
    expect(mocks.updates.at(-1)).toMatchObject({ needs_human: true, auto_reply_error: "Zernio indisponible" });
  });
});
