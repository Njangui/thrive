import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

const mockGetSocialPublishingProvider = vi.fn();
const mockGetAIProvider = vi.fn();
vi.mock("@/infrastructure/providers/registry", () => ({
  getSocialPublishingProvider: (...args: unknown[]) => mockGetSocialPublishingProvider(...args),
  getAIProvider: (...args: unknown[]) => mockGetAIProvider(...args),
}));

const mockHasCreditsAvailable = vi.fn();
const mockConsumeCredit = vi.fn();
vi.mock("./ai-credits-service", () => ({
  hasCreditsAvailable: (...args: unknown[]) => mockHasCreditsAvailable(...args),
  consumeCredit: (...args: unknown[]) => mockConsumeCredit(...args),
}));

import {
  syncCommentsForPost,
  replyToComment,
  hideComment,
  unhideComment,
  draftCommentReplySuggestion,
} from "./social-comment-service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("syncCommentsForPost", () => {
  it("lève NotFoundError si la publication n'existe pas pour cette organisation", async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
    });

    await expect(syncCommentsForPost("org-1", "post-missing")).rejects.toThrow(/introuvable/);
  });

  it("ne synchronise rien (sans erreur) pour un post sans provider_post_id (brouillon)", async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "post-1", provider_post_id: null, status: "draft" }, error: null }) }) }),
      }),
    });

    const result = await syncCommentsForPost("org-1", "post-1");
    expect(result).toEqual({ syncedCount: 0 });
    expect(mockGetSocialPublishingProvider).not.toHaveBeenCalled();
  });

  it("récupère les commentaires par cible publiée et les upsert", async () => {
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "social_posts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { id: "post-1", provider_post_id: "zid-1", status: "published" }, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "social_post_targets") {
        return {
          select: () => ({
            eq: () => ({
              eq: () =>
                Promise.resolve({
                  data: [{ platform: "facebook", provider_account_id: "acc-1" }],
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "social_comments") {
        return { upsert };
      }
      throw new Error(`table inattendue: ${table}`);
    });

    mockGetSocialPublishingProvider.mockResolvedValue({
      listComments: vi.fn().mockResolvedValue([
        { id: "c1", authorName: "Awa", content: "Super produit !", createdAt: null, canReply: true, canHide: true },
      ]),
    });

    const result = await syncCommentsForPost("org-1", "post-1");

    expect(result).toEqual({ syncedCount: 1 });
    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          organization_id: "org-1",
          social_post_id: "post-1",
          platform: "facebook",
          provider_account_id: "acc-1",
          external_comment_id: "c1",
          content: "Super produit !",
        }),
      ],
      { onConflict: "social_post_id,provider_account_id,external_comment_id", ignoreDuplicates: true },
    );
  });
});

describe("replyToComment", () => {
  function mockCommentFetch(comment: unknown) {
    mockFrom.mockImplementation((table: string) => {
      if (table === "social_comments") {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: comment, error: null }) }) }),
          }),
          update: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }),
        };
      }
      throw new Error(`table inattendue: ${table}`);
    });
  }

  it("lève NotFoundError si le commentaire n'existe pas", async () => {
    mockCommentFetch(null);
    await expect(replyToComment("org-1", "missing", "Merci !")).rejects.toThrow(/introuvable/);
  });

  it("rejette une réponse vide sans appeler le provider", async () => {
    await expect(replyToComment("org-1", "c1", "   ")).rejects.toThrow(/vide/);
    expect(mockGetSocialPublishingProvider).not.toHaveBeenCalled();
  });

  it("envoie la réponse via le provider AVANT de marquer le commentaire comme répondu", async () => {
    mockCommentFetch({
      id: "c1",
      provider_account_id: "acc-1",
      external_comment_id: "ext-1",
      social_posts: { provider_post_id: "zid-1" },
    });
    const replyToCommentMock = vi.fn().mockResolvedValue(undefined);
    mockGetSocialPublishingProvider.mockResolvedValue({ replyToComment: replyToCommentMock });

    await replyToComment("org-1", "c1", "Merci beaucoup !");

    expect(replyToCommentMock).toHaveBeenCalledWith("zid-1", "acc-1", "ext-1", "Merci beaucoup !");
  });

  it("ne marque jamais le commentaire comme répondu si l'envoi vers la plateforme échoue", async () => {
    mockCommentFetch({
      id: "c1",
      provider_account_id: "acc-1",
      external_comment_id: "ext-1",
      social_posts: { provider_post_id: "zid-1" },
    });
    mockGetSocialPublishingProvider.mockResolvedValue({
      replyToComment: vi.fn().mockRejectedValue(new Error("Zernio indisponible")),
    });

    await expect(replyToComment("org-1", "c1", "Merci !")).rejects.toThrow(/Zernio indisponible/);
  });
});

describe("hideComment / unhideComment", () => {
  function mockCommentFetch(comment: unknown, updateSpy: (payload: { status: string }) => { eq: () => { eq: (...args: unknown[]) => unknown } }) {
    mockFrom.mockImplementation((table: string) => {
      if (table === "social_comments") {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: comment, error: null }) }) }),
          }),
          update: updateSpy,
        };
      }
      throw new Error(`table inattendue: ${table}`);
    });
  }

  it("masque un commentaire 'new' et son statut devient 'hidden'", async () => {
    const eq2 = vi.fn().mockResolvedValue({ data: null, error: null });
    const updateSpy = vi.fn(() => ({ eq: () => ({ eq: eq2 }) }));
    mockCommentFetch(
      { id: "c1", provider_account_id: "acc-1", external_comment_id: "ext-1", status: "new", social_posts: { provider_post_id: "zid-1" } },
      updateSpy,
    );
    const hideCommentMock = vi.fn().mockResolvedValue(undefined);
    mockGetSocialPublishingProvider.mockResolvedValue({ hideComment: hideCommentMock });

    await hideComment("org-1", "c1");

    expect(hideCommentMock).toHaveBeenCalledWith("zid-1", "acc-1", "ext-1");
    expect(updateSpy).toHaveBeenCalledWith({ status: "hidden" });
  });

  it("conserve le statut 'replied' quand on masque un commentaire déjà répondu", async () => {
    const eq2 = vi.fn().mockResolvedValue({ data: null, error: null });
    const updateSpy = vi.fn(() => ({ eq: () => ({ eq: eq2 }) }));
    mockCommentFetch(
      { id: "c1", provider_account_id: "acc-1", external_comment_id: "ext-1", status: "replied", social_posts: { provider_post_id: "zid-1" } },
      updateSpy,
    );
    mockGetSocialPublishingProvider.mockResolvedValue({ hideComment: vi.fn().mockResolvedValue(undefined) });

    await hideComment("org-1", "c1");

    expect(updateSpy).toHaveBeenCalledWith({ status: "replied" });
  });

  it("démasquer ramène toujours le statut à 'new'", async () => {
    const eq2 = vi.fn().mockResolvedValue({ data: null, error: null });
    const updateSpy = vi.fn(() => ({ eq: () => ({ eq: eq2 }) }));
    mockCommentFetch(
      { id: "c1", provider_account_id: "acc-1", external_comment_id: "ext-1", status: "hidden", social_posts: { provider_post_id: "zid-1" } },
      updateSpy,
    );
    mockGetSocialPublishingProvider.mockResolvedValue({ unhideComment: vi.fn().mockResolvedValue(undefined) });

    await unhideComment("org-1", "c1");

    expect(updateSpy).toHaveBeenCalledWith({ status: "new" });
  });
});

describe("draftCommentReplySuggestion", () => {
  it("retourne null sans lever si les crédits IA sont épuisés", async () => {
    mockHasCreditsAvailable.mockResolvedValue(false);

    const result = await draftCommentReplySuggestion("org-1", "Quels sont vos horaires ?");
    expect(result).toBeNull();
    expect(mockGetAIProvider).not.toHaveBeenCalled();
  });

  it("retourne le texte généré et consomme un crédit en cas de succès", async () => {
    mockHasCreditsAvailable.mockResolvedValue(true);
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: "Boutique Awa" }, error: null }) }) }),
    });
    mockGetAIProvider.mockResolvedValue({
      primary: { generateText: vi.fn().mockResolvedValue({ text: "Merci pour votre message !", provider: "mistral", model: "m" }) },
    });
    mockConsumeCredit.mockResolvedValue(undefined);

    const result = await draftCommentReplySuggestion("org-1", "Super produit");

    expect(result).toBe("Merci pour votre message !");
    expect(mockConsumeCredit).toHaveBeenCalledWith("org-1", 1, "social_comment_draft");
  });

  it("ne lève jamais et retourne null si le fournisseur IA échoue — jamais bloquant pour la réponse manuelle", async () => {
    mockHasCreditsAvailable.mockResolvedValue(true);
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: "Boutique Awa" }, error: null }) }) }),
    });
    mockGetAIProvider.mockRejectedValue(new Error("IA non configurée"));

    const result = await draftCommentReplySuggestion("org-1", "Super produit");
    expect(result).toBeNull();
  });
});
