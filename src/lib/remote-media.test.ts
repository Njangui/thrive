import { describe, it, expect } from "vitest";
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
