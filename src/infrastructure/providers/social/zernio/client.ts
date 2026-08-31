import { env } from "@/lib/env";
import type {
  ZernioCreatePostPayload,
  ZernioCreatePostResponse,
  ZernioGetPostResponse,
  ZernioAnalyticsResponse,
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
}
