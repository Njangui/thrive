import { describe, expect, it } from "vitest";
import { applySiteOperations } from "./site-operations";
import { buildDefaultSiteSnapshot } from "./site-default-tree";
import { lintSiteSnapshot } from "./site-seo-lint";
import { SECTOR_TEMPLATES, buildSectorTemplate } from "./site-sector-templates";
import { resolveStorefrontSector, STOREFRONT_BLUEPRINTS } from "@/application/config/storefront-blueprint";
import { resolveIndustryPresetKey, LANDING_PRESETS, LANDING_PRESET_KEYS } from "@/application/config/landing-presets";
import { getIndustryModules, getIndustryUi, INDUSTRY_UI } from "@/application/config/industry-ui";
import { INDUSTRY_MODULE_PRESETS } from "@/application/config/modules";
import { INDUSTRY_CATEGORY_PRESETS } from "@/application/config/categories";
import { LANDING_SECTION_TYPES } from "@/domain/entities/landing";
import { SiteSnapshotSchema } from "@/domain/entities/site";

const base = (name = "Clinique Espoir") => buildDefaultSiteSnapshot({
  sections: [{ type: "hero", enabled: true, order: 0 }, { type: "services", enabled: true, order: 1 }],
  brandColorPrimary: null, brandColorSecondary: null, fontChoice: "modern", visualStyle: "soft", heroTitle: null, heroSubtitle: null, ctaLabel: null, ctaUrl: null,
  secondaryCtaLabel: null, heroLayout: null, heroMediaUrl: null, announcement: null, announcementEnabled: true, highlights: null, organizationName: name,
  homeSeo: { title: `${name} — consultations et rendez-vous à Douala`, description: `${name} : consultations, équipe soignante et prise de rendez-vous en ligne à Douala. Consultez les actes, les horaires et réservez votre créneau.` },
});
let n = 0;
const newId = () => `x${++n}`;

describe("secteurs santé et éducation — configuration", () => {
  it("reconnaît les activités, sans confusion avec les services professionnels ni le commerce", () => {
    for (const v of ["health", "Cabinet médical", "Clinique du Littoral", "dentiste", "Laboratoire d'analyses", "Centre de kinésithérapie"]) expect(resolveStorefrontSector(v), v).toBe("health");
    for (const v of ["education", "Institut de formation professionnelle", "École primaire privée", "Université privée", "Centre de formation", "Académie de langues"]) expect(resolveStorefrontSector(v), v).toBe("education");
    expect(resolveStorefrontSector("Cabinet de conseil juridique")).toBe("professional_services");
    expect(resolveStorefrontSector("Boutique de mode")).toBe("retail");
    expect(resolveStorefrontSector("Salon de coiffure")).toBe("beauty");
  });

  it("chaque secteur a son identité complète et cohérente", () => {
    for (const key of ["health", "education"] as const) {
      const bp = STOREFRONT_BLUEPRINTS[key];
      expect(bp.sector).toBe(key);
      expect(bp.sections[0]).toBe("hero");
      expect(new Set(bp.sections).size).toBe(bp.sections.length);
      bp.sections.forEach((s) => expect(LANDING_SECTION_TYPES).toContain(s));
      expect(bp.sections).toContain("booking");
      expect(bp.highlights.length).toBe(4);
      expect(INDUSTRY_UI[key].catalogLabel).toBe(bp.catalogLabel);
      expect(getIndustryModules(key)).toContain("appointments");
      expect(INDUSTRY_MODULE_PRESETS[key]).toEqual(getIndustryModules(key));
      expect(INDUSTRY_CATEGORY_PRESETS[key]!.length).toBeGreaterThanOrEqual(4);
    }
    expect(getIndustryUi("health").label).toBe("Santé & médecine");
    expect(resolveIndustryPresetKey("health")).toBe("sante");
    expect(resolveIndustryPresetKey("Université")).toBe("education");
    expect(LANDING_PRESET_KEYS).toEqual(expect.arrayContaining(["sante", "education"]));
    expect(LANDING_PRESETS.sante).toEqual(STOREFRONT_BLUEPRINTS.health.sections);
  });

  it("les promesses par défaut ne contiennent aucun chiffre (aucun fait inventé)", () => {
    for (const key of ["health", "education"] as const) {
      const bp = STOREFRONT_BLUEPRINTS[key];
      expect(JSON.stringify([bp.highlights, bp.heroTitle("X"), bp.heroSubtitle("X")])).not.toMatch(/\d/);
    }
  });
});

describe("modèles de site libre — santé et éducation", () => {
  it.each(SECTOR_TEMPLATES)("modèle %s : site valide, publiable, accueil complet et page d'information au menu", (template) => {
    const r = applySiteOperations(base(), [{ op: "apply_sector_template", template }], { newId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(SiteSnapshotSchema.safeParse(r.snapshot).success).toBe(true);
    expect(r.snapshot.mode).toBe("free");
    const home = r.snapshot.pages[0]!;
    const types = home.blocks.map((b) => b.type);
    expect(types[0]).toBe("rich_hero");
    expect(types.filter((t) => t === "rich_hero")).toHaveLength(1);
    expect(types).toEqual(expect.arrayContaining(["services", "team", "faq", "location", "contact", "cta_band", "steps"]));
    expect(r.snapshot.pages).toHaveLength(2);
    expect(r.snapshot.navigation).toHaveLength(1);
    expect(r.snapshot.theme.brandColorPrimary).toBe(STOREFRONT_BLUEPRINTS[template].defaultAccent.primary);
    const lint = lintSiteSnapshot(r.snapshot);
    expect(lint.errors).toEqual([]);
    expect(lint.warnings.map((w) => w.code)).not.toContain("BROKEN_INTERNAL_LINK");
    expect(lint.warnings.map((w) => w.code)).not.toContain("ORPHAN_PAGE");
  });

  it("utilise le nom de l'entreprise, jamais un chiffre, un tarif ou un témoignage écrit en dur", () => {
    for (const template of SECTOR_TEMPLATES) {
      const c = buildSectorTemplate(template, "Clinique Espoir");
      const text = JSON.stringify(c);
      expect(text).toContain("Clinique Espoir");
      const strings: string[] = [];
      const walk = (v: unknown): void => { if (typeof v === "string") strings.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
      walk({ home: c.home, pages: c.pages });
      expect(strings.filter((t) => /\d/.test(t))).toEqual([]);
      expect(c.home.some((b) => b.type === "quotes")).toBe(false);
      expect(c.home.some((b) => b.type === "pricing")).toBe(false);
      expect(c.home.some((b) => b.type === "stats")).toBe(false);
    }
  });

  it("santé : rappelle que le site n'est pas un service d'urgence ; aucune promesse médicale", () => {
    const text = JSON.stringify(buildSectorTemplate("health", "Clinique"));
    expect(text).toMatch(/Urgence médicale/);
    expect(text).toMatch(/ne remplace pas un service d'urgence/);
    expect(text).not.toMatch(/guéri|garanti|sans risque|100 ?%/i);
  });

  it("éducation : aucune promesse d'admission ni de diplôme", () => {
    expect(JSON.stringify(buildSectorTemplate("education", "Institut"))).not.toMatch(/garanti|diplôme garanti|admission assurée|100 ?%|emploi/i);
  });

  it("appliquer deux fois ne duplique pas les pages et respecte la palette choisie par le commerçant", () => {
    let s = applySiteOperations(base(), [{ op: "set_theme", theme: { brandColorPrimary: "#112233", brandColorSecondary: "#445566" } }, { op: "apply_sector_template", template: "health" }], { newId });
    if (!s.ok) throw new Error(s.error);
    const again = applySiteOperations(s.snapshot, [{ op: "apply_sector_template", template: "health" }], { newId });
    if (!again.ok) throw new Error(again.error);
    expect(again.snapshot.pages.filter((p) => p.slug === "infos-patients")).toHaveLength(1);
    expect(again.snapshot.navigation).toHaveLength(1);
    expect(again.snapshot.theme.brandColorPrimary).toBe("#112233");
    s = again;
  });

  it("un modèle inconnu est refusé", () => {
    expect(applySiteOperations(base(), [{ op: "apply_sector_template", template: "casino" }], { newId }).ok).toBe(false);
  });
});
