import { describe, it, expect } from "vitest";
import { YouTubeSocialAdapter } from "./adapter";
import type { YouTubeClient } from "./client";
import type { SocialAccountSummary } from "@/domain/ports/social-publishing-provider";

const fakeAccount: SocialAccountSummary = { accountId: "chan-A", platform: "youtube", username: "A" };

// `uploadVideo` ne doit jamais être atteint pour une URL hors liste
// blanche : si le test échoue en réseau (tentative d'appel Google), c'est
// que la régression SSRF est revenue (fetch direct au lieu de
// downloadRemoteMedia).
const fakeClient = {
  uploadVideo: () => {
    throw new Error("uploadVideo n'aurait jamais dû être appelé pour une URL non autorisée.");
  },
} as unknown as YouTubeClient;

describe("YouTubeSocialAdapter — régression SSRF (audit sécurité)", () => {
  it("refuse une URL vidéo hors liste blanche (media.zernio.com / *.supabase.co) sans tenter de la récupérer", async () => {
    const adapter = new YouTubeSocialAdapter(fakeClient, fakeAccount);

    await expect(
      adapter.publishPost({
        content: "x",
        mediaUrls: ["https://attacker.example/payload.mp4"],
        targets: [{ platform: "youtube", accountId: "chan-A" }],
      }),
    ).rejects.toThrow(/n'a pas pu être récupérée/);
  });

  it("refuse aussi une adresse interne déguisée en vidéo (protection SSRF de base)", async () => {
    const adapter = new YouTubeSocialAdapter(fakeClient, fakeAccount);

    await expect(
      adapter.publishPost({
        content: "x",
        mediaUrls: ["https://169.254.169.254/latest/meta-data/video.mp4"],
        targets: [{ platform: "youtube", accountId: "chan-A" }],
      }),
    ).rejects.toThrow(/n'a pas pu être récupérée/);
  });
});
