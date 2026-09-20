import { env } from "@/lib/env";
import type {
  ZernioCreatePostPayload,
  ZernioCreatePostResponse,
  ZernioGetPostResponse,
  ZernioAnalyticsResponse,
  ZernioInboxCommentsResponse,
  ZernioListAccountsResponse,
  ZernioDailyMetricsResponse,
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

  /**
   * VÉRIFIÉ (docs.zernio.com, guide « Media Uploads » + « Get upload URL »,
   * sept. 2026) : `POST /v1/media/presign` (`filename`, `contentType`,
   * `size` optionnel pour contrôler la limite de 5 Go) renvoie `uploadUrl`
   * (URL Cloudflare R2 présignée, valable 1 h, où le NAVIGATEUR envoie le
   * fichier en `PUT` avec le même `Content-Type`, sans en-tête
   * Authorization), `publicUrl` (`media.zernio.com/temp/...`), `key` et
   * `expiresIn`. « Uploads expire after 7 days » : stockage temporaire, à
   * utiliser dans une publication programmée dans les 7 jours — voir
   * catalog-video-service.ts.
   *
   * Les noms de champs de la requête ont changé entre deux versions de la
   * doc (`filename`/`contentType` aujourd'hui, `fileName`/`fileType`
   * auparavant) : on envoie la forme actuelle et, sur un 400, on retente
   * une fois avec l'ancienne plutôt que d'échouer sur un simple renommage.
   */
  async createMediaPresign(
    fileName: string,
    contentType: string,
    sizeBytes?: number,
  ): Promise<{ uploadUrl: string; publicUrl: string; key?: string; expiresIn?: number }> {
    this.assertConfigured();

    const attempt = async (body: Record<string, string | number>) =>
      fetch(`${this.baseUrl}/media/presign`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    let res = await attempt({
      filename: fileName,
      contentType,
      ...(sizeBytes ? { size: sizeBytes } : {}),
    });
    if (res.status === 400) res = await attempt({ fileName, fileType: contentType });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zernio createMediaPresign failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as { uploadUrl?: string; publicUrl?: string; fileUrl?: string; key?: string; expiresIn?: number };
    const publicUrl = data.publicUrl ?? data.fileUrl;
    if (!data.uploadUrl || !publicUrl) {
      throw new Error("Réponse Zernio inattendue : uploadUrl/publicUrl manquant.");
    }
    return { uploadUrl: data.uploadUrl, publicUrl, key: data.key, expiresIn: data.expiresIn };
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

  async getDailyMetrics(profileId: string, fromDate: string, toDate: string): Promise<ZernioDailyMetricsResponse> {
    this.assertConfigured();
    const params = new URLSearchParams({ profileId, fromDate, toDate });
    const res = await fetch(`${this.baseUrl}/analytics/daily-metrics?${params.toString()}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zernio getDailyMetrics failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<ZernioDailyMetricsResponse>;
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

  /**
   * CONFIRMÉ (docs.zernio.com/multi-tenant, "Build Social Posting Into
   * Your App — Multi-Tenant Architecture", consulté 5 sept. 2026) :
   * `GET /v1/accounts?profileId=...`. `profileId` scope le résultat au
   * profil du tenant plutôt qu'à toute l'équipe Zernio — sans lui, un
   * appelant partageant une clé API plateforme verrait les comptes de
   * TOUS les tenants utilisant cette clé (voir adapter.ts pour la portée
   * exacte de ce que ça affecte vs pas).
   */
  async createProfile(payload: { name: string; description?: string; color?: string }): Promise<{ profile: { _id: string; name: string } }> {
    this.assertConfigured();
    const res = await fetch(`${this.baseUrl}/profiles`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zernio createProfile failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<{ profile: { _id: string; name: string } }> ;
  }

  /**
   * `onboarding` (WhatsApp uniquement) : "business_app" = Coexistence
   * (le commerçant garde son numéro utilisable sur l'app WhatsApp
   * Business — voir docs.zernio.com/platforms/whatsapp/connection),
   * "api" = Cloud API classique (numéro dédié, requis pour l'API
   * Groupes, qui ne fonctionne PAS sur un numéro en Coexistence). Par
   * défaut "business_app" : c'est le mode par défaut chez Zernio et
   * celui qui correspond à l'usage le plus courant (messagerie 1:1).
   * L'appelant passe explicitement "api" pour le parcours numéro dédié
   * aux groupes (voir zernio-channel-service.ts::
   * getZernioWhatsAppGroupsConnectUrl).
   */
  async getConnectUrl(
    platform: string,
    profileId: string,
    redirectUrl: string,
    options?: { onboarding?: "api" | "business_app" },
  ): Promise<{ authUrl: string; state?: string }> {
    this.assertConfigured();
    const params = new URLSearchParams({ profileId, redirect_url: redirectUrl });
    if (platform === "whatsapp") params.set("onboarding", options?.onboarding ?? "business_app");
    const res = await fetch(`${this.baseUrl}/connect/${encodeURIComponent(platform)}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zernio connect ${platform} failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<{ authUrl: string; state?: string }>;
  }

  async getTelegramConnectStatus(profileId: string): Promise<{ code: string; expiresAt: string; expiresIn: number; botUsername: string; instructions: string[] }> {
    this.assertConfigured();
    const res = await fetch(`${this.baseUrl}/connect/telegram?profileId=${encodeURIComponent(profileId)}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zernio Telegram code failed (${res.status}): ${body}`);
    }
    return res.json();
  }

  async completeTelegramConnect(code: string): Promise<{ status: string; expiresAt?: string; expiresIn?: number; chatId?: string; chatTitle?: string; chatType?: string; account?: { _id: string; username?: string; displayName?: string } }> {
    this.assertConfigured();
    const res = await fetch(`${this.baseUrl}/connect/telegram?code=${encodeURIComponent(code)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zernio Telegram status failed (${res.status}): ${body}`);
    }
    return res.json();
  }

  async listAccounts(profileId?: string): Promise<ZernioListAccountsResponse> {
    this.assertConfigured();

    const query = profileId ? `?profileId=${encodeURIComponent(profileId)}` : "";
    const res = await fetch(`${this.baseUrl}/accounts${query}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zernio listAccounts failed (${res.status}): ${body}`);
    }

    return res.json() as Promise<ZernioListAccountsResponse>;
  }
}
