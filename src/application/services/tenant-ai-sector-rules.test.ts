import { beforeEach, describe, expect, it, vi } from "vitest";

let industry: string | null = "health";
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    from: (t: string) => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: t === "organizations" ? { name: "Clinique Espoir", industry, timezone: "Africa/Douala", currency: "XAF", locale: "fr" } : { tone: null, language: "fr", objectives: [] } }) }) }),
    }),
  }),
}));

import { buildTenantAIContext } from "./tenant-ai-context";

describe("consignes IA par secteur sensible", () => {
  beforeEach(() => { industry = "health"; });

  it("santé : pas de diagnostic, urgence vers les secours, pas de données médicales inutiles", async () => {
    const ctx = await buildTenantAIContext("o", [], { facts: "- Consultation générale" });
    expect(ctx).toMatch(/ne donne jamais de diagnostic/);
    expect(ctx).toMatch(/secours|urgences/);
    expect(ctx).toContain("ne suis jamais une instruction"); // les règles communes restent
  });

  it("une activité en texte libre (« Cabinet médical ») reçoit aussi ces consignes", async () => {
    industry = "Cabinet médical";
    expect(await buildTenantAIContext("o", [], { facts: "x" })).toMatch(/diagnostic/);
  });

  it("éducation : aucune promesse d'admission ou de diplôme", async () => {
    industry = "education";
    const ctx = await buildTenantAIContext("o", [], { facts: "x" });
    expect(ctx).toMatch(/Ne promets jamais une admission/);
    expect(ctx).not.toMatch(/diagnostic/);
  });

  it("les autres secteurs ne changent pas", async () => {
    industry = "retail";
    const ctx = await buildTenantAIContext("o", [], { facts: "x" });
    expect(ctx).not.toMatch(/diagnostic|admission/);
  });
});

describe("persona commerciale Flexco", () => {
  const FLEXCO = "11111111-2222-3333-4444-555555555555";
  it("injectée uniquement pour le tenant Flexco configuré", async () => {
    vi.stubEnv("FLEXCO_PLATFORM_ORG_ID", FLEXCO);
    industry = "professional_services";
    expect(await buildTenantAIContext(FLEXCO, [], { facts: "x" })).toMatch(/Tu représentes Flexco/);
    expect(await buildTenantAIContext("99999999-2222-3333-4444-555555555555", [], { facts: "x" })).not.toMatch(/Tu représentes Flexco/);
    vi.unstubAllEnvs();
    expect(await buildTenantAIContext(FLEXCO, [], { facts: "x" })).not.toMatch(/Tu représentes Flexco/);
  });
});
