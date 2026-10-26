import { describe, it, expect } from "vitest";
import { applyPublishedNavigation, applyPublishedSiteToLandingConfig, resolveHomeSeoOverride } from "./site-storefront-bridge";
import { buildDefaultSiteSnapshot, type DefaultSiteInput } from "./site-default-tree";
import { applySiteOperations } from "./site-operations";
import { SiteSnapshotSchema } from "@/domain/entities/site";
import type { LandingConfig } from "./landing-config-service";

const config: LandingConfig = {
  organizationId: "org-1",
  sections: [
    { type: "hero", enabled: true, order: 0 },
    { type: "about", enabled: false, order: 1 },
    { type: "products", enabled: true, order: 2 },
    { type: "testimonials", enabled: true, order: 3 },
    { type: "contact", enabled: true, order: 4 },
  ],
  brandColorPrimary: "#112233", brandColorSecondary: "#445566", fontChoice: "classic", visualStyle: "bold",
  heroTitle: "Bienvenue", heroSubtitle: "Le goût du Cameroun", ctaLabel: "Commander", ctaUrl: "/produits",
  announcement: "Livraison offerte", announcementEnabled: true, heroLayout: "split",
  heroMediaUrl: "https://media.exemple.com/h.jpg", highlights: [{ icon: "truck", title: "Livraison", subtitle: "Partout" }],
  secondaryCtaLabel: "Nous écrire", secondaryCtaUrl: "/contact", paymentMethods: ["mtn"], showStats: false, isCustomized: true,
};
const toInput = (c: LandingConfig): DefaultSiteInput => ({ ...c, organizationName: "Chez Mado" });

describe("pont : parité de rendu avec la config d'origine (aller-retour)", () => {
  const snapshot = buildDefaultSiteSnapshot(toInput(config));
  const { config: back, unrenderedBlocks } = applyPublishedSiteToLandingConfig(config, snapshot);

  it("config -> snapshot -> config redonne les mêmes sections, dans le même ordre, avec les mêmes visibilités", () => {
    expect(back.sections.map((s) => [s.type, s.enabled])).toEqual(config.sections.map((s) => [s.type, s.enabled]));
    expect(unrenderedBlocks).toBe(0);
  });

  it("reprend hero, thème, annonce et promesses à l'identique", () => {
    for (const key of [
      "brandColorPrimary", "brandColorSecondary", "fontChoice", "visualStyle", "heroTitle", "heroSubtitle", "ctaLabel", "ctaUrl",
      "secondaryCtaLabel", "secondaryCtaUrl", "heroLayout", "heroMediaUrl", "announcement", "announcementEnabled", "highlights",
    ] as const) {
      expect(back[key]).toEqual(config[key]);
    }
  });

  it("conserve les champs que le site ne pilote pas (paiements, stats, organisation)", () => {
    expect(back.paymentMethods).toEqual(config.paymentMethods);
    expect(back.showStats).toBe(false);
    expect(back.organizationId).toBe("org-1");
  });
});

describe("pont : une édition publiée change le rendu", () => {
  it("masque, réordonne et retitre via des opérations", () => {
    const snap = buildDefaultSiteSnapshot(toInput(config));
    const r = applySiteOperations(snap, [
      { op: "set_block_visible", pageId: "page-home", blockId: "blk-products", visible: false },
      { op: "move_block", pageId: "page-home", blockId: "blk-contact", toIndex: 1 },
      { op: "set_block_props", pageId: "page-home", blockId: "blk-hero", props: { title: "Nouveau titre", mediaUrl: null } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { config: out } = applyPublishedSiteToLandingConfig(config, r.snapshot);
    expect(out.sections.map((s) => [s.type, s.enabled])).toEqual([
      ["hero", true], ["contact", true], ["about", false], ["products", false], ["testimonials", true],
    ]);
    expect(out.heroTitle).toBe("Nouveau titre");
    expect(out.heroMediaUrl).toBeNull();
  });

  it("le schéma interdit `text` sur l'accueil (les gabarits sectoriels ne peuvent pas l'intercaler) : rien n'est enregistré sans être rendu", () => {
    const snap = buildDefaultSiteSnapshot(toInput(config));
    snap.pages[0]!.blocks.push({ id: "t1", type: "text", visible: true, props: { body: "Notre histoire" } });
    expect(SiteSnapshotSchema.safeParse(snap).success).toBe(false);
  });
});

describe("resolveHomeSeoOverride", () => {
  it("lit titre, description, image et noindex ; absent = pas de surcharge", () => {
    const snap = buildDefaultSiteSnapshot({ ...toInput(config), homeSeo: { title: "T", description: "D", ogImageUrl: "https://m.exemple.com/o.jpg" } });
    expect(resolveHomeSeoOverride(snap)).toEqual({ title: "T", description: "D", ogImageUrl: "https://m.exemple.com/o.jpg", noindex: false });
    const empty = buildDefaultSiteSnapshot(toInput(config));
    expect(resolveHomeSeoOverride(empty)).toEqual({ title: undefined, description: undefined, ogImageUrl: undefined, noindex: false });
    empty.pages[0]!.seo.noindex = true;
    expect(resolveHomeSeoOverride(empty).noindex).toBe(true);
  });
});

describe("applyPublishedNavigation : le site AJOUTE au menu du produit, il ne le remplace pas", () => {
  const base = [
    { key: "home", label: "Accueil", href: "/" },
    { key: "catalog", label: "Produits", href: "/produits" },
    { key: "contact", label: "Contact", href: "/contact" },
  ];
  const withPage = () => {
    const snap = buildDefaultSiteSnapshot(toInput(config));
    snap.pages.push({ id: "p1", kind: "page", slug: "notre-histoire", title: "Notre histoire", seo: {}, blocks: [] });
    return snap;
  };

  it("sans entrée de menu : menu inchangé", () => {
    expect(applyPublishedNavigation(base, buildDefaultSiteSnapshot(toInput(config)))).toEqual(base);
  });

  it("ajoute page et lien avant « Contact », qui reste en dernier", () => {
    const snap = withPage();
    snap.navigation = [{ kind: "page", label: "Notre histoire", pageId: "p1" }, { kind: "link", label: "WhatsApp", href: "https://wa.me/237600000000" }];
    expect(applyPublishedNavigation(base, snap).map((e) => [e.label, e.href])).toEqual([
      ["Accueil", "/"], ["Produits", "/produits"], ["Notre histoire", "/notre-histoire"], ["WhatsApp", "https://wa.me/237600000000"], ["Contact", "/contact"],
    ]);
  });

  it("ignore une entrée vers une page disparue (pas de lien mort)", () => {
    const snap = withPage();
    snap.navigation = [{ kind: "page", label: "Fantôme", pageId: "inconnue" }];
    expect(applyPublishedNavigation(base, snap)).toEqual(base);
  });
});
