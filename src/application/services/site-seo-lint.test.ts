import { describe, it, expect } from "vitest";
import { lintSiteSnapshot } from "./site-seo-lint";
import { applySiteOperations } from "./site-operations";
import { buildDefaultSiteSnapshot, type DefaultSiteInput } from "./site-default-tree";
import type { SiteSnapshot } from "@/domain/entities/site";

const input: DefaultSiteInput = {
  sections: [{ type: "hero", enabled: true, order: 0 }, { type: "products", enabled: true, order: 1 }],
  brandColorPrimary: null, brandColorSecondary: null, fontChoice: "modern", visualStyle: "soft",
  heroTitle: "Bienvenue chez Mado", heroSubtitle: null, ctaLabel: null, ctaUrl: null, secondaryCtaLabel: null,
  heroLayout: null, heroMediaUrl: null, announcement: null, announcementEnabled: true, highlights: null,
  organizationName: "Chez Mado Pâtisserie",
};
const goodSeo = { title: "Chez Mado — pâtisserie à Yaoundé", description: "Gâteaux sur mesure, viennoiseries et livraison à domicile à Yaoundé. Commandez en ligne ou par WhatsApp." , ogImageUrl: "https://media.exemple.com/og.jpg" };
const base = (): SiteSnapshot => {
  const s = buildDefaultSiteSnapshot(input);
  s.pages[0]!.seo = { ...goodSeo };
  return s;
};
const codes = (s: SiteSnapshot) => lintSiteSnapshot(s).issues.map((i) => i.code);

describe("lintSiteSnapshot", () => {
  it("un site complet ne produit aucun problème", () => {
    const r = lintSiteSnapshot(base());
    expect(r.issues).toEqual([]);
    expect(r.canPublish).toBe(true);
  });

  it("bloque : accueil en noindex", () => {
    const s = base(); s.pages[0]!.seo.noindex = true;
    const r = lintSiteSnapshot(s);
    expect(r.canPublish).toBe(false);
    expect(r.errors.map((e) => e.code)).toEqual(["HOME_NOINDEX"]);
  });

  it("bloque : page indexable sans section visible", () => {
    const s = base();
    s.pages[0]!.blocks.forEach((b) => (b.visible = false));
    expect(codes(s)).toContain("EMPTY_INDEXABLE_PAGE");
    expect(lintSiteSnapshot(s).canPublish).toBe(false);
  });

  it("avertit (sans bloquer) : titre/description hors plage, description absente", () => {
    const s = base(); s.pages[0]!.seo = { title: "Court", ogImageUrl: goodSeo.ogImageUrl };
    const r = lintSiteSnapshot(s);
    expect(r.canPublish).toBe(true);
    expect(codes(s)).toEqual(["TITLE_LENGTH", "DESCRIPTION_MISSING"]);
    s.pages[0]!.seo.description = "trop court";
    expect(codes(s)).toEqual(["TITLE_LENGTH", "DESCRIPTION_LENGTH"]);
  });

  it("avertit : alt manquant sur le visuel du hero, image de partage absente", () => {
    const s = base();
    (s.pages[0]!.blocks[0]!.props as Record<string, unknown>).mediaUrl = "https://media.exemple.com/hero.jpg";
    delete s.pages[0]!.seo.ogImageUrl;
    expect(codes(s)).toEqual(["MISSING_ALT", "MISSING_OG_IMAGE"]);
  });

  it("détecte titres/descriptions en double, pages orphelines et liens cassés", () => {
    const s = base();
    s.pages.push({ id: "p-a", kind: "page", slug: "notre-histoire", title: "Notre histoire", seo: { ...goodSeo, ogImageUrl: undefined }, blocks: [{ id: "t1", type: "text", visible: true, props: { body: "Texte" } }] });
    s.pages[1]!.seo.title = s.pages[0]!.seo.title;
    const c = codes(s);
    expect(c).toContain("DUPLICATE_TITLE");
    expect(c).toContain("DUPLICATE_DESCRIPTION");
    expect(c).toContain("ORPHAN_PAGE");
    // un lien depuis le hero vers la page la rattache ; un lien vers un chemin inconnu est signalé
    const linked = applySiteOperations(s, [{ op: "set_block_props", pageId: "page-home", blockId: "blk-hero", props: { ctaUrl: "/notre-histoire" } }]);
    expect(linked.ok && codes(linked.snapshot)).not.toContain("ORPHAN_PAGE");
    const broken = applySiteOperations(s, [{ op: "set_block_props", pageId: "page-home", blockId: "blk-hero", props: { ctaUrl: "/boutique-inconnue" } }]);
    expect(broken.ok && codes(broken.snapshot)).toContain("BROKEN_INTERNAL_LINK");
    const system = applySiteOperations(s, [{ op: "set_block_props", pageId: "page-home", blockId: "blk-hero", props: { ctaUrl: "/produits" } }]);
    expect(system.ok && codes(system.snapshot)).not.toContain("BROKEN_INTERNAL_LINK");
  });
});
