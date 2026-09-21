import { describe, it, expect, vi } from "vitest";
import type { SocialPublishingProvider } from "@/domain/ports/social-publishing-provider";
import { YouTubeMultiAccountAdapter } from "./multi-adapter";

function fakeAdapter(videoId: string): SocialPublishingProvider {
  return {
    providerName: "youtube",
    createPost: vi.fn(async () => ({ providerPostId: videoId, status: "draft" })),
    schedulePost: vi.fn(async () => ({ providerPostId: videoId, status: "scheduled" })),
    publishPost: vi.fn(async () => ({ providerPostId: videoId, status: "published" })),
    getPostStatus: vi.fn(async (id: string) => {
      if (id !== videoId) throw new Error("introuvable");
      return { providerPostId: id, status: "published", targets: [{ platform: "youtube", accountId: "x", status: "published" }] };
    }),
    cancelPost: vi.fn(async (id: string) => { if (id !== videoId) throw new Error("introuvable"); }),
    getAnalytics: vi.fn(async () => []),
    getDailyMetrics: vi.fn(async () => []),
    listAccounts: vi.fn(async () => []),
    listComments: vi.fn(async () => []),
    replyToComment: vi.fn(async () => {}),
    hideComment: vi.fn(async () => {}),
    unhideComment: vi.fn(async () => {}),
  } as unknown as SocialPublishingProvider;
}

const build = () => {
  const a = fakeAdapter("vid-A");
  const b = fakeAdapter("vid-B");
  const multi = new YouTubeMultiAccountAdapter([
    { account: { accountId: "chan-A", platform: "youtube", username: "A" }, adapter: a },
    { account: { accountId: "chan-B", platform: "youtube", username: "B" }, adapter: b },
  ]);
  return { a, b, multi };
};

describe("YouTubeMultiAccountAdapter", () => {
  it("une seule chaîne ciblée : id vidéo brut (rétrocompatible), seul CE compte est appelé", async () => {
    const { a, b, multi } = build();
    const result = await multi.publishPost({ content: "x", targets: [{ platform: "youtube", accountId: "chan-B" }] });
    expect(result.providerPostId).toBe("vid-B");
    expect(b.publishPost).toHaveBeenCalledTimes(1);
    expect(a.publishPost).not.toHaveBeenCalled();
  });

  it("deux chaînes : un appel par chaîne, id composite décodable, statut agrégé", async () => {
    const { a, b, multi } = build();
    const result = await multi.publishPost({ content: "x", targets: [{ platform: "youtube", accountId: "chan-A" }, { platform: "youtube", accountId: "chan-B" }] });
    expect(result.providerPostId.startsWith("ytm:")).toBe(true);
    expect(a.publishPost).toHaveBeenCalledTimes(1);
    expect(b.publishPost).toHaveBeenCalledTimes(1);
    const status = await multi.getPostStatus(result.providerPostId);
    expect(status.status).toBe("published");
    expect(status.targets).toHaveLength(2);
  });

  it("id vidéo brut : retrouve la bonne chaîne en essayant chaque compte", async () => {
    const { multi } = build();
    const status = await multi.getPostStatus("vid-B");
    expect(status.status).toBe("published");
    await expect(multi.getPostStatus("vid-inconnue")).rejects.toThrow();
  });

  it("refuse une chaîne non connectée (jamais d'appel silencieux vers un autre compte)", async () => {
    const { multi } = build();
    await expect(multi.publishPost({ content: "x", targets: [{ platform: "youtube", accountId: "chan-Z" }] })).rejects.toThrow(/n'est pas connectée/);
  });
});
