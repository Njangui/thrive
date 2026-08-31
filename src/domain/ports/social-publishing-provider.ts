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

/**
 * Lot I, Partie 3 — commentaires sociaux. CONFIRMÉ (docs.zernio.com,
 * "Comments API"/"Get post comments", consulté le 31 août 2026) :
 * Facebook, Instagram, YouTube, LinkedIn, Threads, X/Twitter, Reddit,
 * Bluesky supportent la lecture ET la réponse. Limite documentée : LinkedIn
 * nécessite un compte "organisation" (page d'entreprise) — les commentaires
 * d'un profil personnel ne sont pas exposés par l'API de la plateforme
 * elle-même (limite plateforme, pas Zernio). `canReply`/`canHide` viennent
 * tels quels de la réponse Zernio (elle-même dérivée des permissions
 * réelles du compte connecté) — jamais recalculés côté SME-OS.
 */
export interface SocialComment {
  id: string;
  authorName: string | null;
  content: string;
  createdAt: string | null;
  canReply: boolean;
  /** Hide/unhide CONFIRMÉ uniquement sur Facebook, Instagram, Threads (docs.zernio.com FAQ Comments API). */
  canHide: boolean;
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

  /**
   * Commentaires d'un post publié, pour UN compte cible (un post
   * cross-posté a un fil de commentaires distinct par compte/plateforme —
   * voir social_post_targets). CONFIRMÉ : GET
   * /v1/inbox/comments/{postId}?accountId=... Réponses mises en cache
   * jusqu'à 10 min côté Zernio — pas un flux temps réel (un webhook
   * `comment.received` existe pour ça, non exploité en V1, voir
   * docs/ZERNIO_INTEGRATION.md).
   */
  listComments(providerPostId: string, accountId: string): Promise<SocialComment[]>;

  /** CONFIRMÉ : POST /v1/inbox/comments/{postId} avec { accountId, commentId, message }. */
  replyToComment(providerPostId: string, accountId: string, commentId: string, message: string): Promise<void>;

  /** CONFIRMÉ (SDKs officiels Zernio) : POST .../{commentId}/hide avec { accountId }. Facebook/Instagram/Threads uniquement. */
  hideComment(providerPostId: string, accountId: string, commentId: string): Promise<void>;

  /** CONFIRMÉ (SDKs officiels Zernio) : DELETE .../{commentId}/hide. */
  unhideComment(providerPostId: string, accountId: string, commentId: string): Promise<void>;
}
