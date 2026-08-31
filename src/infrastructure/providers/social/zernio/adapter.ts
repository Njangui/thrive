import { randomUUID } from "node:crypto";
import type {
  CreateSocialPostRequest,
  SocialAnalyticsEntry,
  SocialAnalyticsQuery,
  SocialPostStatus,
  SocialPostResult,
  SocialPublishingProvider,
} from "@/domain/ports/social-publishing-provider";
import { ZernioSocialClient } from "./client";

export class ZernioSocialAdapter implements SocialPublishingProvider {
  readonly providerName = "zernio";

  constructor(private readonly client: ZernioSocialClient) {}

  async createPost(
    request: Omit<CreateSocialPostRequest, "scheduledFor" | "publishNow">,
  ): Promise<SocialPostResult> {
    const response = await this.client.createPost(
      {
        content: request.content,
        mediaItems: request.mediaUrls?.map((url) => ({ type: guessMediaType(url), url })),
        platforms: request.targets.map((t) => ({ platform: t.platform, accountId: t.accountId })),
        // Ni scheduledFor ni publishNow => brouillon (comportement confirmé).
      },
      randomUUID(),
    );
    return { providerPostId: response.post._id, status: response.post.status };
  }

  async schedulePost(request: CreateSocialPostRequest & { scheduledFor: string }): Promise<SocialPostResult> {
    const response = await this.client.createPost(
      {
        content: request.content,
        mediaItems: request.mediaUrls?.map((url) => ({ type: guessMediaType(url), url })),
        platforms: request.targets.map((t) => ({ platform: t.platform, accountId: t.accountId })),
        scheduledFor: request.scheduledFor,
        timezone: request.timezone ?? "Africa/Douala",
      },
      // Section 29 : réutiliser une clé stable par (produit, campagne) côté
      // appelant permettrait un retry sûr — ici on génère une clé par appel,
      // ce qui protège au minimum contre les doubles clics/doubles requêtes
      // réseau immédiates.
      randomUUID(),
    );
    return { providerPostId: response.post._id, status: response.post.status };
  }

  async publishPost(request: CreateSocialPostRequest): Promise<SocialPostResult> {
    const response = await this.client.createPost(
      {
        content: request.content,
        mediaItems: request.mediaUrls?.map((url) => ({ type: guessMediaType(url), url })),
        platforms: request.targets.map((t) => ({ platform: t.platform, accountId: t.accountId })),
        publishNow: true,
      },
      randomUUID(),
    );
    return { providerPostId: response.post._id, status: response.post.status };
  }

  async getPostStatus(providerPostId: string): Promise<SocialPostStatus> {
    const response = await this.client.getPost(providerPostId);
    return {
      providerPostId: response.post._id,
      status: response.post.status,
      targets: (response.post.platformResults ?? []).map((r) => ({
        platform: r.platform,
        accountId: r.accountId,
        status: r.status,
        platformPostUrl: r.platformPostUrl,
        error: r.error,
      })),
    };
  }

  /**
   * CONFIRMÉ (docs.zernio.com, page Discord "Edit & Delete" — endpoint
   * générique de l'API Posts) : `DELETE /posts/{postId}` supprime un
   * brouillon ou annule un post programmé. Un post déjà publié ne peut pas
   * être supprimé par cette route (l'historique est préservé, section
   * 10/52 doc 2) — Zernio renverra une erreur dans ce cas, remontée telle
   * quelle à l'appelant.
   */
  async cancelPost(providerPostId: string): Promise<void> {
    await this.client.deletePost(providerPostId);
  }

  async getAnalytics(query: SocialAnalyticsQuery): Promise<SocialAnalyticsEntry[]> {
    const response = await this.client.getAnalytics(query.sortBy ?? "recent", query.limit ?? 20);
    return response.posts.map((entry) => ({
      providerPostId: entry.postId,
      platform: entry.platform,
      views: entry.views,
      likes: entry.likes,
      comments: entry.comments,
      shares: entry.shares,
      clicks: entry.clicks,
    }));
  }
}

function guessMediaType(url: string): "image" | "video" {
  return /\.(mp4|mov|webm)(\?.*)?$/i.test(url) ? "video" : "image";
}
