import { describe, it, expect } from "vitest";
import { buildDefaultSiteSnapshot, type DefaultSiteInput } from "./site-default-tree";
import { SiteSnapshotSchema, PageSchema, isSafeLink, BlockSchema } from "@/domain/entities/site";

const base: DefaultSiteInput = {
  sections: [
    { type: "faq", enabled: true, order: 3 },
    { type: "hero", enabled: true, order: 0 },
    { type: "products", enabled: true, order: 1 },
    { type: "gallery", enabled: false, order: 2 },
  ],
  brandColorPrimary: "#112233",
  brandColorSecondary: null,
  fontChoice: "classic",
  visualStyle: "bold",
  heroTitle: "Bienvenue",
  heroSubtitle: null,
  ctaLabel: "Commander",
  ctaUrl: "/produits",
  secondaryCtaLabel: null,
  heroLayout: null,
  heroMediaUrl: "http://pas-https.example/img.png",
  announcement: "Livraison offerte",
  announcementEnabled: true,
  highlights: null,
  organizationName: "Chez Mado",
};

describe("buildDefaultSiteSnapshot (compatibilité tenants existants)", () => {
  const snapshot = buildDefaultSiteSnapshot(base);

  it("produit un instantané valide au sens du schéma strict", () => {
    expect(SiteSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("garde l'ordre des sections et conserve les sections désactivées (visible=false)", () => {
    const blocks = snapshot.pages[0]!.blocks;
    expect(blocks.map((b) => [b.type, b.visible])).toEqual([
      ["hero", true],
      ["products", true],
      ["gallery", false],
      ["faq", true],
    ]);
  });

  it("reporte le contenu du hero et écarte média non https / lien non sûr", () => {
    const hero = snapshot.pages[0]!.blocks[0]!;
    expect(hero.props).toEqual({ title: "Bienvenue", ctaLabel: "Commander", ctaUrl: "/produits" });
    const unsafe = buildDefaultSiteSnapshot({ ...base, ctaUrl: "javascript:alert(1)" });
    expect(unsafe.pages[0]!.blocks[0]!.props).not.toHaveProperty("ctaUrl");
  });

  it("reporte thème, annonce, et laisse la navigation vide (navigation actuelle conservée)", () => {
    expect(snapshot.theme).toEqual({ brandColorPrimary: "#112233", brandColorSecondary: null, fontChoice: "classic", visualStyle: "bold" });
    expect(snapshot.announcement).toEqual({ text: "Livraison offerte", enabled: true });
    expect(snapshot.navigation).toEqual([]);
    expect(snapshot.pages[0]).toMatchObject({ kind: "home", slug: "", title: "Chez Mado" });
  });
});

describe("SiteSnapshotSchema (l'agent ne modifie que des données)", () => {
  const valid = () => structuredClone(buildDefaultSiteSnapshot(base));

  it("rejette une clé inconnue dans un bloc (pas de HTML/script déguisé)", () => {
    const s = valid();
    (s.pages[0]!.blocks[0]!.props as Record<string, unknown>).html = "<script>alert(1)</script>";
    expect(SiteSnapshotSchema.safeParse(s).success).toBe(false);
  });

  it("rejette un type de bloc inconnu", () => {
    expect(BlockSchema.safeParse({ id: "x", type: "iframe", visible: true, props: {} }).success).toBe(false);
  });

  it("rejette les liens dangereux", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "http://non-https.example", "/a b"]) {
      expect(isSafeLink(bad)).toBe(false);
    }
    for (const good of ["/contact", "https://wa.me/237600000000"]) expect(isSafeLink(good)).toBe(true);
  });

  it("exige exactement un accueil, des slugs uniques et non réservés", () => {
    const s = valid();
    s.pages.push({ id: "p2", kind: "page", slug: "produits", title: "X", seo: {}, blocks: [] });
    expect(SiteSnapshotSchema.safeParse(s).success).toBe(false); // slug réservé
    s.pages[1]!.slug = "notre-histoire";
    expect(SiteSnapshotSchema.safeParse(s).success).toBe(true);
    s.pages.push({ id: "p3", kind: "page", slug: "notre-histoire", title: "Y", seo: {}, blocks: [] });
    expect(SiteSnapshotSchema.safeParse(s).success).toBe(false); // doublon
  });

  it("refuse deux accueils et une navigation vers une page inconnue", () => {
    const two = valid();
    two.pages.push({ id: "h2", kind: "home", slug: "", title: "Bis", seo: {}, blocks: [] });
    expect(SiteSnapshotSchema.safeParse(two).success).toBe(false);
    const nav = valid();
    nav.navigation.push({ kind: "page", label: "Fantôme", pageId: "inconnue" });
    expect(SiteSnapshotSchema.safeParse(nav).success).toBe(false);
  });

  it("refuse des identifiants de bloc en double dans une page", () => {
    const page = valid().pages[0]!;
    page.blocks.push({ ...page.blocks[0]! });
    expect(PageSchema.safeParse(page).success).toBe(false);
  });
});
