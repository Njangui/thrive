import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import { trackEvent, getAnalyticsSummary, ANALYTICS_EVENT_TYPES } from "./analytics-service";

/**
 * Même fabrique de client Supabase minimal que ai-credits-service.test.ts /
 * marketing-service.test.ts : chaque table renvoie toujours le même
 * résultat pour n'importe quel appel terminal.
 */
function configureSupabase(result: { data?: unknown; error?: { message: string } | null }) {
  mockFrom.mockImplementation(() => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      insert: () => Promise.resolve(result),
      then: (onFulfilled: (v: typeof result) => unknown) => Promise.resolve(result).then(onFulfilled),
    };
    return builder;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("trackEvent", () => {
  it("insère l'événement avec les bons champs", async () => {
    configureSupabase({ data: null, error: null });

    await trackEvent("org-1", "product_view", "product", "prod-1", { foo: "bar" });

    expect(mockFrom).toHaveBeenCalledWith("analytics_events");
  });

  it("ne lève jamais si l'insertion échoue (DB down, table absente...)", async () => {
    configureSupabase({ data: null, error: { message: "relation \"analytics_events\" does not exist" } });

    await expect(trackEvent("org-1", "page_view")).resolves.toBeUndefined();
  });

  it("ne lève jamais même si le client Supabase explose entièrement", async () => {
    mockFrom.mockImplementation(() => {
      throw new Error("connexion perdue");
    });

    await expect(trackEvent("org-1", "cta_click", "cta", undefined, { ctaId: "whatsapp" })).resolves.toBeUndefined();
  });

  it("ne tente aucun accès DB si organizationId est vide (rien à tracker)", async () => {
    configureSupabase({ data: null, error: null });

    await trackEvent("", "page_view");

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("accepte les paramètres optionnels omis (entityType/entityId/metadata)", async () => {
    configureSupabase({ data: null, error: null });

    await expect(trackEvent("org-1", "lead_created")).resolves.toBeUndefined();
  });
});

describe("getAnalyticsSummary", () => {
  it("agrège correctement les compteurs par event_type", async () => {
    configureSupabase({
      data: [
        { event_type: "page_view" },
        { event_type: "page_view" },
        { event_type: "product_view" },
        { event_type: "cta_click" },
      ],
      error: null,
    });

    const summary = await getAnalyticsSummary("org-1", 30);

    expect(summary.counts.page_view).toBe(2);
    expect(summary.counts.product_view).toBe(1);
    expect(summary.counts.cta_click).toBe(1);
    expect(summary.counts.order_created).toBe(0);
    expect(summary.totalEvents).toBe(4);
    expect(summary.sinceDays).toBe(30);
  });

  it("retourne un résultat à zéro sur les 8 types connus si analytics_events est vide — jamais d'exception", async () => {
    configureSupabase({ data: [], error: null });

    const summary = await getAnalyticsSummary("org-nouveau");

    for (const type of ANALYTICS_EVENT_TYPES) {
      expect(summary.counts[type]).toBe(0);
    }
    expect(summary.totalEvents).toBe(0);
  });

  it("retourne un résultat à zéro (jamais d'exception) si la lecture DB échoue", async () => {
    configureSupabase({ data: null, error: { message: "timeout" } });

    const summary = await getAnalyticsSummary("org-1");

    expect(summary.totalEvents).toBe(0);
    expect(summary.counts.page_view).toBe(0);
  });

  it("retourne un résultat à zéro (jamais d'exception) si le client Supabase explose", async () => {
    mockFrom.mockImplementation(() => {
      throw new Error("connexion perdue");
    });

    const summary = await getAnalyticsSummary("org-1");

    expect(summary.totalEvents).toBe(0);
  });

  it("ignore silencieusement un event_type inconnu plutôt que de planter l'agrégation", async () => {
    configureSupabase({
      data: [{ event_type: "page_view" }, { event_type: "un_type_qui_n_existe_pas_encore" }],
      error: null,
    });

    const summary = await getAnalyticsSummary("org-1");

    expect(summary.counts.page_view).toBe(1);
    expect(summary.totalEvents).toBe(1);
  });

  it("utilise sinceDays=30 par défaut", async () => {
    configureSupabase({ data: [], error: null });

    const summary = await getAnalyticsSummary("org-1");

    expect(summary.sinceDays).toBe(30);
  });
});
