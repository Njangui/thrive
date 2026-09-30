import { describe, expect, it, vi, beforeEach } from "vitest";

const state: { value: unknown; error: { message: string } | null; calls: number } = { value: null, error: null, calls: 0 };

vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            state.calls++;
            return { data: state.value === null ? null : { value: state.value }, error: state.error };
          },
        }),
      }),
    }),
  }),
}));

import { effectiveEnd, getActivePromo, getPromoPhase, getPromoTrial, resetPromoCache, type PromoTrial } from "./promo-trial-core";

const DAY = 24 * 60 * 60 * 1000;
const start = new Date("2026-10-01T08:00:00.000Z");
const promo = (over: Partial<PromoTrial> = {}): PromoTrial => ({
  startsAt: start.toISOString(),
  endsAt: new Date(start.getTime() + 14 * DAY).toISOString(),
  reminderSentAt: null,
  endNoticeSentAt: null,
  creditsRevertedAt: null,
  stoppedAt: null,
  ...over,
});

beforeEach(() => {
  state.value = null;
  state.error = null;
  state.calls = 0;
  resetPromoCache();
});

describe("getPromoPhase", () => {
  it("aucun essai configuré", () => expect(getPromoPhase(null)).toBe("none"));
  it("programmé avant le début", () => expect(getPromoPhase(promo(), new Date(start.getTime() - 1))).toBe("scheduled"));
  it("actif dès le début et jusqu'à la dernière milliseconde avant la fin", () => {
    expect(getPromoPhase(promo(), start)).toBe("active");
    expect(getPromoPhase(promo(), new Date(start.getTime() + 14 * DAY - 1))).toBe("active");
  });
  it("terminé exactement à la date de fin (fin exclusive) — 14 jours pile", () => {
    expect(getPromoPhase(promo(), new Date(start.getTime() + 14 * DAY))).toBe("ended");
  });
  it("un arrêt manuel raccourcit la fenêtre", () => {
    const stopped = promo({ stoppedAt: new Date(start.getTime() + 2 * DAY).toISOString() });
    expect(effectiveEnd(stopped).getTime()).toBe(start.getTime() + 2 * DAY);
    expect(getPromoPhase(stopped, new Date(start.getTime() + 3 * DAY))).toBe("ended");
  });
  it("un arrêt daté APRÈS la fin ne rallonge jamais l'essai", () => {
    const stopped = promo({ stoppedAt: new Date(start.getTime() + 30 * DAY).toISOString() });
    expect(effectiveEnd(stopped).getTime()).toBe(start.getTime() + 14 * DAY);
  });
});

describe("getPromoTrial / getActivePromo (fail-closed)", () => {
  it("lit la fenêtre stockée", async () => {
    state.value = promo();
    expect((await getPromoTrial())?.startsAt).toBe(start.toISOString());
    expect(await getActivePromo(new Date(start.getTime() + DAY))).not.toBeNull();
    expect(await getActivePromo(new Date(start.getTime() + 15 * DAY))).toBeNull();
  });
  it("erreur de lecture = pas d'essai (jamais d'accès Pro par accident)", async () => {
    state.error = { message: "boom" };
    expect(await getActivePromo()).toBeNull();
  });
  it("valeur mal formée = pas d'essai", async () => {
    state.value = { startsAt: "pas une date", endsAt: 42 };
    expect(await getActivePromo()).toBeNull();
  });
  it("cache court : une seule lecture pour plusieurs contrôles de droits", async () => {
    state.value = promo();
    await getPromoTrial();
    await getPromoTrial();
    await getPromoTrial();
    expect(state.calls).toBe(1);
  });
});
