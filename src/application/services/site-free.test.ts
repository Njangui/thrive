import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { applySiteOperations, SiteOperationSchema } from "./site-operations";
import { buildDefaultSiteSnapshot, type DefaultSiteInput } from "./site-default-tree";
import { lintSiteSnapshot } from "./site-seo-lint";
import { applyPublishedSiteToLandingConfig } from "./site-storefront-bridge";
import { SiteSnapshotSchema, RICH_BLOCK_TYPES, type SiteSnapshot } from "@/domain/entities/site";

const input: DefaultSiteInput = {
  sections: [
    { type: "hero", enabled: true, order: 0 }, { type: "cta", enabled: true, order: 1 }, { type: "products", enabled: true, order: 2 },
    { type: "booking", enabled: true, order: 3 }, { type: "faq", enabled: true, order: 4 },
  ],
  brandColorPrimary: null, brandColorSecondary: null, fontChoice: "modern", visualStyle: "soft",
  heroTitle: "Bienvenue chez Mado", heroSubtitle: "Cuisine maison", ctaLabel: "Commander", ctaUrl: "/produits", secondaryCtaLabel: null,
  heroLayout: "split", heroMediaUrl: "https://img.example.com/a.jpg", heroMediaAlt: "Plat du jour", announcement: null, announcementEnabled: true, highlights: null,
  organizationName: "Chez Mado",
  homeSeo: { title: "Chez Mado — cuisine camerounaise à Douala", description: "Plats maison préparés chaque jour à Douala : ndolé, poulet DG, poisson braisé. Commandez en ligne et faites-vous livrer rapidement." },
};
const base = () => buildDefaultSiteSnapshot(input);
let n = 0;
const newId = () => `t${++n}`;
const ok = (snapshot: SiteSnapshot, ops: unknown[]) => {
  const r = applySiteOperations(snapshot, ops, { newId });
  if (!r.ok) throw new Error(r.error);
  return r.snapshot;
};
const free = () => ok(base(), [{ op: "set_mode", mode: "free" }]);
const HOME = "page-home";

const hero = { type: "rich_hero", props: { title: "Cuisine maison à Douala", subtitle: "Livraison en 45 minutes", primaryCta: { label: "Commander", href: "/produits" } } };

describe("site libre — passage en mode libre", () => {
  it("convertit le hero du gabarit en rich_hero, garde les sections de données et retire cta/booking", () => {
    const s = free();
    expect(s.mode).toBe("free");
    const home = s.pages[0]!;
    expect(home.blocks.map((b) => b.type)).toEqual(["rich_hero", "products", "faq"]);
    const rh = home.blocks[0]!;
    expect(rh.type === "rich_hero" && rh.props).toMatchObject({ title: "Bienvenue chez Mado", subtitle: "Cuisine maison", mediaAlt: "Plat du jour", layout: "split", primaryCta: { label: "Commander", href: "/produits" } });
    expect(SiteSnapshotSchema.safeParse(s).success).toBe(true);
  });

  it("le rapport des changements signale ce qui n'est pas repris", () => {
    const r = applySiteOperations(base(), [{ op: "set_mode", mode: "free" }], { newId });
    expect(r.ok && r.changes[0]).toMatch(/cta, booking/);
  });

  it("est idempotent", () => {
    const once = free();
    expect(ok(once, [{ op: "set_mode", mode: "free" }])).toEqual(once);
  });

  it("on ne repasse pas en gabarit par une opération (le retour se fait par l'historique)", () => {
    expect(SiteOperationSchema.safeParse({ op: "set_mode", mode: "template" }).success).toBe(false);
  });
});

describe("site libre — blocs riches et validation stricte", () => {
  it("un site par gabarit refuse les blocs riches", () => {
    const r = applySiteOperations(base(), [{ op: "add_block", pageId: HOME, blockType: "rich_text", props: { body: "Bonjour" } }], { newId });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/pas disponible/);
  });

  it("compose une page entière en une opération, avec plusieurs blocs du même type", () => {
    const s = ok(free(), [{
      op: "replace_page_blocks", pageId: HOME, blocks: [
        hero,
        { type: "feature_grid", props: { heading: "Pourquoi nous", items: [{ icon: "🍲", title: "Fait maison", text: "Chaque jour" }, { title: "Livraison rapide" }] } },
        { type: "image_text", props: { heading: "Notre histoire", body: "Depuis 2015.", mediaUrl: "https://img.example.com/b.jpg", mediaAlt: "La cuisine" } },
        { type: "stats", props: { items: [{ value: "10 ans", label: "d'expérience" }, { value: "4,8/5", label: "avis clients" }] } },
        { type: "products", props: {} },
        { type: "cta_band", props: { heading: "Faim ?", cta: { label: "Commander", href: "/produits" } } },
        { type: "cta_band", props: { heading: "Une question ?", cta: { label: "Écrire", href: "https://wa.me/237600000000" }, background: "dark" } },
      ],
    }]);
    expect(s.pages[0]!.blocks.map((b) => b.type)).toEqual(["rich_hero", "feature_grid", "image_text", "stats", "products", "cta_band", "cta_band"]);
    expect(new Set(s.pages[0]!.blocks.map((b) => b.id)).size).toBe(7);
  });

  it("refuse les liens dangereux, les médias non https, les clés inconnues et les champs trop longs", () => {
    const bad = (blocks: unknown[]) => applySiteOperations(free(), [{ op: "replace_page_blocks", pageId: HOME, blocks }], { newId });
    expect(bad([{ type: "rich_hero", props: { title: "X", primaryCta: { label: "Go", href: "javascript:alert(1)" } } }]).ok).toBe(false);
    expect(bad([{ type: "rich_hero", props: { title: "X", primaryCta: { label: "Go", href: "//evil.example" } } }]).ok).toBe(false);
    expect(bad([{ type: "rich_hero", props: { title: "X", mediaUrl: "http://img.example.com/a.jpg", mediaAlt: "a" } }]).ok).toBe(false);
    expect(bad([{ type: "rich_hero", props: { title: "X", mediaUrl: "data:image/png;base64,AAAA", mediaAlt: "a" } }]).ok).toBe(false);
    expect(bad([{ type: "rich_text", props: { body: "ok", html: "<script>alert(1)</script>" } }]).ok).toBe(false);
    expect(bad([{ type: "image_text", props: { body: "ok", mediaUrl: "https://i.example.com/a.jpg" } }]).ok).toBe(false); // alt obligatoire
    expect(bad([{ type: "rich_text", props: { body: "x".repeat(5001) } }]).ok).toBe(false);
    expect(bad([{ type: "pricing", props: { plans: [] } }]).ok).toBe(false);
    expect(bad([{ type: "booking", props: {} }]).ok).toBe(false); // bloc du gabarit absent du site libre
  });

  it("le texte contenant du HTML est une simple chaîne (jamais interprétée) : il reste tel quel dans les données", () => {
    const s = ok(free(), [{ op: "add_block", pageId: HOME, blockType: "rich_text", props: { body: "<b>gras</b> <script>x</script>" } }]);
    const b = s.pages[0]!.blocks.at(-1)!;
    expect(b.type === "rich_text" && b.props.body).toBe("<b>gras</b> <script>x</script>");
  });

  it("add_page avec blocs, duplicate_block, remove_block sur l'accueil libre, set_page_slug", () => {
    let s = ok(free(), [
      { op: "add_page", title: "Nos tarifs", slug: "tarifs-traiteur", inNavigation: true, blocks: [hero, { type: "pricing", props: { plans: [{ name: "Midi", price: "3 500 FCFA", features: ["Plat + boisson"] }] } }] },
    ]);
    const page = s.pages.find((p) => p.slug === "tarifs-traiteur")!;
    expect(page.blocks).toHaveLength(2);
    expect(s.navigation).toHaveLength(1);
    s = ok(s, [{ op: "duplicate_block", pageId: page.id, blockId: page.blocks[1]!.id }, { op: "set_page_slug", pageId: page.id, slug: "formules" }]);
    expect(s.pages.find((p) => p.id === page.id)!.blocks).toHaveLength(3);
    expect(s.pages.find((p) => p.id === page.id)!.slug).toBe("formules");
    const homeBlocks = s.pages[0]!.blocks;
    s = ok(s, [{ op: "remove_block", pageId: HOME, blockId: homeBlocks[1]!.id }]);
    expect(s.pages[0]!.blocks).toHaveLength(homeBlocks.length - 1);
    // slug réservé refusé
    expect(applySiteOperations(s, [{ op: "set_page_slug", pageId: page.id, slug: "produits" }], { newId }).ok).toBe(false);
  });

  it("atomique : une opération invalide annule tout le lot", () => {
    const start = free();
    const r = applySiteOperations(start, [
      { op: "add_block", pageId: HOME, blockType: "rich_text", props: { body: "Un" } },
      { op: "add_block", pageId: HOME, blockType: "rich_text", props: { body: "" } },
    ], { newId });
    expect(r.ok).toBe(false);
    expect(start.pages[0]!.blocks.some((b) => b.type === "rich_text")).toBe(false);
  });

  it("plafonds : 40 blocs par page et 30 opérations de l'outil", () => {
    const blocks = Array.from({ length: 41 }, () => ({ type: "divider", props: {} }));
    expect(applySiteOperations(free(), [{ op: "replace_page_blocks", pageId: HOME, blocks }], { newId }).ok).toBe(false);
  });

  it("chaque type de bloc riche accepte un exemple valide minimal", () => {
    const minimal: Record<string, unknown> = {
      rich_hero: { title: "T" }, rich_text: { body: "B" }, feature_grid: { items: [{ title: "A" }] }, image_text: { body: "B", mediaUrl: "https://i.example.com/a.jpg", mediaAlt: "a" },
      steps: { items: [{ title: "1" }, { title: "2" }] }, stats: { items: [{ value: "1", label: "a" }, { value: "2", label: "b" }] },
      pricing: { plans: [{ name: "A", price: "1", features: [] }] }, quotes: { items: [{ quote: "Super", author: "Awa" }] },
      cta_band: { heading: "H", cta: { label: "Go", href: "/contact" } }, faq_list: { items: [{ question: "Q ?", answer: "R" }] },
      image_gallery: { images: [{ url: "https://i.example.com/a.jpg", alt: "a" }] }, divider: {},
    };
    expect(Object.keys(minimal).sort()).toEqual([...RICH_BLOCK_TYPES].sort());
    const s = ok(free(), [{ op: "replace_page_blocks", pageId: HOME, blocks: RICH_BLOCK_TYPES.map((type) => ({ type, props: minimal[type] })) }]);
    expect(s.pages[0]!.blocks).toHaveLength(RICH_BLOCK_TYPES.length);
  });
});

describe("site libre — compatibilité, SEO, pont de rendu", () => {
  it("un ancien instantané (sans `mode`) reste valide et en mode gabarit", () => {
    const s = base();
    expect("mode" in s).toBe(false);
    expect(SiteSnapshotSchema.safeParse(JSON.parse(JSON.stringify(s))).success).toBe(true);
  });

  it("les contraintes du gabarit n'ont pas changé : une section par type sur l'accueil", () => {
    const s = base();
    const dup = structuredClone(s);
    dup.pages[0]!.blocks.push({ ...dup.pages[0]!.blocks[1]!, id: "autre" });
    expect(SiteSnapshotSchema.safeParse(dup).success).toBe(false);
  });

  it("le pont conserve les sections d'origine en site libre (l'accueil est rendu par blocs)", () => {
    const s = free();
    const baseConfig = { organizationId: "o", sections: [{ type: "hero", enabled: true, order: 0 }], paymentMethods: [] } as never;
    const { config } = applyPublishedSiteToLandingConfig(baseConfig, s);
    expect(config.sections).toEqual([{ type: "hero", enabled: true, order: 0 }]);
    expect(config.visualStyle).toBe("soft");
  });

  it("le contrôle SEO suit les blocs riches : H1 unique, alt, liens internes", () => {
    let s = ok(free(), [{ op: "replace_page_blocks", pageId: HOME, blocks: [hero, hero] }]);
    expect(lintSiteSnapshot(s).warnings.map((w) => w.code)).toContain("MULTIPLE_MAIN_HEADINGS");
    s = ok(s, [{ op: "replace_page_blocks", pageId: HOME, blocks: [{ type: "feature_grid", props: { items: [{ title: "A" }] } }] }]);
    expect(lintSiteSnapshot(s).warnings.map((w) => w.code)).toContain("NO_MAIN_HEADING");
    s = ok(s, [{ op: "replace_page_blocks", pageId: HOME, blocks: [{ type: "rich_hero", props: { title: "T", mediaUrl: "https://i.example.com/a.jpg" } }, { type: "cta_band", props: { heading: "H", cta: { label: "Go", href: "/page-fantome" } } }] }]);
    const codes = lintSiteSnapshot(s).warnings.map((w) => w.code);
    expect(codes).toContain("MISSING_ALT");
    expect(codes).toContain("BROKEN_INTERNAL_LINK");
    // un lien interne dans un bloc riche rattache la page (plus orpheline)
    s = ok(s, [{ op: "add_page", title: "Formules", slug: "formules", blocks: [hero] }, { op: "add_block", pageId: HOME, blockType: "cta_band", props: { heading: "Voir", cta: { label: "Formules", href: "/formules" } } }]);
    expect(lintSiteSnapshot(s).warnings.some((w) => w.code === "ORPHAN_PAGE")).toBe(false);
  });

  it("le schéma d'opérations est exportable en JSON Schema pour le modèle", () => {
    const schema = z.toJSONSchema(z.object({ operations: z.array(SiteOperationSchema).min(1).max(30) }));
    expect(JSON.stringify(schema).length).toBeGreaterThan(500);
  });
});

describe("site libre — rendu sûr (garde d'architecture)", () => {
  it("aucun composant de rendu n'injecte du HTML brut ni de script", () => {
    const dir = join(process.cwd(), "src/app/_components/storefront");
    for (const f of ["rich-blocks.tsx", "block-page.tsx"]) {
      const src = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML|innerHTML|<script|eval\(|new Function/);
    }
    expect(readdirSync(dir)).toContain("rich-blocks.tsx");
  });
});
