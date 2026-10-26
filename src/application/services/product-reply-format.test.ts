import { describe, it, expect } from "vitest";
import { formatProductSearchReply, formatProductListReply, formatCategoryListReply, describePriceRequest } from "./product-reply-format";
import { createMessageLibrary } from "./message-library";
import { DEFAULT_BRAND_VOICE } from "./brand-voice";
import { parseProductQuery } from "./product-query-parser";

const flat = (t: string) => t.replace(/[\u202f\u00a0]/g, " ");
const hit = (over = {}) => ({ id: "a", name: "Derby", slug: "derby", unitPrice: 24500, description: null, categoryName: "Chaussures", imageUrl: null, compareAtPrice: null, isPromo: false, score: 1, ...over });
const ctx = { publicBaseUrl: "https://b.example", catalogUrl: "https://b.example/produits", itemLabelPlural: "produits" };

describe("product-reply-format", () => {
  it("liste de produits : introduction de la bibliothèque, puis les faits de la base", () => {
    const text = flat(formatProductListReply([hit()], ctx));
    expect(text.startsWith("👋 Bien sûr ! Voici quelques-uns de nos produits disponibles :")).toBe(true);
    expect(text).toContain("24 500 FCFA");
    expect(text).toContain("https://b.example/produits/derby");
    expect(text.endsWith("Voir tous les produits : https://b.example/produits")).toBe(true);
  });

  it("« voir tous les … » suit le secteur (services, pas toujours « produits »)", () => {
    expect(formatProductListReply([hit()], { ...ctx, itemLabelPlural: "services" })).toContain("Voir tous les services :");
  });

  it("voix tutoiement sans emoji : même contenu factuel, ton différent", () => {
    const library = createMessageLibrary({ ...DEFAULT_BRAND_VOICE, register: "tu", emojiLevel: "none" });
    const text = flat(formatProductSearchReply([hit()], { ...ctx, priceRequest: parseProductQuery("des chaussures"), relaxed: false, library }));
    expect(text.startsWith("Voici ce qui correspond à ta recherche :")).toBe(true);
    expect(text).toContain("24 500 FCFA");
  });

  it("budget non trouvé : formulation honnête avec les chiffres du client", () => {
    const text = flat(formatProductSearchReply([hit({ unitPrice: 42000 })], { ...ctx, priceRequest: parseProductQuery("sac moins de 20k"), relaxed: true }));
    expect(text.startsWith("Je n'ai rien trouvé à moins de 20 000 FCFA. Voici ce qui s'en rapproche :")).toBe(true);
  });

  it("prix barré seulement pour une promotion en cours", () => {
    const text = flat(formatProductListReply([hit({ compareAtPrice: 30000, isPromo: true }), hit({ id: "b", name: "B", slug: null, compareAtPrice: 30000, isPromo: false })], ctx));
    expect(text).toContain("24 500 FCFA (au lieu de 30 000 FCFA)");
    expect(text.match(/au lieu de/g)).toHaveLength(1);
  });

  it("catégories : identique à l'ancien texte avec la voix par défaut", () => {
    const text = formatCategoryListReply([{ name: "Chaussures", slug: "c", productCount: 12 }], "https://b.example/produits", "produits");
    expect(text).toBe("Voici nos catégories de produits :\n\n• Chaussures (12)\n\nDites-moi laquelle vous intéresse, ou ce que vous cherchez.\nVoir tous les produits : https://b.example/produits");
  });

  it("describePriceRequest", () => {
    expect(describePriceRequest(parseProductQuery("sac"))).toBeNull();
  });
});
