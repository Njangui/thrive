import type { AlertSeverity, DemandRow, GrowthAlert } from "./growth-alerts";

/**
 * C5 — alertes de DEMANDE RÉELLE des clients, calculées en code à partir des clics sur les produits
 * (migration 0186). Aucune conversation lue, aucune donnée personnelle : des compteurs par produit.
 *
 * Le signal est le CLIC sur une carte produit (déclenché côté visiteur). Les « vues » de page sont
 * enregistrées au rendu serveur et comptent donc aussi les robots (Google, aperçus de lien Meta ou
 * WhatsApp) : elles ne servent à aucune alerte.
 *
 * Seuils : paramètres, pas des vérités métier ; ils dépendent du trafic du tenant. Sous
 * `minTotalClicks`, une note prévient que les chiffres sont indicatifs.
 */
export interface DemandOptions {
  currency?: string;
  /** Période (en jours) des clics, pour les phrases. Doit être celle passée au SQL. */
  days?: number;
  /** Clics minimum pour parler de demande. */
  minClicks?: number;
  /** Clics minimum pour dire « beaucoup d'intérêt, aucune vente ». */
  unconvertedMinClicks?: number;
  /** Hausse : clics ≥ période précédente × ce ratio. */
  riseRatio?: number;
  /** Hausse : clics minimum sur la période précédente (évite les ratios sur de très petits nombres). */
  minPrevClicks?: number;
  /** Sous ce total de clics, les chiffres sont signalés « indicatifs ». */
  minTotalClicks?: number;
  maxItems?: number;
}

export interface DemandResult {
  alerts: GrowthAlert[];
  notes: string[];
  summary: { products: number; totalClicks: number; days: number };
}

const nf = (n: number) => Math.round(n).toLocaleString("fr-FR");
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

export function buildDemandAlerts(rows: DemandRow[], options: DemandOptions = {}): DemandResult {
  const days = options.days ?? 14;
  const minClicks = options.minClicks ?? 5;
  const unconvertedMin = options.unconvertedMinClicks ?? 10;
  const riseRatio = options.riseRatio ?? 1.5;
  const minPrev = options.minPrevClicks ?? 3;
  const minTotal = options.minTotalClicks ?? 20;
  const max = options.maxItems ?? 5;
  const alerts: GrowthAlert[] = [];
  const notes: string[] = [];
  const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
  const byClicks = (a: DemandRow, b: DemandRow) => b.clicks - a.clicks;

  // 1. Demande sans stock : l'argent qui part chez le voisin.
  const noStock = rows.filter((r) => r.clicks >= minClicks && r.currentStock <= 0).sort(byClicks);
  if (noStock.length > 0) {
    const clicks = noStock.reduce((s, r) => s + r.clicks, 0);
    alerts.push({
      code: "demand_no_stock", severity: "high" satisfies AlertSeverity,
      title: `${noStock.length} ${plural(noStock.length, "produit demandé est en rupture", "produits demandés sont en rupture")}`,
      summary: `« ${noStock[0]!.name} » a suscité ${nf(noStock[0]!.clicks)} clic(s) en ${days} jours alors qu'il n'y a plus de stock.`,
      facts: { products: noStock.length, clicks, days },
      items: noStock.slice(0, max).map((r) => ({ label: r.name, detail: `${nf(r.clicks)} clic(s) en ${days} jours, stock épuisé` })),
      suggestedAction: { kind: "restock", label: "Réapprovisionner ou proposer un produit équivalent" },
    });
  }

  // 2. Beaucoup d'intérêt, aucune vente : prix, photo ou description à revoir.
  const unconverted = rows.filter((r) => r.clicks >= unconvertedMin && r.unitsSold <= 0 && r.currentStock > 0).sort(byClicks);
  if (unconverted.length > 0) {
    alerts.push({
      code: "demand_unconverted", severity: "medium",
      title: `${unconverted.length} ${plural(unconverted.length, "produit très regardé mais jamais vendu", "produits très regardés mais jamais vendus")}`,
      summary: `Ces produits attirent des clics sans vente sur les ${days} derniers jours.`,
      facts: { products: unconverted.length, clicks: unconverted.reduce((s, r) => s + r.clicks, 0), days },
      items: unconverted.slice(0, max).map((r) => ({ label: r.name, detail: `${nf(r.clicks)} clic(s), 0 vendu(s), prix ${nf(r.unitPrice)} ${options.currency ?? "FCFA"}` })),
      suggestedAction: { kind: "review_price", label: "Vérifier le prix, la photo et la description" },
    });
  }

  // 3. Intérêt en hausse : bon moment pour mettre en avant (et s'assurer que le stock suit).
  const rising = rows.filter((r) => r.clicks >= minClicks && r.clicksPrev >= minPrev && r.clicks >= r.clicksPrev * riseRatio && r.currentStock > 0).sort(byClicks);
  if (rising.length > 0) {
    alerts.push({
      code: "demand_rising", severity: "medium",
      title: `${rising.length} ${plural(rising.length, "produit en forte hausse d'intérêt", "produits en forte hausse d'intérêt")}`,
      summary: `« ${rising[0]!.name} » : ${nf(rising[0]!.clicks)} clic(s) contre ${nf(rising[0]!.clicksPrev)} sur la période précédente.`,
      facts: { products: rising.length, days, ratioMin: riseRatio },
      items: rising.slice(0, max).map((r) => ({ label: r.name, detail: `${nf(r.clicks)} clic(s) contre ${nf(r.clicksPrev)} avant${r.currentStock <= r.minStock ? ", stock bas" : ""}` })),
      suggestedAction: { kind: "promote", label: "Mettre en avant ce produit et vérifier que le stock suit" },
    });
  }

  if (rows.length > 0 && totalClicks < minTotal) notes.push(`Peu de données (${totalClicks} clic(s) sur ${days} jours) : ces constats sont indicatifs.`);
  if (rows.some((r) => r.views > 0)) notes.push("Les vues de page incluent les robots (Google, aperçus de lien) : seuls les clics sur les produits sont utilisés.");
  return { alerts, notes, summary: { products: rows.length, totalClicks, days } };
}
