import { describe, it, expect } from "vitest";
import { isOptimizableImageUrl } from "./optimizable-image";

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
