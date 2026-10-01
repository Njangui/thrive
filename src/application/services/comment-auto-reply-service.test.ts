import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  routeMessage: vi.fn(),
  hasFeature: vi.fn(),
  resolveMessagingPolicy: vi.fn(),
  getSocialAccountByAccountId: vi.fn(),
  markSocialAccountNeedsReconnect: vi.fn(async () => {}),
  notifyOrgAdmins: vi.fn(async () => {}),
  replyToComment: vi.fn(async () => {}),
  updates: [] as Record<string, unknown>[],
  counts: { account: 0, author: 0 },
  lastAuthorColumn: null as string | null,
}));

vi.mock("./conversation-orchestrator", () => ({ routeMessage: mocks.routeMessage }));
vi.mock("./entitlements-service", () => ({ hasFeature: mocks.hasFeature }));
vi.mock("./messaging-policy-service", () => ({ resolveMessagingPolicy: mocks.resolveMessagingPolicy }));
vi.mock("./social-account-registry-service", () => ({
  getSocialAccountByAccountId: mocks.getSocialAccountByAccountId,
  markSocialAccountNeedsReconnect: mocks.markSocialAccountNeedsReconnect,
}));
vi.mock("./notification-service", () => ({ notifyOrgAdmins: mocks.notifyOrgAdmins }));
vi.mock("@/infrastructure/providers/registry", () => ({
  getSocialPublishingProvider: vi.fn(async () => ({ replyToComment: mocks.replyToComment })),
}));
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    from: () => {
      const builder: Record<string, unknown> = {};
      let isCount = false;
      let isAuthorQuery = false;
      builder.select = vi.fn((_c?: string, opts?: { head?: boolean }) => { isCount = Boolean(opts?.head); return builder; });
      builder.eq = vi.fn((column: string) => {
        if (column === "author_name" || column === "author_external_id") {
          isAuthorQuery = true;
          mocks.lastAuthorColumn = column;
        }
        return builder;
      });
      builder.gte = vi.fn(() => builder);
      builder.update = vi.fn((patch: Record<string, unknown>) => { mocks.updates.push(patch); return builder; });
      builder.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(isCount ? { count: isAuthorQuery ? mocks.counts.author : mocks.counts.account, error: null } : { error: null }).then(resolve);
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
  mocks.lastAuthorColumn = null;
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

  it("détecte un commentaire du compte lui-même par id ou pseudo (@ ignoré) quand Zernio n'envoie pas isOwnAccount", () => {
    expect(isOwnComment({ authorExternalId: "acc-1" }, { accountId: "acc-1", username: null })).toBe(true);
    expect(isOwnComment({ authorName: "@Boutique" }, { accountId: "acc-1", username: "boutique" })).toBe(true);
    expect(isOwnComment({ authorName: "Awa" }, { accountId: "acc-1", username: "boutique" })).toBe(false);
  });

  it("isOwnAccount de Zernio, quand PRÉSENT, tranche directement — même s'il contredit l'id/le pseudo", () => {
    expect(isOwnComment({ authorExternalId: "acc-1", isOwnAccount: false }, { accountId: "acc-1", username: null })).toBe(false);
    expect(isOwnComment({ authorName: "Awa", isOwnAccount: true }, { accountId: "acc-1", username: "boutique" })).toBe(true);
  });
});

describe("processCommentAutoReply", () => {
  it("plateforme sans réseau de commentaires (ex: linkedin) : ignorée, aucun appel", async () => {
    expect(await processCommentAutoReply({ ...baseInput, platform: "linkedin" })).toBe("skipped");
    expect(mocks.routeMessage).not.toHaveBeenCalled();
  });

  it("TikTok : suit l'entitlement du plan comme les autres réseaux (Pro l'active, un plan sans l'activer l'ignore)", async () => {
    expect(await processCommentAutoReply({ ...baseInput, platform: "tiktok" })).toBe("replied");
    mocks.hasFeature.mockResolvedValue(false);
    expect(await processCommentAutoReply({ ...baseInput, platform: "tiktok" })).toBe("skipped");
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

  it("anti-spam par auteur : utilise l'identifiant plateforme quand il est fourni, pas le pseudo", async () => {
    await processCommentAutoReply(baseInput);
    expect(mocks.lastAuthorColumn).toBe("author_external_id");
  });

  it("anti-spam par auteur : retombe sur le pseudo si aucun identifiant n'est fourni (cas TikTok possible)", async () => {
    await processCommentAutoReply({ ...baseInput, authorExternalId: null });
    expect(mocks.lastAuthorColumn).toBe("author_name");
  });

  it("échec d'envoi : commentaire marqué à traiter avec l'erreur, jamais silencieux", async () => {
    mocks.replyToComment.mockRejectedValueOnce(new Error("Zernio indisponible"));
    expect(await processCommentAutoReply(baseInput)).toBe("failed");
    expect(mocks.updates.at(-1)).toMatchObject({ needs_human: true, auto_reply_error: "Zernio indisponible" });
    expect(mocks.markSocialAccountNeedsReconnect).not.toHaveBeenCalled();
  });

  it("TikTok, erreur de permission (403/forbidden/…) : compte marqué à reconnecter, admin notifié", async () => {
    mocks.replyToComment.mockRejectedValueOnce(new Error("TikTok API error: 403 Forbidden — not supported for this account"));
    expect(await processCommentAutoReply({ ...baseInput, platform: "tiktok" })).toBe("failed");
    expect(mocks.markSocialAccountNeedsReconnect).toHaveBeenCalledWith("acc-1", true);
    expect(mocks.notifyOrgAdmins).toHaveBeenCalledTimes(1);
  });

  it("TikTok, erreur passagère (réseau, timeout) : PAS de reconnexion forcée", async () => {
    mocks.replyToComment.mockRejectedValueOnce(new Error("fetch failed: network timeout"));
    expect(await processCommentAutoReply({ ...baseInput, platform: "tiktok" })).toBe("failed");
    expect(mocks.markSocialAccountNeedsReconnect).not.toHaveBeenCalled();
  });

  it("erreur de permission sur un AUTRE réseau que TikTok : pas de reconnexion (comportement non vérifié pour ces réseaux)", async () => {
    mocks.replyToComment.mockRejectedValueOnce(new Error("403 Forbidden"));
    expect(await processCommentAutoReply({ ...baseInput, platform: "facebook" })).toBe("failed");
    expect(mocks.markSocialAccountNeedsReconnect).not.toHaveBeenCalled();
  });
});
