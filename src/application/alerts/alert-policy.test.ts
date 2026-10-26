import { describe, expect, it } from "vitest";
import { alertSettingsSchema, DEFAULT_ALERT_SETTINGS, isQuietNow, isTriggerEnabled, nextQuietEnd, passesThreshold, planForStep, settingsFromRow, escalates, bypassesQuietHours } from "./alert-policy";

const s = (over: Record<string, unknown> = {}) => alertSettingsSchema.parse({ quietEnabled: true, quietStart: "22:00", quietEnd: "07:00", ...over });
// Africa/Douala = UTC+1 (pas d'heure d'été).
const at = (utc: string) => new Date(`2026-10-09T${utc}:00Z`);

describe("heures calmes", () => {
  it("fenêtre de nuit (passe minuit) en heure locale", () => {
    expect(isQuietNow(s(), at("21:30"), "Africa/Douala")).toBe(true); // 22:30 locale
    expect(isQuietNow(s(), at("05:59"), "Africa/Douala")).toBe(true); // 06:59 locale
    expect(isQuietNow(s(), at("06:00"), "Africa/Douala")).toBe(false); // 07:00 locale, fin exclusive
    expect(isQuietNow(s(), at("12:00"), "Africa/Douala")).toBe(false);
  });
  it("fenêtre dans la même journée", () => {
    const w = s({ quietStart: "13:00", quietEnd: "15:00" });
    expect(isQuietNow(w, at("12:30"), "Africa/Douala")).toBe(true);
    expect(isQuietNow(w, at("14:00"), "Africa/Douala")).toBe(false);
  });
  it("désactivées => jamais", () => expect(isQuietNow(s({ quietEnabled: false }), at("23:00"), "UTC")).toBe(false));
  it("fuseau invalide => repli UTC sans exception", () => expect(isQuietNow(s(), at("23:00"), "Nope/Zone")).toBe(true));
  it("fin des heures calmes", () => {
    expect(nextQuietEnd(s(), at("21:30"), "Africa/Douala").toISOString()).toBe("2026-10-10T06:00:00.000Z");
    expect(nextQuietEnd(s(), at("05:00"), "Africa/Douala").toISOString()).toBe("2026-10-09T06:00:00.000Z");
    const now = at("12:00");
    expect(nextQuietEnd(s(), now, "Africa/Douala")).toEqual(now);
  });
});

describe("réglages", () => {
  it("défauts : pas d'heures calmes, 15 min, aucun repli", () => {
    expect(DEFAULT_ALERT_SETTINGS).toMatchObject({ quietEnabled: false, escalationDelayMinutes: 15, fallbackMembershipId: null });
  });
  it("déclencheurs par défaut : producteurs non livrés désactivés", () => {
    expect(isTriggerEnabled(DEFAULT_ALERT_SETTINGS, "refund_over_threshold")).toBe(true);
    expect(isTriggerEnabled(DEFAULT_ALERT_SETTINGS, "ad_spend_anomaly")).toBe(false);
    expect(isTriggerEnabled(DEFAULT_ALERT_SETTINGS, "inconnu")).toBe(false);
  });
  it("surcharge explicite", () => {
    const st = alertSettingsSchema.parse({ triggers: { ad_spend_anomaly: { enabled: true, threshold: 30 } } });
    expect(isTriggerEnabled(st, "ad_spend_anomaly")).toBe(true);
  });
  it("rejette début == fin, déclencheur inconnu, délai hors bornes", () => {
    expect(alertSettingsSchema.safeParse({ quietEnabled: true, quietStart: "22:00", quietEnd: "22:00" }).success).toBe(false);
    expect(alertSettingsSchema.safeParse({ triggers: { x: { enabled: true } } }).success).toBe(false);
    expect(alertSettingsSchema.safeParse({ escalationDelayMinutes: 0 }).success).toBe(false);
    expect(alertSettingsSchema.safeParse({ quietStart: "25:00" }).success).toBe(false);
  });
  it("ligne corrompue => défauts", () => expect(settingsFromRow({ quiet_start: "zz" })).toEqual(DEFAULT_ALERT_SETTINGS));
  it("seuil : >= seuil, sans seuil on lève", () => {
    const st = alertSettingsSchema.parse({ triggers: { refund_over_threshold: { enabled: true, threshold: 50000 } } });
    expect(passesThreshold(st, "refund_over_threshold", 49999)).toBe(false);
    expect(passesThreshold(st, "refund_over_threshold", 50000)).toBe(true);
    expect(passesThreshold(DEFAULT_ALERT_SETTINGS, "refund_over_threshold", 1)).toBe(true);
  });
});

describe("échelle", () => {
  it("push -> messageries -> repli -> fin", () => {
    expect(planForStep(0)).toMatchObject({ audience: "owners", channels: ["push"] });
    expect(planForStep(1).channels).toEqual(["telegram", "whatsapp", "email"]);
    expect(planForStep(2).audience).toBe("fallback");
    expect(planForStep(3).channels).toEqual([]);
  });
  it("info n'escalade pas ; seul critical traverse les heures calmes", () => {
    expect(escalates("info")).toBe(false);
    expect(escalates("important")).toBe(true);
    expect(bypassesQuietHours("critical")).toBe(true);
    expect(bypassesQuietHours("important")).toBe(false);
  });
});
