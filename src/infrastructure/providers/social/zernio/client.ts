import { env } from "@/lib/env";
import type {
  ZernioCreatePostPayload,
  ZernioCreatePostResponse,
  ZernioGetPostResponse,
  ZernioAnalyticsResponse,
  ZernioInboxCommentsResponse,
} from "./types";

/**
 * Client HTTP bas niveau pour le Posts API Zernio — endpoints confirmés
 * (voir types.ts pour le détail de ce qui est vérifié vs inféré).
 */
export class ZernioSocialClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(apiKey: string = env.ZERNIO_API_KEY ?? "", baseUrl: string = env.ZERNIO_API_BASE_URL) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  private assertConfigured() {
    if (!this.apiKey) {
      throw new Error("ZERNIO_API_KEY manquant — impossible de publier sur les réseaux sociaux.");
    }
  }

  async createPost(payload: ZernioCreatePostPayload, idempotencyKey: string): Promise<ZernioCreatePostResponse> {
    this.assertConfigured();

    const res = await fetch(`${this.baseUrl}/posts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        // CONFIRMÉ (glossaire Zernio "Idempotency key") : rejouer avec le
        // même UUID sous ~5 min renvoie le post déjà créé au lieu d'un
        // doublon — essentiel pour les campagnes en masse (section 29).
        "x-request-id": idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zernio createPost failed (${res.status}): ${body}`);
    }

    return res.json() as Promise<ZernioCreatePostResponse>;
  }

  /** CONFIRMÉ (doc Discord "Edit & Delete", endpoint générique Posts API) : supprime un brouillon ou annule un post programmé. */
  async deletePost(postId: string): Promise<void> {
    this.assertConfigured();

    const res = await fetch(`${this.baseUrl}/posts/${postId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zernio deletePost failed (${res.status}): ${body}`);
    }
  }

  async getPost(postId: string): Promise<ZernioGetPostResponse> {
    this.assertConfigured();

    const res = await fetch(`${this.baseUrl}/posts/${postId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      throw new Error(`Zernio getPost failed (${res.status})`);
    }

    return res.json() as Promise<ZernioGetPostResponse>;
  }

  async getAnalytics(sortBy: string, limit: number): Promise<ZernioAnalyticsResponse> {
    this.assertConfigured();

    const res = await fetch(`${this.baseUrl}/analytics?sortBy=${sortBy}&limit=${limit}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      throw new Error(`Zernio getAnalytics failed (${res.status})`);
    }

    return res.json() as Promise<ZernioAnalyticsResponse>;
  }

  /** CONFIRMÉ (docs.zernio.com "Get post comments") : GET /v1/inbox/comments/{postId}?accountId=... */
  async listInboxComments(postId: string, accountId: string): Promise<ZernioInboxCommentsResponse> {
    this.assertConfigured();

    const res = await fetch(
      `${this.baseUrl}/inbox/comments/${encodeURIComponent(postId)}?accountId=${encodeURIComponent(accountId)}`,
      { headers: { Authorization: `Bearer ${this.apiKey}` } },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zernio listInboxComments failed (${res.status}): ${body}`);
    }

    return res.json() as Promise<ZernioInboxCommentsResponse>;
  }

  /** CONFIRMÉ (docs.zernio.com "Social Media Comments API") : POST /v1/inbox/comments/{postId}. */
  async replyToInboxComment(postId: string, accountId: string, commentId: string, message: string): Promise<void> {
    this.assertConfigured();

    const res = await fetch(`${this.baseUrl}/inbox/comments/${encodeURIComponent(postId)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, commentId, message }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zernio replyToInboxComment failed (${res.status}): ${body}`);
    }
  }

  /** CONFIRMÉ (SDKs officiels zernio-php/zernio-dotnet) : POST .../{commentId}/hide avec { accountId }. */
  async hideInboxComment(postId: string, accountId: string, commentId: string): Promise<void> {
    this.assertConfigured();

    const res = await fetch(
      `${this.baseUrl}/inbox/comments/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}/hide`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zernio hideInboxComment failed (${res.status}): ${body}`);
    }
  }

  /**
   * CONFIRMÉ (SDKs officiels zernio-php/zernio-dotnet) : DELETE
   * .../{commentId}/hide. INFÉRÉ (non documenté verbatim) : passage
   * d'`accountId` en query string plutôt qu'en corps — par symétrie avec
   * `hide` (une requête DELETE avec corps JSON est peu fiable selon les
   * runtimes/proxys). À corriger si un test réel contre l'API révèle
   * un format différent.
   */
  async unhideInboxComment(postId: string, accountId: string, commentId: string): Promise<void> {
    this.assertConfigured();

    const res = await fetch(
      `${this.baseUrl}/inbox/comments/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}/hide?accountId=${encodeURIComponent(accountId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${this.apiKey}` } },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zernio unhideInboxComment failed (${res.status}): ${body}`);
    }
  }
}
