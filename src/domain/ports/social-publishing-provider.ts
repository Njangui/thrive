/**
 * SocialPublishingProvider — port métier (section 31 doc 2).
 * MarketingService dépend uniquement de cette interface, jamais du SDK
 * Zernio directement. Si Zernio est remplacé, seul l'adapter change.
 */

export interface SocialPostTarget {
  platform: string; // 'facebook' | 'instagram' | 'tiktok' | ... (valeurs Zernio confirmées : voir platforms/whatsapp etc.)
  accountId: string; // id du compte connecté côté provider
}

export interface CreateSocialPostRequest {
  content: string;
  mediaUrls?: string[];
  targets: SocialPostTarget[];
  /** Absent + publishNow=false => brouillon (comportement confirmé Zernio) */
  scheduledFor?: string; // format 'YYYY-MM-DDTHH:mm:ss', voir timezone
  timezone?: string;
  publishNow?: boolean;
}

export interface SocialPostResult {
  providerPostId: string;
  status: string;
}

export interface SocialPostTargetStatus {
  platform: string;
  accountId: string;
  status: string;
  platformPostUrl?: string;
  error?: string;
}

export interface SocialPostStatus {
  providerPostId: string;
  status: string; // scheduled | publishing | published | failed | partial (confirmé Zernio)
  targets: SocialPostTargetStatus[];
}

export interface SocialAnalyticsQuery {
  sortBy?: "engagement" | "recent";
  limit?: number;
}

export interface SocialAnalyticsEntry {
  providerPostId: string;
  platform: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
}

export interface SocialPublishingProvider {
  readonly providerName: string;

  /** Enregistre un brouillon, ne publie ni ne programme rien. */
  createPost(request: Omit<CreateSocialPostRequest, "scheduledFor" | "publishNow">): Promise<SocialPostResult>;

  /** Programme la publication à une date/heure donnée. */
  schedulePost(request: CreateSocialPostRequest & { scheduledFor: string }): Promise<SocialPostResult>;

  /** Publie immédiatement. */
  publishPost(request: CreateSocialPostRequest): Promise<SocialPostResult>;

  getPostStatus(providerPostId: string): Promise<SocialPostStatus>;

  /**
   * Annule une publication programmée, ou supprime un brouillon.
   * CONFIRMÉ (docs.zernio.com) : `DELETE /posts/{postId}`. Un post déjà
   * publié ne peut pas être annulé (l'historique est préservé).
   */
  cancelPost(providerPostId: string): Promise<void>;

  getAnalytics(query: SocialAnalyticsQuery): Promise<SocialAnalyticsEntry[]>;
}
