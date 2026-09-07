/**
 * Types Zernio — Posts API (social publishing). Confirmé via
 * docs.zernio.com (Quickstart, page Discord "Edit & Delete", pages
 * Facebook/Bluesky "Analytics", Glossary "Idempotency key") consulté le
 * 27 août 2026.
 *
 * CONFIRMÉ :
 * - POST /posts : un seul endpoint pour brouillon / programmation /
 *   publication immédiate, distingué par présence de `scheduledFor`+
 *   `timezone` ou de `publishNow: true`.
 * - `mediaItems: [{ type, url }]` (ex. officiel : `{ type: "video", url }`).
 * - `platforms: [{ platform, accountId }]` — cross-post = plusieurs entrées.
 * - GET /posts/{postId} -> `{ post: { status, ... } }`, status parmi
 *   scheduled | publishing | published | failed | partial.
 * - DELETE /posts/{postId} : supprime un brouillon OU annule un post
 *   programmé (confirmé, page Discord "Edit & Delete" — endpoint générique,
 *   pas spécifique à Discord). Un post déjà publié ne peut PAS être
 *   supprimé par cette route (protège l'historique, section 10/52 doc 2).
 * - POST /posts/{postId}/edit : modifie le texte d'un post (brouillon ou
 *   programmé uniquement, comme documenté pour Discord — non exploité en V1).
 * - Idempotence native : header `x-request-id` (UUID) sur `POST /posts`.
 *   Un retry avec le même UUID dans les ~5 minutes renvoie le post déjà
 *   créé (`200` + `existingPost`) au lieu d'en créer un doublon. Zernio
 *   applique en plus un dédoublonnage par empreinte de contenu
 *   (plateforme+compte+contenu+médias, fenêtre 24h, `409` + `existingPostId`).
 * - GET /analytics -> `{ posts: [...] }` (pas `{ data: [...] }`).
 * - URLs Supabase Storage : auto-proxées par Zernio, utilisables telles
 *   quelles comme `mediaItems[].url`.
 *
 * NON EXPLOITÉ EN V1 (existe mais volontairement pas modélisé ici pour ne
 * pas sur-engineer, section 62 doc 2) : champs `platformSpecificData` par
 * plateforme (ex. `facebookSettings.carouselCards`, `pageId` Facebook,
 * `channelId` Discord...). À ajouter si un vrai besoin business apparaît.
 */

export interface ZernioMediaItem {
  type: "image" | "video";
  url: string;
}

export interface ZernioPostPlatformTarget {
  platform: string;
  accountId: string;
}

export interface ZernioCreatePostPayload {
  content: string;
  mediaItems?: ZernioMediaItem[];
  platforms: ZernioPostPlatformTarget[];
  scheduledFor?: string;
  timezone?: string;
  publishNow?: boolean;
}

export interface ZernioCreatePostResponse {
  post: { _id: string; status: string };
}

export interface ZernioPostPlatformResult {
  platform: string;
  accountId: string;
  status: string;
  platformPostUrl?: string;
  error?: string;
}

export interface ZernioGetPostResponse {
  post: {
    _id: string;
    status: string;
    platformResults?: ZernioPostPlatformResult[]; // forme inférée, non confirmée en détail
  };
}

export interface ZernioAnalyticsEntry {
  postId: string;
  platform: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
}

/** CONFIRMÉ (docs.zernio.com, pages Facebook/Bluesky "Analytics") : la réponse expose `posts`, pas `data`. */
export interface ZernioAnalyticsResponse {
  posts: ZernioAnalyticsEntry[];
}

/**
 * Types Zernio — Comments API (Lot I). Confirmés via docs.zernio.com
 * ("Get post comments" - API Reference, "Social Media Comments API",
 * "Social Media Inbox") et les SDKs officiels zernio-php/zernio-dotnet
 * (endpoints hide/unhide), consultés le 31 août 2026.
 *
 * CONFIRMÉ :
 * - GET /v1/inbox/comments/{postId}?accountId=... -> { comments: [...] },
 *   chaque commentaire expose `canReply`/`canHide` calculés par Zernio
 *   selon les permissions réelles du compte connecté.
 * - POST /v1/inbox/comments/{postId} avec { accountId, commentId, message }
 *   -> répond à un commentaire.
 * - POST /v1/inbox/comments/{postId}/{commentId}/hide avec { accountId } —
 *   DELETE (même URL) pour "unhide". Facebook/Instagram/Threads uniquement
 *   (FAQ "Social Media Comments API").
 *
 * NON EXPLOITÉ EN V1 (existe, documenté, mais hors périmètre du cahier Lot
 * I qui ne demande que lecture + réponse — voir docs/ZERNIO_INTEGRATION.md) :
 * webhook `comment.received` (temps réel), `like`/`unlike`, `delete`,
 * "private reply" (Facebook/Instagram uniquement), comment-to-DM.
 */
export interface ZernioInboxCommentAuthor {
  id?: string;
  name?: string;
  username?: string;
  picture?: string;
}

export interface ZernioInboxComment {
  id: string;
  message: string;
  createdTime?: string;
  from?: ZernioInboxCommentAuthor;
  canReply?: boolean;
  canHide?: boolean;
  isHidden?: boolean;
}

export interface ZernioInboxCommentsResponse {
  status?: string;
  comments: ZernioInboxComment[];
}
