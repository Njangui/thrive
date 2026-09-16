export interface YouTubeOAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface YouTubeChannel {
  id: string;
  title: string;
  customUrl?: string | null;
  thumbnailUrl?: string | null;
}

export class YouTubeClient {
  constructor(private readonly tokens: YouTubeOAuthTokens) {}

  private async accessToken(): Promise<string> {
    if (Date.now() < this.tokens.expires_at - 60_000) return this.tokens.access_token;
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Connexion YouTube indisponible : configuration Google manquante.");

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: this.tokens.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const data = (await response.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (!response.ok || !data.access_token) throw new Error(`Impossible de renouveler la connexion YouTube (${data.error ?? response.status}).`);
    this.tokens.access_token = data.access_token;
    this.tokens.expires_at = Date.now() + (data.expires_in ?? 3600) * 1000;
    return data.access_token;
  }

  async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const token = await this.accessToken();
    const response = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
    const payload = (await response.json()) as T & { error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? `YouTube API ${response.status}`);
    return payload;
  }

  async getMine(): Promise<YouTubeChannel> {
    const data = await this.request<{ items?: Array<{ id: string; snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } } }> }>(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    );
    const item = data.items?.[0];
    if (!item) throw new Error("Aucune chaîne YouTube n'a été trouvée pour ce compte.");
    return { id: item.id, title: item.snippet?.title ?? "Chaîne YouTube", customUrl: item.snippet?.customUrl ?? null, thumbnailUrl: item.snippet?.thumbnails?.default?.url ?? null };
  }

  async analytics(fromDate: string, toDate: string) {
    const params = new URLSearchParams({
      ids: "channel==MINE",
      startDate: fromDate,
      endDate: toDate,
      metrics: "views,likes,comments,shares,subscribersGained,estimatedMinutesWatched",
      dimensions: "day",
      sort: "day",
    });
    return this.request<{ rows?: Array<[string, number, number, number, number, number, number]> }>(
      `https://youtubeanalytics.googleapis.com/v2/reports?${params.toString()}`,
    );
  }

  async uploadVideo(media: ArrayBuffer, metadata: { title: string; description?: string; privacyStatus: "private" | "public"; publishAt?: string }) {
    const token = await this.accessToken();
    const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/*",
        "X-Upload-Content-Length": String(media.byteLength),
      },
      body: JSON.stringify({
        snippet: { title: metadata.title.slice(0, 100), description: metadata.description ?? "" },
        status: { privacyStatus: metadata.privacyStatus, ...(metadata.publishAt ? { publishAt: metadata.publishAt } : {}) },
      }),
    });
    if (!init.ok) throw new Error(`Initialisation de l'envoi YouTube impossible (${init.status}).`);
    const uploadUrl = init.headers.get("location");
    if (!uploadUrl) throw new Error("YouTube n'a pas fourni l'URL d'envoi.");
    const uploaded = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "video/*", "Content-Length": String(media.byteLength) }, body: media });
    const payload = (await uploaded.json()) as { id?: string; snippet?: { title?: string }; status?: { uploadStatus?: string; privacyStatus?: string } };
    if (!uploaded.ok || !payload.id) throw new Error(`Envoi vidéo YouTube échoué (${uploaded.status}).`);
    return payload;
  }

  async getVideo(videoId: string) {
    return this.request<{ items?: Array<{ id: string; status?: { uploadStatus?: string; privacyStatus?: string }; snippet?: { title?: string } }> }>(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=${encodeURIComponent(videoId)}`,
    );
  }

  async deleteVideo(videoId: string) {
    const token = await this.accessToken();
    const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(videoId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Suppression YouTube impossible (${response.status}).`);
  }
}
