import { describe, it, expect, beforeEach, vi } from "vitest";

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcd.supabase.co"));
import { isAllowedRemoteMediaHost, isZernioMediaHost, fileNameFromUrl, TELEGRAM_UPLOAD_MAX_BYTES } from "./remote-media";

describe("liste blanche des hôtes de médias (anti-SSRF)", () => {
  it("accepte le stockage Zernio et le Storage Supabase, en HTTPS uniquement", () => {
    expect(isAllowedRemoteMediaHost("https://media.zernio.com/temp/1_a_video.mp4")).toBe(true);
    expect(isAllowedRemoteMediaHost("https://abcd.supabase.co/storage/v1/object/public/tenant-media/x.pdf")).toBe(true);
    expect(isAllowedRemoteMediaHost("http://media.zernio.com/temp/a.mp4")).toBe(false);
  });

  it("refuse les hôtes détournés, internes ou mal formés", () => {
    expect(isAllowedRemoteMediaHost("https://media.zernio.com.evil.example/a.mp4")).toBe(false);
    expect(isAllowedRemoteMediaHost("https://evil.example/x.supabase.co/a.mp4")).toBe(false);
    expect(isAllowedRemoteMediaHost("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedRemoteMediaHost("https://localhost/a.mp4")).toBe(false);
    expect(isAllowedRemoteMediaHost("pas une url")).toBe(false);
  });

  it("isZernioMediaHost ne reconnaît que media.zernio.com", () => {
    expect(isZernioMediaHost("https://media.zernio.com/temp/a.mp4")).toBe(true);
    expect(isZernioMediaHost("https://abcd.supabase.co/a.mp4")).toBe(false);
  });

  it("nom de fichier issu de l'URL, décodé", () => {
    expect(fileNameFromUrl("https://media.zernio.com/temp/1_abc_ma%20video.mp4")).toBe("1_abc_ma video.mp4");
  });

  it("plafond Telegram par téléversement : 50 Mo (contre 20 Mo par URL)", () => {
    expect(TELEGRAM_UPLOAD_MAX_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe("SEC2 : projet unique et redirections manuelles", () => {
  it("refuse le Storage d'un autre projet", () => {
    expect(isAllowedRemoteMediaHost("https://autre.supabase.co/a.mp4")).toBe(false);
  });
  it("refuse une redirection hors liste blanche sans requêter la cible", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      calls.push(String(u));
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
    });
    const { downloadRemoteMedia } = await import("./remote-media");
    await expect(downloadRemoteMedia("https://media.zernio.com/temp/a.mp4", 1000)).rejects.toThrow(/non autoris/);
    expect(calls).toEqual(["https://media.zernio.com/temp/a.mp4"]);
    vi.unstubAllGlobals();
  });
  it("suit une redirection autorisée (3 sauts max)", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => (n++ < 1 ? new Response(null, { status: 302, headers: { location: "https://media.zernio.com/b.mp4" } }) : new Response("ok", { status: 200 })));
    const { downloadRemoteMedia } = await import("./remote-media");
    const r = await downloadRemoteMedia("https://media.zernio.com/a.mp4", 1000);
    expect(r.data.byteLength).toBe(2);
    vi.unstubAllGlobals();
  });
});
