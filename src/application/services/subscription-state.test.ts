import { describe, expect, it } from "vitest";
import { effectivePlanKey, GRACE_DAYS, graceEndsAt } from "./subscription-state";

const NOW = new Date("2026-11-10T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const sub = (over: Partial<Parameters<typeof effectivePlanKey>[0]>) => ({ planKey: "pro", status: "active", currentPeriodEnd: null, trialEnd: null, ...over });

describe("effectivePlanKey (grâce de 3 jours)", () => {
  it("la grâce est de 3 jours", () => expect(GRACE_DAYS).toBe(3));
  it("plan gratuit : toujours free", () => expect(effectivePlanKey(sub({ planKey: "free", status: "past_due", currentPeriodEnd: daysAgo(30) }), NOW)).toBe("free"));
  it("actif et dans la période : droits conservés", () => expect(effectivePlanKey(sub({ currentPeriodEnd: daysAgo(-5) }), NOW)).toBe("pro"));
  it("impayé depuis 2 jours : encore dans la grâce", () => expect(effectivePlanKey(sub({ status: "past_due", currentPeriodEnd: daysAgo(2) }), NOW)).toBe("pro"));
  it("impayé depuis 4 jours : rétrogradé", () => expect(effectivePlanKey(sub({ status: "past_due", currentPeriodEnd: daysAgo(4) }), NOW)).toBe("free"));
  it("actif mais échéance dépassée de 4 jours sans traitement du cron : rétrogradé", () => expect(effectivePlanKey(sub({ currentPeriodEnd: daysAgo(4) }), NOW)).toBe("free"));
  it("résilié : droits jusqu'à la fin de la période payée, sans grâce", () => {
    expect(effectivePlanKey(sub({ status: "cancelled", currentPeriodEnd: daysAgo(-2) }), NOW)).toBe("pro");
    expect(effectivePlanKey(sub({ status: "cancelled", currentPeriodEnd: daysAgo(1) }), NOW)).toBe("free");
  });
  it("essai terminé depuis plus de 3 jours : rétrogradé", () => expect(effectivePlanKey(sub({ status: "trialing", trialEnd: daysAgo(5) }), NOW)).toBe("free"));
  it("sans échéance (attribution manuelle) : plan conservé", () => expect(effectivePlanKey(sub({ status: "past_due" }), NOW)).toBe("pro"));
  it("graceEndsAt ajoute exactement 3 jours", () => expect(graceEndsAt(new Date("2026-11-01T00:00:00Z")).toISOString()).toBe("2026-11-04T00:00:00.000Z"));
});
