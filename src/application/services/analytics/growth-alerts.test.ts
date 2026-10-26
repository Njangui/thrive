import { describe, it, expect } from "vitest";
import { buildDigest, buildGrowthAlerts, type GrowthInsights } from "./growth-alerts";

const empty: GrowthInsights = { dormantStock: [], margins: [], forecast: [], inactiveCustomers: [], broadcastResults: [], traffic: [] };
const base = (over: Partial<GrowthInsights>): GrowthInsights => ({ ...empty, ...over });

describe("buildGrowthAlerts", () => {
  it("aucune donnée → aucune alerte", () => {
    expect(buildGrowthAlerts(empty)).toEqual([]);
  });

  it("rupture : gravité selon le pire produit, tri par jours restants, produits hors horizon ignorés", () => {
    const alerts = buildGrowthAlerts(base({ forecast: [
      { productId: "a", name: "Riz 25kg", currentStock: 6, minStock: 2, dailyRate: 2, daysLeft: 3 },
      { productId: "b", name: "Huile 5L", currentStock: 40, minStock: 5, dailyRate: 2, daysLeft: 20 },
      { productId: "c", name: "Sucre", currentStock: 14, minStock: 5, dailyRate: 2, daysLeft: 7 },
    ] }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ code: "stockout_risk", severity: "critical", facts: { products: 2, worstDaysLeft: 3 } });
    expect(alerts[0]!.items.map((i) => i.label)).toEqual(["Riz 25kg", "Sucre"]);
  });

  it("sous le seuil minimum alors que le produit se vend → alerte même au-delà de l'horizon", () => {
    const a = buildGrowthAlerts(base({ forecast: [{ productId: "a", name: "Lait", currentStock: 2, minStock: 5, dailyRate: 0.1, daysLeft: 20 }] }));
    expect(a[0]).toMatchObject({ code: "stockout_risk", severity: "medium" });
  });

  it("marge : un coût inconnu n'est JAMAIS une marge faible ni confortable, il devient une alerte de donnée manquante", () => {
    const alerts = buildGrowthAlerts(base({ margins: [
      { productId: "a", name: "Robe wax", units: 10, revenue: 100000, cost: 98000, margin: 2000, marginPct: 2, costKnown: true },
      { productId: "b", name: "Sac", units: 4, revenue: 40000, cost: null, margin: null, marginPct: null, costKnown: false },
      { productId: "c", name: "Pagne", units: 5, revenue: 50000, cost: 25000, margin: 25000, marginPct: 50, costKnown: true },
    ] }));
    expect(alerts.map((a) => a.code).sort()).toEqual(["low_margin", "missing_cost"]);
    expect(alerts.find((a) => a.code === "low_margin")!.items.map((i) => i.label)).toEqual(["Robe wax"]);
    expect(alerts.find((a) => a.code === "missing_cost")!.items.map((i) => i.label)).toEqual(["Sac"]);
  });

  it("vente à perte → gravité haute, seuil réglable", () => {
    const rows = [{ productId: "a", name: "Huile", units: 3, revenue: 9000, cost: 10000, margin: -1000, marginPct: -11.1, costKnown: true }];
    expect(buildGrowthAlerts(base({ margins: rows }))[0]).toMatchObject({ code: "low_margin", severity: "high", facts: { atLoss: 1 } });
    const ok = [{ productId: "a", name: "Pagne", units: 3, revenue: 9000, cost: 7500, margin: 1500, marginPct: 16.7, costKnown: true }];
    expect(buildGrowthAlerts(base({ margins: ok }))).toEqual([]);
    expect(buildGrowthAlerts(base({ margins: ok }), { lowMarginPct: 25 })[0]).toMatchObject({ code: "low_margin" });
  });

  it("stock dormant : somme uniquement les valeurs connues et signale celles sans coût", () => {
    const alerts = buildGrowthAlerts(base({ dormantStock: [
      { productId: "a", name: "Dormant A", currentStock: 10, costPrice: 1000, immobilizedValue: 10000, costKnown: true, lastSaleAt: "2026-05-01T00:00:00Z" },
      { productId: "b", name: "Dormant B", currentStock: 3, costPrice: null, immobilizedValue: null, costKnown: false, lastSaleAt: null },
    ] }));
    const dormant = alerts.find((a) => a.code === "dormant_stock")!;
    expect(dormant.facts).toMatchObject({ products: 2, immobilizedValue: 10000, withoutCost: 1 });
    expect(dormant.summary).toMatch(/hors produits sans prix d'achat/);
    expect(dormant.items[0]!.detail).toMatch(/jamais vendu|dernière vente/);
    expect(alerts.some((a) => a.code === "missing_cost")).toBe(true);
  });

  it("clients inactifs : total dépensé et compte, sans inventer de chiffre", () => {
    const [a] = buildGrowthAlerts(base({ inactiveCustomers: [
      { contactId: "1", fullName: "Awa", lastOrderAt: "2026-06-01T00:00:00Z", ordersCount: 3, totalSpent: 150000 },
      { contactId: "2", fullName: null, lastOrderAt: "2026-05-01T00:00:00Z", ordersCount: 1, totalSpent: 20000 },
    ] }));
    expect(a).toMatchObject({ code: "inactive_customers", facts: { customers: 2, totalSpent: 170000 } });
    expect(a!.items[1]!.label).toBe("Client sans nom");
  });

  it("tri : critique avant haute avant moyenne", () => {
    const alerts = buildGrowthAlerts(base({
      inactiveCustomers: [{ contactId: "1", fullName: "Awa", lastOrderAt: "2026-06-01T00:00:00Z", ordersCount: 1, totalSpent: 1 }],
      forecast: [{ productId: "a", name: "Riz", currentStock: 1, minStock: 0, dailyRate: 1, daysLeft: 1 }],
    }));
    expect(alerts.map((a) => a.severity)).toEqual(["critical", "medium"]);
  });
});

describe("buildDigest", () => {
  const alerts = buildGrowthAlerts(base({
    forecast: [{ productId: "a", name: "Riz", currentStock: 1, minStock: 0, dailyRate: 1, daysLeft: 1 }],
    inactiveCustomers: [{ contactId: "1", fullName: "Awa", lastOrderAt: "2026-06-01T00:00:00Z", ordersCount: 1, totalSpent: 1000 }],
  }));
  it("quotidien : seulement l'urgent ; rien à dire → vide, l'appelant peut ne pas envoyer", () => {
    const daily = buildDigest({ kind: "daily", alerts });
    expect(daily.text).toMatch(/rupture/);
    expect(daily.text).not.toMatch(/inactif/);
    expect(buildDigest({ kind: "daily", alerts: [] })).toMatchObject({ empty: true, text: "Bilan du jour : rien de particulier à signaler." });
  });
  it("hebdomadaire : tout, avec diffusions (mise en garde de corrélation) et sources de trafic", () => {
    const weekly = buildDigest({
      kind: "weekly", alerts,
      broadcastResults: [{ broadcastId: "b", name: "Promo", scheduledAt: "2026-10-01T00:00:00Z", status: "completed", sentCount: 120, orders: 7, orderingContacts: 6, revenue: 210000 }],
      traffic: [{ source: "facebook", campaign: "promo1", visitors: 300, whatsappClickers: 42 }],
    });
    expect(weekly.title).toBe("Rapport de la semaine");
    expect(weekly.text).toMatch(/inactif/);
    expect(weekly.text).toMatch(/corrélation, pas la preuve/);
    expect(weekly.text).toMatch(/facebook \/ promo1/);
    expect(weekly.text).toMatch(/42 ont cliqué vers WhatsApp/);
  });
});
