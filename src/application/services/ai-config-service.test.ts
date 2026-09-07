import { describe, it, expect, vi, beforeEach } from "vitest";

const tableResults = new Map<string, { data: unknown; error: unknown }>();
const updateCalls: { table: string; patch: unknown }[] = [];

function makeBuilder(table: string) {
  const resultFor = () => tableResults.get(table) ?? { data: null, error: null };
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    update: vi.fn((patch: unknown) => {
      updateCalls.push({ table, patch });
      return builder;
    }),
    maybeSingle: vi.fn(async () => resultFor()),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(resultFor()).then(resolve, reject),
  };
  return builder;
}

const mockFrom = vi.fn((table: string) => makeBuilder(table));

vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import { getAiConfig, updateAiConfig } from "./ai-config-service";

const BASE_ROW = {
  organization_id: "org-1",
  enabled: true,
  provider: "mistral",
  fallback_provider: null,
  model: "mistral-small-latest",
  tone: "professionnel et chaleureux",
  language: "fr",
  objectives: ["vendre plus"],
  max_tokens: 512,
  temperature: "0.40",
  updated_at: "2026-08-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  tableResults.clear();
  updateCalls.length = 0;
});

describe("getAiConfig", () => {
  it("mappe correctement une ligne existante (dont temperature: string -> number)", async () => {
    tableResults.set("ai_config", { data: BASE_ROW, error: null });

    const config = await getAiConfig("org-1");

    expect(config.provider).toBe("mistral");
    expect(config.temperature).toBe(0.4);
    expect(config.objectives).toEqual(["vendre plus"]);
  });

  it("lève NotFoundError si aucune ligne n'existe", async () => {
    tableResults.set("ai_config", { data: null, error: null });
    await expect(getAiConfig("org-1")).rejects.toThrow(/introuvable/i);
  });
});

const VALID_INPUT = {
  enabled: true,
  provider: "mistral",
  fallbackProvider: null as string | null,
  tone: "direct et efficace",
  language: "fr",
  objectives: ["obj 1", "obj 2"],
  maxTokens: 512,
  temperature: 0.5,
};

describe("updateAiConfig — validation contre AI_PROVIDER_NAMES (registry.ts), jamais une valeur arbitraire", () => {
  it("refuse un provider inconnu, sans toucher la base", async () => {
    await expect(updateAiConfig("org-1", { ...VALID_INPUT, provider: "gemini" }, "user-1")).rejects.toThrow(
      /inconnu/,
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("refuse un fallback provider inconnu", async () => {
    await expect(
      updateAiConfig("org-1", { ...VALID_INPUT, fallbackProvider: "gemini" }, "user-1"),
    ).rejects.toThrow(/secours/);
  });

  it("refuse un fallback identique au provider principal", async () => {
    await expect(
      updateAiConfig("org-1", { ...VALID_INPUT, provider: "claude", fallbackProvider: "claude" }, "user-1"),
    ).rejects.toThrow(/différents/);
  });

  it("refuse une température hors de [0, 1]", async () => {
    await expect(updateAiConfig("org-1", { ...VALID_INPUT, temperature: 1.5 }, "user-1")).rejects.toThrow(
      /créativité/i,
    );
  });

  it("refuse une longueur maximale hors de [128, 2048]", async () => {
    await expect(updateAiConfig("org-1", { ...VALID_INPUT, maxTokens: 50 }, "user-1")).rejects.toThrow(
      /longueur maximale/i,
    );
  });

  it("dérive le modèle depuis le provider (jamais un champ libre) et plafonne les objectifs à 10", async () => {
    tableResults.set("ai_config", { data: { ...BASE_ROW, provider: "claude", model: "claude-sonnet-5" }, error: null });

    await updateAiConfig(
      "org-1",
      { ...VALID_INPUT, provider: "claude", objectives: Array.from({ length: 15 }, (_, i) => `objectif ${i}`) },
      "user-1",
    );

    const update = updateCalls.find((c) => c.table === "ai_config");
    expect(update).toBeDefined();
    const patch = update!.patch as { model: string; objectives: string[] };
    expect(patch.model).toBe("claude-sonnet-5");
    expect(patch.objectives).toHaveLength(10);
  });
});
