import { describe, it, expect } from "vitest";
import { buildDemandAlerts } from "./demand-alerts";
import { buildGrowthAlerts, type DemandRow, type GrowthInsights } from "./growth-alerts";

const row = (over: Partial<DemandRow> = {}): DemandRow => ({ productId: "p", name: "Robe wax", currentStock: 10, minStock: 2, unitPrice: 15000, clicks: 0, clicksPrev: 0, views: 0, unitsSold: 1, ...over });
const codes = (rows: DemandRow[], opts = {}) => buildDemandAlerts(rows, opts).alerts.map((a) => a.code);

describe("demande sans stock", () => {
  it("clics ≥ 5 et stock épuisé : alerte haute, triée par clics, avec les chiffres du SQL", () => {
    const r = buildDemandAlerts([row({ name: "Sac", clicks: 6, currentStock: 0 }), row({ name: "Robe", clicks: 20, currentStock: 0 }), row({ name: "Pagne", clicks: 50, currentStock: 5 })]);
    expect(r.alerts[0]).toMatchObject({ code: "demand_no_stock", severity: "high", facts: { products: 2, clicks: 26, days: 14 } });
    expect(r.alerts[0]!.items.map((i) => i.label)).toEqual(["Robe", "Sac"]);
    expect(r.alerts[0]!.suggestedAction.kind).toBe("restock");
  });
  it("sous le seuil de clics, ou stock disponible : rien (le seuil est réglable)", () => {
    expect(codes([row({ clicks: 4, currentStock: 0 })])).toEqual([]);
    expect(codes([row({ clicks: 50, currentStock: 3 })])).not.toContain("demand_no_stock");
    expect(codes([row({ clicks: 2, currentStock: 0 })], { minClicks: 2 })).toContain("demand_no_stock");
  });
});

describe("intérêt sans vente", () => {
  it("≥ 10 clics, 0 vendu, du stock : alerte moyenne avec le prix ; une vente suffit à l'écarter ; rupture exclue", () => {
    const r = buildDemandAlerts([row({ clicks: 15, unitsSold: 0 })]);
    expect(r.alerts[0]).toMatchObject({ code: "demand_unconverted", severity: "medium" });
    expect(r.alerts[0]!.items[0]!.detail).toMatch(/15 clic\(s\), 0 vendu\(s\)/);
    expect(codes([row({ clicks: 15, unitsSold: 1 })])).toEqual([]);
    expect(codes([row({ clicks: 15, unitsSold: 0, currentStock: 0 })])).toEqual(["demand_no_stock"]); // un produit en rupture n'est pas « jamais vendu faute de qualité »
  });
});

describe("intérêt en hausse", () => {
  it("clics ≥ 1,5 × période précédente, avec base minimale ; mention du stock bas", () => {
    const r = buildDemandAlerts([row({ clicks: 9, clicksPrev: 4, currentStock: 2 })]);
    expect(r.alerts[0]).toMatchObject({ code: "demand_rising", facts: { products: 1, ratioMin: 1.5 } });
    expect(r.alerts[0]!.items[0]!.detail).toMatch(/9 clic\(s\) contre 4 avant, stock bas/);
  });
  it("un produit en rupture n'est signalé qu'une fois (rupture), pas aussi « en hausse »", () => {
    expect(codes([row({ clicks: 9, clicksPrev: 4, currentStock: 0 })])).toEqual(["demand_no_stock"]);
  });
  it("pas de ratio sur de tout petits nombres (période précédente < 3), ni sans vraie hausse", () => {
    expect(codes([row({ clicks: 9, clicksPrev: 1 })])).toEqual([]);
    expect(codes([row({ clicks: 6, clicksPrev: 5 })])).toEqual([]);
  });
});

describe("qualité des données", () => {
  it("les VUES (robots inclus) ne déclenchent jamais d'alerte : 500 vues, 0 clic = rien", () => {
    expect(codes([row({ views: 500, clicks: 0, currentStock: 0, unitsSold: 0 })])).toEqual([]);
  });
  it("peu de clics au total : note « indicatif » ; note sur les robots dès qu'il y a des vues", () => {
    const r = buildDemandAlerts([row({ clicks: 6, views: 40, currentStock: 0 })]);
    expect(r.notes.join(" ")).toMatch(/Peu de données \(6 clic/);
    expect(r.notes.join(" ")).toMatch(/robots/);
    expect(buildDemandAlerts([row({ clicks: 60, currentStock: 0 })]).notes.join(" ")).not.toMatch(/Peu de données/);
    expect(buildDemandAlerts([]).notes).toEqual([]);
  });
});

describe("intégration dans buildGrowthAlerts", () => {
  const base: GrowthInsights = { dormantStock: [], margins: [], forecast: [], inactiveCustomers: [], broadcastResults: [], traffic: [] };
  it("sans demande chargée : aucun changement ; avec : les alertes sont triées avec les autres", () => {
    expect(buildGrowthAlerts(base)).toEqual([]);
    const alerts = buildGrowthAlerts({ ...base, demand: [row({ clicks: 15, unitsSold: 0 }), row({ productId: "q", name: "Sac", clicks: 8, currentStock: 0 })] });
    expect(alerts.map((a) => a.code)).toEqual(["demand_no_stock", "demand_unconverted"]);
  });
});
