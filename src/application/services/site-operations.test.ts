import { describe, it, expect } from "vitest";
import { applySiteOperations } from "./site-operations";
import { buildDefaultSiteSnapshot, type DefaultSiteInput } from "./site-default-tree";

const input: DefaultSiteInput = {
  sections: [
    { type: "hero", enabled: true, order: 0 },
    { type: "products", enabled: true, order: 1 },
    { type: "faq", enabled: true, order: 2 },
  ],
  brandColorPrimary: null, brandColorSecondary: null, fontChoice: "modern", visualStyle: "soft",
  heroTitle: "Bienvenue", heroSubtitle: null, ctaLabel: null, ctaUrl: null, secondaryCtaLabel: null,
  heroLayout: null, heroMediaUrl: null, announcement: null, announcementEnabled: true, highlights: null,
  organizationName: "Chez Mado",
};
const site = () => buildDefaultSiteSnapshot(input);

describe("applySiteOperations", () => {
  it("modifie le texte du hero et ne touche pas l'original (pur)", () => {
    const original = site();
    const r = applySiteOperations(original, [
      { op: "set_block_props", pageId: "page-home", blockId: "blk-hero", props: { title: "Nouveau titre", subtitle: "Sous-titre" } },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.snapshot.pages[0]!.blocks[0]!.props).toEqual({ title: "Nouveau titre", subtitle: "Sous-titre" });
      expect(r.changes.length).toBe(1);
    }
    expect(original.pages[0]!.blocks[0]!.props).toEqual({ title: "Bienvenue" });
  });

  it("null supprime une propriété", () => {
    const r = applySiteOperations(site(), [{ op: "set_block_props", pageId: "page-home", blockId: "blk-hero", props: { title: null } }]);
    expect(r.ok && r.snapshot.pages[0]!.blocks[0]!.props).toEqual({});
  });

  it("masque et réordonne des blocs", () => {
    const r = applySiteOperations(site(), [
      { op: "set_block_visible", pageId: "page-home", blockId: "blk-products", visible: false },
      { op: "move_block", pageId: "page-home", blockId: "blk-faq", toIndex: 0 },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.snapshot.pages[0]!.blocks.map((b) => [b.type, b.visible])).toEqual([["faq", true], ["hero", true], ["products", false]]);
  });

  it("modifie le thème (couleur hex stricte) et le SEO de page", () => {
    const ok = applySiteOperations(site(), [
      { op: "set_theme", theme: { brandColorPrimary: "#ff8800", fontChoice: "friendly" } },
      { op: "set_page_seo", pageId: "page-home", seo: { title: "Chez Mado — pâtisserie à Yaoundé", description: "x".repeat(100) } },
    ]);
    expect(ok.ok).toBe(true);
    const bad = applySiteOperations(site(), [{ op: "set_theme", theme: { brandColorPrimary: "rouge" } }]);
    expect(bad.ok).toBe(false);
  });

  it("refuse un lien dangereux et une clé inconnue (aucun HTML/script possible)", () => {
    const link = applySiteOperations(site(), [{ op: "set_block_props", pageId: "page-home", blockId: "blk-hero", props: { ctaUrl: "javascript:alert(1)" } }]);
    expect(link.ok).toBe(false);
    const html = applySiteOperations(site(), [{ op: "set_block_props", pageId: "page-home", blockId: "blk-hero", props: { html: "<script>x</script>" } }]);
    expect(html.ok).toBe(false);
  });

  it("est atomique : une opération invalide n'applique rien et indique son rang", () => {
    const r = applySiteOperations(site(), [
      { op: "set_block_visible", pageId: "page-home", blockId: "blk-faq", visible: false },
      { op: "set_block_visible", pageId: "page-home", blockId: "inexistant", visible: false },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.operationIndex).toBe(1);
  });

  it("rejette une opération inconnue et plus de 50 opérations", () => {
    expect(applySiteOperations(site(), [{ op: "run_script", code: "x" }]).ok).toBe(false);
    const many = Array.from({ length: 51 }, () => ({ op: "set_block_visible", pageId: "page-home", blockId: "blk-faq", visible: true }));
    expect(applySiteOperations(site(), many).ok).toBe(false);
  });

  it("refuse un réglage sans effet : titre sur un bloc de données, texte sur le bloc cta", () => {
    const withCta = buildDefaultSiteSnapshot({ ...input, sections: [...input.sections, { type: "cta", enabled: true, order: 3 }] });
    expect(applySiteOperations(withCta, [{ op: "set_block_props", pageId: "page-home", blockId: "blk-products", props: { title: "Nos gâteaux" } }]).ok).toBe(false);
    expect(applySiteOperations(withCta, [{ op: "set_block_props", pageId: "page-home", blockId: "blk-cta", props: { ctaLabel: "Go" } }]).ok).toBe(false);
  });
});

let counter = 0;
const ids = { newId: () => `t${++counter}` };

describe("ajout / retrait de blocs, pages et menu", () => {
  it("ajoute une section absente à l'accueil, refuse un doublon et un bloc texte", () => {
    const ok = applySiteOperations(site(), [{ op: "add_block", pageId: "page-home", blockType: "gallery", afterBlockId: "blk-hero" }], ids);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.snapshot.pages[0]!.blocks.map((b) => b.type)).toEqual(["hero", "gallery", "products", "faq"]);
    expect(applySiteOperations(site(), [{ op: "add_block", pageId: "page-home", blockType: "faq" }], ids).ok).toBe(false);
    expect(applySiteOperations(site(), [{ op: "add_block", pageId: "page-home", blockType: "text", props: { body: "x" } }], ids).ok).toBe(false);
  });

  it("sur l'accueil on masque, on ne retire pas", () => {
    const r = applySiteOperations(site(), [{ op: "remove_block", pageId: "page-home", blockId: "blk-faq" }], ids);
    expect(r.ok).toBe(false);
  });

  it("crée une page avec texte et menu ; l'accueil et le menu restent cohérents", () => {
    const r = applySiteOperations(site(), [{ op: "add_page", title: "Notre histoire", slug: "notre-histoire", body: "Depuis 2010…", inNavigation: true }], ids);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const page = r.snapshot.pages[1]!;
    expect(page).toMatchObject({ kind: "page", slug: "notre-histoire", title: "Notre histoire" });
    expect(page.blocks.map((b) => b.type)).toEqual(["text"]);
    expect(r.snapshot.navigation).toEqual([{ kind: "page", label: "Notre histoire", pageId: page.id }]);
  });

  it("refuse un slug réservé, un doublon de slug, et un bloc non rendable sur une page", () => {
    expect(applySiteOperations(site(), [{ op: "add_page", title: "X", slug: "produits" }], ids).ok).toBe(false);
    expect(applySiteOperations(site(), [{ op: "add_page", title: "X", slug: "Pas Valide" }], ids).ok).toBe(false);
    const withPage = applySiteOperations(site(), [{ op: "add_page", title: "A", slug: "a-voir" }], ids);
    expect(withPage.ok).toBe(true);
    if (!withPage.ok) return;
    expect(applySiteOperations(withPage.snapshot, [{ op: "add_page", title: "B", slug: "a-voir" }], ids).ok).toBe(false);
    const pageId = withPage.snapshot.pages[1]!.id;
    for (const blockType of ["hero", "cta", "booking"]) {
      expect(applySiteOperations(withPage.snapshot, [{ op: "add_block", pageId, blockType, props: {} }], ids).ok).toBe(false);
    }
    expect(applySiteOperations(withPage.snapshot, [{ op: "add_block", pageId, blockType: "faq" }], ids).ok).toBe(true);
  });

  it("supprime une page et la retire du menu ; l'accueil ne se supprime pas", () => {
    const created = applySiteOperations(site(), [{ op: "add_page", title: "Notre histoire", slug: "notre-histoire", inNavigation: true }], ids);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const pageId = created.snapshot.pages[1]!.id;
    const removed = applySiteOperations(created.snapshot, [{ op: "remove_page", pageId }], ids);
    expect(removed.ok && [removed.snapshot.pages.length, removed.snapshot.navigation.length]).toEqual([1, 0]);
    expect(applySiteOperations(created.snapshot, [{ op: "remove_page", pageId: "page-home" }], ids).ok).toBe(false);
  });

  it("refuse un menu qui pointe vers une page inconnue ou un lien dangereux, accepte un lien sûr", () => {
    expect(applySiteOperations(site(), [{ op: "set_navigation", items: [{ kind: "page", label: "?", pageId: "inconnue" }] }], ids).ok).toBe(false);
    expect(applySiteOperations(site(), [{ op: "set_navigation", items: [{ kind: "link", label: "x", href: "javascript:alert(1)" }] }], ids).ok).toBe(false);
    expect(applySiteOperations(site(), [{ op: "set_navigation", items: [{ kind: "link", label: "WhatsApp", href: "https://wa.me/237600000000" }] }], ids).ok).toBe(true);
  });

  it("refuse plus de 8 entrées de menu", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ kind: "link" as const, label: `L${i}`, href: "/contact" }));
    expect(applySiteOperations(site(), [{ op: "set_navigation", items }], ids).ok).toBe(false);
  });
});
