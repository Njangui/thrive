import { randomUUID } from "node:crypto";
import type {
  CreateSocialPostRequest,
  SocialAnalyticsEntry,
  SocialDailyMetric,
  SocialAnalyticsQuery,
  SocialPostStatus,
  SocialPostResult,
  SocialPublishingProvider,
  SocialComment,
  SocialAccountSummary,
} from "@/domain/ports/social-publishing-provider";
import { ZernioSocialClient } from "./client";

export class ZernioSocialAdapter implements SocialPublishingProvider {
  readonly providerName = "zernio";

  /**
   * `profileId` optionnel (contrairement à ZernioAdapter côté messaging,
   * qui l'exige) : voir registry.ts::getSocialPublishingProvider pour le
   * raisonnement — tous les tenants n'ont pas encore ce champ peuplé côté
   * social, et le dégrader en simple perte de précision de comptage
   * (plutôt qu'un blocage dur) est le choix le moins risqué pour ne
   * jamais casser une publication déjà fonctionnelle (voir
   * RAPPORT_LOT_3.md, section "Risques production" pour l'impact exact).
   */
  private readonly profileIds: readonly string[];

  /**
   * Lot O : un ou PLUSIEURS profils Zernio (profil principal + profils
   * additionnels, un compte TikTok par profil). Aucun profil = liste vide —
   * jamais `listAccounts()` sans filtre, qui remonterait les comptes de
   * TOUS les tenants de la clé API partagée.
   */
  constructor(
    private readonly client: ZernioSocialClient,
    profileId?: string | readonly string[],
  ) {
    this.profileIds = profileId === undefined ? [] : typeof profileId === "string" ? [profileId] : [...profileId];
  }

  async createPost(
    request: Omit<CreateSocialPostRequest, "scheduledFor" | "publishNow">,
  ): Promise<SocialPostResult> {
    const response = await this.client.createPost(
      {
        content: request.content,
        mediaItems: request.mediaUrls?.map((url) => ({ type: guessMediaType(url), url })),
        platforms: request.targets.map((t) => ({ platform: t.platform, accountId: t.accountId })),
        ...firstCommentField(request),
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
        ...firstCommentField(request),
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
        ...firstCommentField(request),
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

  async getDailyMetrics(fromDate: string, toDate: string): Promise<SocialDailyMetric[]> {
    if (this.profileIds.length === 0) return [];
    const perProfile = await Promise.all(this.profileIds.map((profileId) => this.client.getDailyMetrics(profileId, fromDate, toDate)));
    return mergeDailyMetrics(perProfile.map((response) => this.mapDailyMetrics(response.dailyData ?? [])));
  }

  private mapDailyMetrics(dailyData: NonNullable<Awaited<ReturnType<ZernioSocialClient["getDailyMetrics"]>>["dailyData"]>): SocialDailyMetric[] {
    return dailyData.map((day) => ({
      date: day.date,
      postCount: day.postCount ?? 0,
      platforms: day.platforms ?? {},
      metrics: {
        impressions: day.metrics?.impressions ?? 0,
        reach: day.metrics?.reach ?? 0,
        likes: day.metrics?.likes ?? 0,
        comments: day.metrics?.comments ?? 0,
        shares: day.metrics?.shares ?? 0,
        saves: day.metrics?.saves ?? 0,
        clicks: day.metrics?.clicks ?? 0,
        views: day.metrics?.views ?? 0,
        follows: day.metrics?.follows ?? 0,
      },
    }));
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

  async listComments(providerPostId: string, accountId: string): Promise<SocialComment[]> {
    const response = await this.client.listInboxComments(providerPostId, accountId);
    return (response.comments ?? []).map((c) => ({
      id: c.id,
      authorName: c.from?.name ?? c.from?.username ?? null,
      content: c.message,
      createdAt: c.createdTime ?? null,
      // Absence explicite -> true par défaut (comportement historique de la
      // plupart des plateformes avant l'introduction de ces flags par
      // Zernio) plutôt que de masquer silencieusement une action possible.
      canReply: c.canReply ?? true,
      canHide: c.canHide ?? false,
    }));
  }

  async replyToComment(providerPostId: string, accountId: string, commentId: string, message: string): Promise<void> {
    await this.client.replyToInboxComment(providerPostId, accountId, commentId, message);
  }

  async hideComment(providerPostId: string, accountId: string, commentId: string): Promise<void> {
    await this.client.hideInboxComment(providerPostId, accountId, commentId);
  }

  async unhideComment(providerPostId: string, accountId: string, commentId: string): Promise<void> {
    await this.client.unhideInboxComment(providerPostId, accountId, commentId);
  }

  async listAccounts(): Promise<SocialAccountSummary[]> {
    if (this.profileIds.length === 0) return [];
    const responses = await Promise.all(this.profileIds.map((profileId) => this.client.listAccounts(profileId)));
    return responses.flatMap((response) =>
      response.accounts.map((a) => ({
        accountId: a._id,
        platform: a.platform,
        username: a.username ?? null,
      })),
    );
  }

  async postTopLevelComment(providerPostId: string, accountId: string, message: string): Promise<{ commentId?: string }> {
    return this.client.postTopLevelInboxComment(providerPostId, accountId, message);
  }

  async pinComment(providerPostId: string, accountId: string, commentId: string): Promise<void> {
    await this.client.pinInboxComment(providerPostId, accountId, commentId);
  }
}

/** Plateformes où Zernio publie lui-même le `firstComment` (docs.zernio.com — YouTube, LinkedIn, Facebook, Instagram). */
export const ZERNIO_FIRST_COMMENT_PLATFORMS = new Set(["facebook", "instagram", "linkedin", "youtube"]);

function firstCommentField(request: { firstComment?: string; targets: { platform: string }[] }): { firstComment?: string } {
  const text = request.firstComment?.trim();
  if (!text) return {};
  return request.targets.some((target) => ZERNIO_FIRST_COMMENT_PLATFORMS.has(target.platform)) ? { firstComment: text } : {};
}

/** Fusionne les métriques journalières de plusieurs profils (somme par date). */
export function mergeDailyMetrics(perProfile: SocialDailyMetric[][]): SocialDailyMetric[] {
  if (perProfile.length === 1) return perProfile[0]!;
  const merged = new Map<string, SocialDailyMetric>();
  for (const days of perProfile) {
    for (const day of days) {
      const current = merged.get(day.date) ?? { date: day.date, postCount: 0, platforms: {}, metrics: { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, views: 0, follows: 0 } };
      current.postCount += day.postCount;
      for (const [key, value] of Object.entries(day.platforms)) current.platforms[key] = (current.platforms[key] ?? 0) + value;
      for (const key of Object.keys(current.metrics) as Array<keyof SocialDailyMetric["metrics"]>) current.metrics[key] += day.metrics[key] ?? 0;
      merged.set(day.date, current);
    }
  }
  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function guessMediaType(url: string): "image" | "video" {
  return /\.(mp4|mov|webm)(\?.*)?$/i.test(url) ? "video" : "image";
}
