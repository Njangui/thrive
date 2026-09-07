import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import { getLandingConfig, updateLandingConfig } from "./landing-config-service";
import { LANDING_PRESETS } from "@/application/config/landing-presets";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getLandingConfig — sans ligne organization_landing_config existante", () => {
  it("calcule (sans persister) le preset du secteur transmis via knownIndustry, sans requêter organizations", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "organization_landing_config") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        };
      }
      throw new Error(`table inattendue: ${table}`);
    });

    const config = await getLandingConfig("org-1", "Salon de coiffure");

    expect(config.isCustomized).toBe(false);
    expect(config.sections.map((s) => s.type)).toEqual(LANDING_PRESETS.salon);
    expect(config.brandColorPrimary).toBeNull();
    expect(config.brandColorSecondary).toBeNull();
    expect(config.fontChoice).toBe("modern");
    // "vérifiable sans qu'aucune ligne organization_landing_config n'existe
    // encore pour elle" (critère d'acceptation Lot K) — une seule table
    // interrogée ici (organization_landing_config), jamais "organizations"
    // puisque l'industry était déjà connue de l'appelant.
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith("organization_landing_config");
  });

  it("relit organizations.industry quand knownIndustry est omis (ex: appelé depuis /dashboard/site)", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "organization_landing_config") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        };
      }
      if (table === "organizations") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { industry: "restaurant" }, error: null }) }) }),
        };
      }
      throw new Error(`table inattendue: ${table}`);
    });

    const config = await getLandingConfig("org-1");

    expect(config.isCustomized).toBe(false);
    expect(config.sections.map((s) => s.type)).toEqual(LANDING_PRESETS.restaurant);
    expect(mockFrom).toHaveBeenCalledWith("organizations");
  });

  it("secteur inconnu -> preset default, ne lève jamais", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "organization_landing_config") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        };
      }
      throw new Error(`table inattendue: ${table}`);
    });

    const config = await getLandingConfig("org-1", "Fabrication de meubles");
    expect(config.sections.map((s) => s.type)).toEqual(LANDING_PRESETS.default);
  });
});

describe("getLandingConfig — avec une ligne organization_landing_config existante", () => {
  it("retourne la configuration persistée, triée par order, isCustomized=true", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "organization_landing_config") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    sections: [
                      { type: "contact", enabled: true, order: 1 },
                      { type: "hero", enabled: true, order: 0 },
                      { type: "products", enabled: false, order: 2 },
                    ],
                    brand_color_primary: "#ff0000",
                    brand_color_secondary: "#00ff00",
                    font_choice: "classic",
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      throw new Error(`table inattendue: ${table}`);
    });

    const config = await getLandingConfig("org-1", "salon");

    expect(config.isCustomized).toBe(true);
    expect(config.sections.map((s) => s.type)).toEqual(["hero", "contact", "products"]);
    expect(config.sections.find((s) => s.type === "products")?.enabled).toBe(false);
    expect(config.brandColorPrimary).toBe("#ff0000");
    expect(config.brandColorSecondary).toBe("#00ff00");
    expect(config.fontChoice).toBe("classic");
    // Une ligne persistée existe : ne doit jamais retomber sur le calcul
    // de preset (pas de requête organizations ici).
    expect(mockFrom).not.toHaveBeenCalledWith("organizations");
  });

  it("font_choice NULL en base -> repli 'modern'", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "organization_landing_config") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    sections: [{ type: "hero", enabled: true, order: 0 }],
                    brand_color_primary: null,
                    brand_color_secondary: null,
                    font_choice: null,
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      throw new Error(`table inattendue: ${table}`);
    });

    const config = await getLandingConfig("org-1", "boutique");
    expect(config.fontChoice).toBe("modern");
  });

  it("jsonb corrompu/vide inattendu -> repli défensif sur le preset du secteur (jamais de rendu cassé)", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "organization_landing_config") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { sections: [], brand_color_primary: null, brand_color_secondary: null, font_choice: null },
                  error: null,
                }),
            }),
          }),
        };
      }
      throw new Error(`table inattendue: ${table}`);
    });

    const config = await getLandingConfig("org-1", "restaurant");
    expect(config.isCustomized).toBe(false);
    expect(config.sections.map((s) => s.type)).toEqual(LANDING_PRESETS.restaurant);
  });
});

describe("updateLandingConfig — validation", () => {
  it("rejette un type de section inconnu", async () => {
    await expect(
      updateLandingConfig("org-1", {
        sections: [{ type: "not_a_real_type" as never, enabled: true, order: 0 }],
      }),
    ).rejects.toThrow(/inconnu/);
  });

  it("rejette deux sections avec le même ordre", async () => {
    await expect(
      updateLandingConfig("org-1", {
        sections: [
          { type: "hero", enabled: true, order: 0 },
          { type: "contact", enabled: true, order: 0 },
        ],
      }),
    ).rejects.toThrow(/ordre/);
  });

  it("rejette une couleur non-hex", async () => {
    await expect(
      updateLandingConfig("org-1", {
        sections: [{ type: "hero", enabled: true, order: 0 }],
        brandColorPrimary: "red",
      }),
    ).rejects.toThrow(/[Cc]ouleur/);
  });

  it("rejette un tableau de sections vide", async () => {
    await expect(updateLandingConfig("org-1", { sections: [] })).rejects.toThrow(/section/);
  });

  it("accepte une configuration valide et upsert", async () => {
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockReturnValue({ upsert });

    await updateLandingConfig("org-1", {
      sections: [
        { type: "hero", enabled: true, order: 0 },
        { type: "contact", enabled: false, order: 1 },
      ],
      brandColorPrimary: "#123abc",
      fontChoice: "friendly",
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "org-1",
        brand_color_primary: "#123abc",
        brand_color_secondary: null,
        font_choice: "friendly",
      }),
    );
  });
});
