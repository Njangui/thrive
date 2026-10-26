import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { isOptimizableImageUrl } from "./optimizable-image";

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcxyz.supabase.co"));

describe("isOptimizableImageUrl", () => {
  it("accepte un sous-domaine Supabase (bucket tenant-media)", () => {
    expect(isOptimizableImageUrl("https://abcxyz.supabase.co/storage/v1/object/public/tenant-media/foo.jpg")).toBe(
      true,
    );
  });

  it("accepte picsum.photos (placeholders du seed de démo)", () => {
    expect(isOptimizableImageUrl("https://picsum.photos/seed/x/800/600")).toBe(true);
  });

  it("refuse un domaine externe arbitraire (mode \"Lien existant\")", () => {
    expect(isOptimizableImageUrl("https://i.imgur.com/photo.jpg")).toBe(false);
  });

  it("refuse un domaine qui contient juste \"supabase.co\" en sous-chaîne sans être un vrai sous-domaine", () => {
    expect(isOptimizableImageUrl("https://supabase.co.evil-domain.com/x.jpg")).toBe(false);
  });

  it("ne lève jamais sur une URL invalide — retourne false", () => {
    expect(isOptimizableImageUrl("pas-une-url")).toBe(false);
  });
});

describe("isOptimizableImageUrl — domaine public R2 (C4)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepte l'hôte R2 configuré au build, et lui seul", () => {
    vi.stubEnv("NEXT_PUBLIC_R2_MEDIA_HOST", "media.exemple.com");
    expect(isOptimizableImageUrl("https://media.exemple.com/org/photo.jpg")).toBe(true);
    expect(isOptimizableImageUrl("https://autre.exemple.com/org/photo.jpg")).toBe(false);
    expect(isOptimizableImageUrl("https://media.exemple.com.evil.com/x.jpg")).toBe(false);
  });

  it("sans hôte R2 configuré, un domaine arbitraire reste refusé (aucun faux positif sur hôte vide)", () => {
    vi.stubEnv("NEXT_PUBLIC_R2_MEDIA_HOST", "");
    expect(isOptimizableImageUrl("https://media.exemple.com/x.jpg")).toBe(false);
  });
});

describe("projet Supabase unique (audit QA3)", () => {
  it("refuse le Storage d'un AUTRE projet Supabase", () => {
    expect(isOptimizableImageUrl("https://autreprojet.supabase.co/storage/v1/object/public/tenant-media/a.jpg")).toBe(false);
  });
});
