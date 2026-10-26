import { describe, it, expect } from "vitest";
import {
  DEFAULT_META_RATE_CARD, estimateBroadcastCost, planDelivery, suggestSendHour, type PlanningRecipient,
} from "./broadcast-planning";
import { buildBroadcastPreview } from "./broadcast-preview-service";

const wa = (id: string, withinWindow: boolean): PlanningRecipient => ({ contactId: id, channel: "whatsapp", withinWindow });

describe("estimateBroadcastCost", () => {
  it("hors fenêtre avec modèle : tarif marketing × nombre ; en fenêtre : gratuit dans le quota", () => {
    const r = [wa("a", false), wa("b", false), wa("c", true)];
    const c = estimateBroadcastCost(r, { hasTemplate: true });
    expect(c.expectedUsd).toBeCloseTo(0.0518, 6);
    expect(c.maxUsd).toBeCloseTo(0.0777, 6); // les 3 en modèle si la fenêtre expire
    expect(c.confirmed).toBe(false);
    expect(c.notes.join(" ")).toMatch(/à confirmer/);
  });
  it("sans modèle : les hors-fenêtre ne coûtent rien (ignorés) et un avertissement l'explique", () => {
    const c = estimateBroadcastCost([wa("a", false), wa("b", true)], { hasTemplate: false });
    expect(c.expectedUsd).toBe(0);
    expect(c.notes.join(" ")).toMatch(/modèle approuvé est obligatoire/);
  });
  it("au-delà du quota de service gratuit : tarif inconnu = compté à part, jamais inventé", () => {
    const r = Array.from({ length: 5 }, (_, i) => wa(`c${i}`, true));
    const c = estimateBroadcastCost(r, { hasTemplate: false, serviceMessagesUsedThisMonth: 998 });
    expect(c.unknownCount).toBe(3);
    expect(c.expectedUsd).toBe(0);
    expect(c.notes.join(" ")).toMatch(/tarif inconnu/);
  });
  it("tarif injectable ; FCFA seulement si un taux est fourni", () => {
    const card = { ...DEFAULT_META_RATE_CARD, marketingTemplateUsd: 0.1, verified: true };
    const sans = estimateBroadcastCost([wa("a", false)], { hasTemplate: true, rateCard: card });
    expect(sans.expectedXaf).toBeNull();
    const avec = estimateBroadcastCost([wa("a", false)], { hasTemplate: true, rateCard: card, xafPerUsd: 600 });
    expect(avec.expectedXaf).toBe(60);
    expect(avec.confirmed).toBe(true);
  });
  it("Telegram, Messenger, Instagram : aucun frais par message côté Flexco", () => {
    const c = estimateBroadcastCost([{ contactId: "t", channel: "telegram", withinWindow: true }], { hasTemplate: false });
    expect(c.lines[0]).toMatchObject({ channel: "telegram", kind: "no_fee", subtotalUsd: 0 });
    expect(c.expectedUsd).toBe(0);
  });
});

describe("frais de messages Zernio (plateforme)", () => {
  it("1 $ par 10 000 messages, au MAXIMUM (quota gratuit ignoré), séparés du tarif Meta", () => {
    const r = Array.from({ length: 5000 }, (_, i) => wa(`c${i}`, true));
    const c = estimateBroadcastCost(r, { hasTemplate: false });
    expect(c.sentMessages).toBe(5000);
    expect(c.platformFeeMaxUsd).toBeCloseTo(0.5, 6);
    expect(c.expectedUsd).toBe(0); // le tarif Meta n'inclut PAS les frais de plateforme
    expect(c.notes.join(" ")).toMatch(/Frais Zernio.*0,5 \$ pour 5[\s\u202f\u00a0]000 message/);
    expect(c.notes.join(" ")).toMatch(/contrat à confirmer/);
  });
  it("ne compte que les messages réellement envoyés : les hors-fenêtre ignorés faute de modèle ne coûtent rien", () => {
    const r = [wa("a", false), wa("b", false), wa("c", true)];
    expect(estimateBroadcastCost(r, { hasTemplate: false }).sentMessages).toBe(1);
    expect(estimateBroadcastCost(r, { hasTemplate: true }).sentMessages).toBe(3);
  });
  it("tous canaux : Telegram, Messenger et Instagram comptent aussi (le tarif Zernio est tous canaux)", () => {
    const r: PlanningRecipient[] = [{ contactId: "t", channel: "telegram", withinWindow: true }, { contactId: "f", channel: "facebook", withinWindow: true }, wa("w", true)];
    expect(estimateBroadcastCost(r, { hasTemplate: false }).sentMessages).toBe(3);
  });
  it("tarif injectable ; aucun envoi : aucune ligne de frais", () => {
    const c = estimateBroadcastCost([wa("a", true)], { hasTemplate: false, platformFee: { usdPer10kMessages: 5, freeMonthlyMessages: 0, source: "test" } });
    expect(c.platformFeeMaxUsd).toBeCloseTo(0.0005, 6);
    const none = estimateBroadcastCost([], { hasTemplate: false });
    expect(none.platformFeeMaxUsd).toBe(0);
    expect(none.notes.join(" ")).not.toMatch(/Frais Zernio/);
  });
});

describe("planDelivery (palier du numéro)", () => {
  it("n'applique le palier qu'aux démarrages par modèle ; le reste est repoussé jour par jour", () => {
    const r = [...Array.from({ length: 5 }, (_, i) => wa(`o${i}`, false)), wa("in", true)];
    const p = planDelivery(r, { hasTemplate: true, dailyUniqueLimit: 2 });
    expect(p.counts).toMatchObject({ send_template: 2, defer_daily_limit: 3, send_free_form: 1 });
    expect(p.deferredByDay).toEqual([{ dayOffset: 1, count: 2 }, { dayOffset: 2, count: 1 }]);
  });
  it("tient compte des contacts déjà démarrés aujourd'hui", () => {
    const p = planDelivery([wa("a", false), wa("b", false)], { hasTemplate: true, dailyUniqueLimit: 250, alreadyStartedToday: 249 });
    expect(p.counts).toMatchObject({ send_template: 1, defer_daily_limit: 1 });
  });
  it("sans modèle, les hors-fenêtre sont ignorés avec un motif", () => {
    const p = planDelivery([wa("a", false), wa("b", true)], { hasTemplate: false, dailyUniqueLimit: 250 });
    expect(p.counts).toMatchObject({ skip_template_required: 1, send_free_form: 1 });
    expect(p.notes.join(" ")).toMatch(/faute de modèle/);
  });
});

describe("suggestSendHour", () => {
  const at = (hourDouala: number, n: number) => Array.from({ length: n }, (_, i) => `2026-09-${String(10 + (i % 15)).padStart(2, "0")}T${String((hourDouala - 1 + 24) % 24).padStart(2, "0")}:15:00Z`);
  it("choisit l'heure (Douala, UTC+1) où les contacts écrivent le plus", () => {
    const s = suggestSendHour([...at(19, 40), ...at(12, 15), ...at(9, 5)]);
    expect(s).toMatchObject({ hour: 19, basis: "data", sampleSize: 60 });
    expect(s.top.map((t) => t.hour)).toEqual([19, 12, 9]);
  });
  it("trop peu de données : défaut explicite, jamais présenté comme une mesure", () => {
    expect(suggestSendHour(at(10, 5))).toMatchObject({ hour: 18, basis: "default" });
    expect(suggestSendHour([])).toMatchObject({ basis: "default", sampleSize: 0 });
  });
  it("ignore les heures de nuit pour la suggestion", () => {
    expect(suggestSendHour(at(3, 50)).basis).toBe("default");
  });
});

describe("buildBroadcastPreview", () => {
  it("assemble coût + plan + horaire à partir de données chargées", () => {
    const p = buildBroadcastPreview({ recipients: [wa("a", false), wa("b", true)], hasTemplate: true, dailyUniqueLimit: 250, alreadyStartedToday: 0, serviceMessagesUsedThisMonth: 0, inboundTimestamps: [] });
    expect(p.recipientCount).toBe(2);
    expect(p.cost.expectedUsd).toBeCloseTo(0.0259, 6);
    expect(p.plan.counts.send_template).toBe(1);
    expect(p.suggestedHour.basis).toBe("default");
  });
});
