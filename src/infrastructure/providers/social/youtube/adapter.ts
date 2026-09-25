import { randomUUID } from "node:crypto";
import type { SocialPublishingProvider, CreateSocialPostRequest, SocialAnalyticsEntry, SocialAnalyticsQuery, SocialComment, SocialDailyMetric, SocialPostResult, SocialPostStatus, SocialAccountSummary } from "@/domain/ports/social-publishing-provider";
import { YouTubeClient, type YouTubeOAuthTokens } from "./client";
import { downloadRemoteMedia, isZernioMediaHost } from "@/lib/remote-media";
import { MAX_VIDEO_BYTES } from "@/application/services/catalog-video-service";

export class YouTubeSocialAdapter implements SocialPublishingProvider {
  readonly providerName = "youtube";
  constructor(private readonly client: YouTubeClient, private readonly account: SocialAccountSummary) {}

  async createPost(request: Omit<CreateSocialPostRequest, "scheduledFor" | "publishNow">): Promise<SocialPostResult> {
    return this.upload(request, "private");
  }
  async schedulePost(request: CreateSocialPostRequest & { scheduledFor: string }): Promise<SocialPostResult> {
    return this.upload(request, "private", request.scheduledFor);
  }
  async publishPost(request: CreateSocialPostRequest): Promise<SocialPostResult> {
    return this.upload(request, "public");
  }
  private async upload(request: CreateSocialPostRequest, privacyStatus: "private" | "public", publishAt?: string) {
    const videoUrl = request.mediaUrls?.find((url) => /\.(mp4|mov|webm|m4v)(\?.*)?$/i.test(url));
    if (!videoUrl) throw new Error("YouTube nécessite une vidéo (MP4, MOV, WebM ou M4V) dans la publication.");
    // CORRECTIF SÉCURITÉ (audit) : `videoUrl` vient de `mediaUrls`, un champ
    // saisi librement par le marchand (composeur de publication) — un
    // `fetch(videoUrl)` direct ici ferait faire au serveur une requête vers
    // N'IMPORTE QUELLE adresse fournie par un utilisateur authentifié (SSRF),
    // exactement le risque que `downloadRemoteMedia()` a été écrit pour
    // éliminer (voir lib/remote-media.ts, déjà utilisé par l'adaptateur
    // Telegram pour ce même besoin). Liste blanche d'hôtes + revalidation
    // après redirection + plafond de taille, au lieu d'un fetch nu.
    let media: ArrayBuffer;
    try {
      const downloaded = await downloadRemoteMedia(videoUrl, MAX_VIDEO_BYTES);
      media = downloaded.data.buffer as ArrayBuffer;
    } catch {
      throw new Error(isZernioMediaHost(videoUrl) ? "La vidéo n'est plus disponible chez Zernio (Zernio ne conserve les fichiers que 7 jours). Téléversez-la à nouveau." : "La vidéo n'a pas pu être récupérée pour YouTube.");
    }
    const normalizedPublishAt = publishAt ? (publishAt.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(publishAt) ? new Date(publishAt).toISOString() : new Date(`${publishAt}+01:00`).toISOString()) : undefined;
    const uploaded = await this.client.uploadVideo(media, { title: request.content.split("\n")[0] || "Publication flexco ", description: request.content, privacyStatus, publishAt: normalizedPublishAt });
    return { providerPostId: uploaded.id!, status: uploaded.status?.uploadStatus === "uploaded" ? "published" : "processing" };
  }
  async getPostStatus(providerPostId: string): Promise<SocialPostStatus> {
    const data = await this.client.getVideo(providerPostId);
    const video = data.items?.[0];
    if (!video) return { providerPostId, status: "failed", targets: [{ platform: "youtube", accountId: this.account.accountId, status: "failed", error: "Vidéo introuvable" }] };
    const status = video.status?.privacyStatus === "public" ? "published" : "scheduled";
    return { providerPostId, status, targets: [{ platform: "youtube", accountId: this.account.accountId, status: status === "published" ? "published" : "pending", platformPostUrl: `https://www.youtube.com/watch?v=${providerPostId}` }] };
  }
  async cancelPost(providerPostId: string): Promise<void> { await this.client.deleteVideo(providerPostId); }
  async getAnalytics(_query: SocialAnalyticsQuery): Promise<SocialAnalyticsEntry[]> { return []; }
  async getDailyMetrics(fromDate: string, toDate: string): Promise<SocialDailyMetric[]> {
    const data = await this.client.analytics(fromDate, toDate);
    return (data.rows ?? []).map((row) => ({ date: row[0], postCount: 0, platforms: { youtube: 1 }, metrics: { impressions: 0, reach: 0, likes: row[2] ?? 0, comments: row[3] ?? 0, shares: row[4] ?? 0, saves: 0, clicks: 0, views: row[1] ?? 0, follows: row[5] ?? 0 } }));
  }
  async listAccounts(): Promise<SocialAccountSummary[]> { return [this.account]; }
  async listComments(): Promise<SocialComment[]> { return []; }
  async replyToComment(): Promise<void> { throw new Error("La gestion des commentaires YouTube sera ajoutée au module social dédié."); }
  async hideComment(): Promise<void> { throw new Error("Action non disponible pour YouTube dans cette version."); }
  async unhideComment(): Promise<void> { throw new Error("Action non disponible pour YouTube dans cette version."); }
}

export function youtubeAccount(channelId: string, title: string): SocialAccountSummary {
  return { accountId: channelId || randomUUID(), platform: "youtube", username: title };
}

export function buildYouTubeClient(tokens: YouTubeOAuthTokens) { return new YouTubeClient(tokens); }
