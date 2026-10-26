import { describe, expect, it, vi } from "vitest";
import { applySiteOperations } from "./site-operations";
import { buildDefaultSiteSnapshot } from "./site-default-tree";
import { lintSiteSnapshot } from "./site-seo-lint";
import { buildPlatformFaqs, buildPlatformSiteBlocks, getPlatformOrgId, isPlatformTenant, PLATFORM_SALES_RULES } from "./platform-tenant";
import { bootstrapPlatformTenant, type PlatformBootstrapDeps } from "./platform-tenant-bootstrap";
import type { PlanSummary } from "./plans-repository";

const ID = "11111111-2222-3333-4444-555555555555";
const plans: PlanSummary[] = [
  { key: "free", name: "Discover", priceFcfa: 0, description: "Pour démarrer." },
  { key: "starter", name: "Starter", priceFcfa: 23456, description: "Pour une entreprise active." },
  { key: "pro", name: "Pro", priceFcfa: 61234, description: null },
];

vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: () => ({}) }));

describe("identification du tenant Flexco", () => {
  it("lit l'identifiant dans l'environnement, rejette une valeur invalide, ne s'applique à aucun autre tenant", () => {
    expect(getPlatformOrgId({})).toBeNull();
    expect(getPlatformOrgId({ FLEXCO_PLATFORM_ORG_ID: "pas-un-uuid" })).toBeNull();
    const env = { FLEXCO_PLATFORM_ORG_ID: ID.toUpperCase() };
    expect(isPlatformTenant(ID, env)).toBe(true);
    expect(isPlatformTenant("99999999-2222-3333-4444-555555555555", env)).toBe(false);
    expect(isPlatformTenant(ID, {})).toBe(false);
  });
  it("la persona interdit d'inventer, de presser, et de demander des secrets", () => {
    const t = PLATFORM_SALES_RULES.join("\n");
    expect(t).toMatch(/N'invente jamais/);
    expect(t).toMatch(/STOP/);
    expect(t).toMatch(/mot de passe/);
    expect(t).toMatch(/commentaire public/);
  });
});

describe("contenus Flexco générés depuis les offres", () => {
  it("les prix viennent des offres passées en paramètre (jamais figés)", () => {
    const faqs = buildPlatformFaqs(plans);
    const tarifs = faqs.find((f) => f.question.includes("tarifs"))!;
    expect(tarifs.answer).toContain("23");
    expect(tarifs.answer).toContain("456 FCFA");
    expect(tarifs.answer).toContain("Discover : gratuit");
    const autres = buildPlatformFaqs([{ ...plans[1]!, priceFcfa: 11111 }]).find((f) => f.question.includes("tarifs"))!;
    expect(autres.answer).toContain("11");
    expect(autres.answer).not.toContain("456");
  });
  it("sans offre lisible, n'affirme aucun prix ni essai gratuit", () => {
    const faqs = buildPlatformFaqs([]);
    expect(faqs.some((f) => /\d\s?FCFA/.test(f.answer))).toBe(false);
    expect(faqs.some((f) => f.question.includes("gratuitement"))).toBe(false);
    expect(buildPlatformSiteBlocks([], faqs).some((b) => b.type === "pricing")).toBe(false);
  });
  it("le site généré est accepté par le schéma du site libre et le lint ne bloque pas", () => {
    const snapshot = buildDefaultSiteSnapshot({
      sections: [{ type: "hero", enabled: true, order: 0 }], brandColorPrimary: null, brandColorSecondary: null, fontChoice: "modern", visualStyle: "soft",
      heroTitle: null, heroSubtitle: null, ctaLabel: null, ctaUrl: null, secondaryCtaLabel: null, heroLayout: null, heroMediaUrl: null, announcement: null,
      announcementEnabled: true, highlights: null, organizationName: "Flexco",
      homeSeo: { title: "Flexco — gérez votre activité au même endroit", description: "Flexco rassemble catalogue, site, WhatsApp, réseaux sociaux, clients et finances pour les entreprises africaines. Créez votre compte gratuit." },
    });
    const home = snapshot.pages.find((p) => p.kind === "home")!;
    const blocks = buildPlatformSiteBlocks(plans, buildPlatformFaqs(plans));
    const res = applySiteOperations(snapshot, [{ op: "set_mode", mode: "free" }, { op: "replace_page_blocks", pageId: home.id, blocks }]);
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (res.ok) {
      const pricing = res.snapshot.pages[0]!.blocks.find((b) => b.type === "pricing")!;
      expect(JSON.stringify(pricing.props)).toContain("Gratuit");
      expect(lintSiteSnapshot(res.snapshot).issues.filter((i) => i.severity === "error")).toEqual([]);
    }
  });
  it("aucun témoignage ni statistique inventé", () => {
    const types = buildPlatformSiteBlocks(plans, buildPlatformFaqs(plans)).map((b) => b.type);
    expect(types).not.toContain("quotes");
    expect(types).not.toContain("stats");
  });
});

describe("bootstrap idempotent", () => {
  function fakeDeps() {
    const faqs = new Map<string, string>();
    let nextId = 0;
    const composeHome = vi.fn(async () => ({ changes: ["Accueil recomposé"] }));
    const deps: PlatformBootstrapDeps = {
      loadPlans: async () => plans,
      listFaqQuestions: async () => [...faqs.entries()].map(([question, id]) => ({ id, question })),
      insertFaq: async (_o, f) => { faqs.set(f.question, `f${++nextId}`); },
      updateFaq: async () => {},
      composeHome,
    };
    return { deps, faqs, composeHome };
  }
  it("deuxième exécution : aucune FAQ en double, tout est mis à jour", async () => {
    const { deps, faqs, composeHome } = fakeDeps();
    const first = await bootstrapPlatformTenant(ID, "u1", deps);
    const count = faqs.size;
    const second = await bootstrapPlatformTenant(ID, "u1", deps);
    expect(first.faqCreated).toBe(count);
    expect(second.faqCreated).toBe(0);
    expect(second.faqUpdated).toBe(count);
    expect(faqs.size).toBe(count);
    expect(composeHome).toHaveBeenCalledTimes(2);
    expect(first.plansUsed).toBe(3);
  });
});
