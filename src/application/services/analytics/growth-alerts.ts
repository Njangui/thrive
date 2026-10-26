/**
 * C5 — alertes et bilans construits à partir des lignes SQL (migration 0183).
 *
 * RÈGLE : tous les chiffres viennent du SQL. Ce module ne fait que filtrer,
 * trier, agréger des lignes déjà calculées et les mettre en phrases avec des
 * gabarits fixes. Le LLM (rédaction/priorisation) reçoit `facts` + `items` :
 * il ne recalcule rien et ne peut pas inventer un chiffre absent des faits.
 */
import { buildDemandAlerts } from "./demand-alerts";

export interface DormantStockRow { productId: string; name: string; currentStock: number; costPrice: number | null; immobilizedValue: number | null; costKnown: boolean; lastSaleAt: string | null }
export interface MarginRow { productId: string; name: string; units: number; revenue: number; cost: number | null; margin: number | null; marginPct: number | null; costKnown: boolean }
export interface ForecastRow { productId: string; name: string; currentStock: number; minStock: number; dailyRate: number; daysLeft: number }
export interface InactiveCustomerRow { contactId: string; fullName: string | null; lastOrderAt: string; ordersCount: number; totalSpent: number }
export interface BroadcastResultRow { broadcastId: string; name: string; scheduledAt: string; status: string; sentCount: number; orders: number; orderingContacts: number; revenue: number }
export interface TrafficRow { source: string; campaign: string | null; visitors: number; whatsappClickers: number }

export interface DemandRow {
  productId: string;
  name: string;
  currentStock: number;
  minStock: number;
  unitPrice: number;
  /** Clics sur une carte produit (signal fiable : déclenché côté visiteur). */
  clicks: number;
  clicksPrev: number;
  /** Vues de page : INCLUENT les robots (rendu serveur) ; renvoyées à titre indicatif, jamais utilisées pour une alerte. */
  views: number;
  unitsSold: number;
}

export interface GrowthInsights {
  dormantStock: DormantStockRow[];
  margins: MarginRow[];
  forecast: ForecastRow[];
  inactiveCustomers: InactiveCustomerRow[];
  broadcastResults: BroadcastResultRow[];
  traffic: TrafficRow[];
  /** Demande par produit (migration 0186) ; absent si non chargé. */
  demand?: DemandRow[];
}

export type AlertSeverity = "critical" | "high" | "medium";
export type AlertCode =
  | "stockout_risk" | "dormant_stock" | "low_margin" | "missing_cost" | "inactive_customers"
  // Pubs (surveillance, voir ads/ad-monitoring.ts)
  | "demand_no_stock" | "demand_unconverted" | "demand_rising"
  | "ad_rejected" | "ad_with_issues" | "ad_spend_cap" | "ad_overspend" | "ad_no_conversations" | "ad_external_spend";
export type SuggestedActionKind = "restock" | "promote" | "review_price" | "set_cost" | "win_back" | "fix_ad" | "pause_ad" | "review_ad";

export interface GrowthAlert {
  code: AlertCode;
  severity: AlertSeverity;
  title: string;
  summary: string;
  /** Chiffres bruts (issus du SQL) que le rédacteur IA peut citer, jamais recalculer. */
  facts: Record<string, number | string>;
  items: Array<{ label: string; detail: string }>;
  suggestedAction: { kind: SuggestedActionKind; label: string };
}

export interface AlertOptions {
  currency?: string;
  /** Alerte de rupture si le stock couvre moins de N jours de vente. */
  horizonDays?: number;
  /** Marge (%) en dessous de laquelle un produit est signalé. Réglable ; aucune valeur n'est une vérité métier. */
  lowMarginPct?: number;
  maxItems?: number;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, high: 1, medium: 2 };
const nf = (n: number) => Math.round(n).toLocaleString("fr-FR");
const nf1 = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

export function buildGrowthAlerts(insights: GrowthInsights, options: AlertOptions = {}): GrowthAlert[] {
  const currency = options.currency ?? "FCFA";
  const horizon = options.horizonDays ?? 14;
  const lowMargin = options.lowMarginPct ?? 15;
  const max = options.maxItems ?? 5;
  const alerts: GrowthAlert[] = [];

  // 1. Rupture imminente (stock couvrant peu de jours, ou sous le seuil minimum alors que le produit se vend).
  const atRisk = insights.forecast
    .filter((r) => r.daysLeft <= horizon || r.currentStock <= r.minStock)
    .sort((a, b) => a.daysLeft - b.daysLeft);
  if (atRisk.length > 0) {
    const worst = atRisk[0]!.daysLeft;
    alerts.push({
      code: "stockout_risk",
      severity: worst <= 3 ? "critical" : worst <= 7 ? "high" : "medium",
      title: `${atRisk.length} ${plural(atRisk.length, "produit risque", "produits risquent")} la rupture`,
      summary: `« ${atRisk[0]!.name} » n'a plus que ${nf1(atRisk[0]!.daysLeft)} jour(s) de stock au rythme actuel des ventes.`,
      facts: { products: atRisk.length, worstDaysLeft: worst, horizonDays: horizon },
      items: atRisk.slice(0, max).map((r) => ({ label: r.name, detail: `${nf(r.currentStock)} en stock, ${nf1(r.dailyRate)}/jour vendu(s) → ${nf1(r.daysLeft)} jour(s)` })),
      suggestedAction: { kind: "restock", label: "Réapprovisionner en priorité les produits les plus proches de la rupture" },
    });
  }

  // 2. Marge faible ou négative (uniquement quand le coût est connu).
  const lowMargins = insights.margins.filter((r) => r.costKnown && r.marginPct !== null && r.marginPct < lowMargin).sort((a, b) => (a.marginPct ?? 0) - (b.marginPct ?? 0));
  if (lowMargins.length > 0) {
    const atLoss = lowMargins.filter((r) => (r.marginPct ?? 0) <= 0).length;
    alerts.push({
      code: "low_margin",
      severity: atLoss > 0 ? "high" : "medium",
      title: `${lowMargins.length} ${plural(lowMargins.length, "produit à marge faible", "produits à marge faible")}`,
      summary: atLoss > 0 ? `${atLoss} ${plural(atLoss, "produit est vendu", "produits sont vendus")} à perte ou sans marge.` : `Marge inférieure à ${lowMargin} % sur ${lowMargins.length} ${plural(lowMargins.length, "produit", "produits")}.`,
      facts: { products: lowMargins.length, atLoss, thresholdPct: lowMargin },
      items: lowMargins.slice(0, max).map((r) => ({ label: r.name, detail: `marge ${nf1(r.marginPct ?? 0)} % sur ${nf(r.revenue)} ${currency} de ventes` })),
      suggestedAction: { kind: "review_price", label: "Revoir le prix de vente ou le coût d'achat" },
    });
  }

  // 3. Coût inconnu : la marge est incalculable (donnée manquante, pas une bonne nouvelle).
  const unknownIds = new Map<string, string>();
  for (const r of insights.margins) if (!r.costKnown) unknownIds.set(r.productId, r.name);
  for (const r of insights.dormantStock) if (!r.costKnown) unknownIds.set(r.productId, r.name);
  if (unknownIds.size > 0) {
    const names = [...unknownIds.values()];
    alerts.push({
      code: "missing_cost",
      severity: "medium",
      title: `${names.length} ${plural(names.length, "produit sans prix d'achat", "produits sans prix d'achat")}`,
      summary: "Sans prix d'achat, la marge et la valeur du stock immobilisé ne peuvent pas être calculées.",
      facts: { products: names.length },
      items: names.slice(0, max).map((name) => ({ label: name, detail: "prix d'achat à renseigner" })),
      suggestedAction: { kind: "set_cost", label: "Renseigner le prix d'achat de ces produits" },
    });
  }

  // 4. Stock dormant : de l'argent immobilisé.
  if (insights.dormantStock.length > 0) {
    const known = insights.dormantStock.filter((r) => r.immobilizedValue !== null);
    const total = known.reduce((sum, r) => sum + (r.immobilizedValue ?? 0), 0);
    const sorted = [...insights.dormantStock].sort((a, b) => (b.immobilizedValue ?? -1) - (a.immobilizedValue ?? -1));
    alerts.push({
      code: "dormant_stock",
      severity: "medium",
      title: `${insights.dormantStock.length} ${plural(insights.dormantStock.length, "produit dormant", "produits dormants")} en stock`,
      summary: known.length > 0 ? `Environ ${nf(total)} ${currency} immobilisés (au prix d'achat) dans du stock qui ne se vend pas${known.length < insights.dormantStock.length ? ", hors produits sans prix d'achat" : ""}.` : "Du stock ne se vend pas, mais aucun prix d'achat n'est renseigné pour en chiffrer la valeur.",
      facts: { products: insights.dormantStock.length, immobilizedValue: Math.round(total), withoutCost: insights.dormantStock.length - known.length, currency },
      items: sorted.slice(0, max).map((r) => ({ label: r.name, detail: `${nf(r.currentStock)} en stock${r.immobilizedValue !== null ? `, ${nf(r.immobilizedValue)} ${currency} immobilisés` : ""}${r.lastSaleAt ? `, dernière vente ${r.lastSaleAt.slice(0, 10)}` : ", jamais vendu"}` })),
      suggestedAction: { kind: "promote", label: "Lancer une promotion ou une publication pour écouler ce stock" },
    });
  }

  // 5. Clients inactifs : à relancer (la relance elle-même relève de C3 / du moteur de diffusion).
  if (insights.inactiveCustomers.length > 0) {
    const total = insights.inactiveCustomers.reduce((s, r) => s + r.totalSpent, 0);
    alerts.push({
      code: "inactive_customers",
      severity: "medium",
      title: `${insights.inactiveCustomers.length} ${plural(insights.inactiveCustomers.length, "client inactif à relancer", "clients inactifs à relancer")}`,
      summary: `Ces clients ont déjà acheté (${nf(total)} ${currency} au total) mais n'ont plus commandé depuis un moment.`,
      facts: { customers: insights.inactiveCustomers.length, totalSpent: Math.round(total), currency },
      items: insights.inactiveCustomers.slice(0, max).map((r) => ({ label: r.fullName ?? "Client sans nom", detail: `${r.ordersCount} commande(s), ${nf(r.totalSpent)} ${currency}, dernière le ${r.lastOrderAt.slice(0, 10)}` })),
      suggestedAction: { kind: "win_back", label: "Relancer ces clients (message ou diffusion, hors désinscrits)" },
    });
  }

  // 6. Demande réelle des clients (clics sur les produits).
  if (insights.demand && insights.demand.length > 0) alerts.push(...buildDemandAlerts(insights.demand, { currency, maxItems: max }).alerts);

  return alerts.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

// ---------------------------------------------------------------------------
// Bilans (contenu) — la livraison (Telegram, WhatsApp, push) relève de C2 via notify().
// ---------------------------------------------------------------------------
export interface Digest {
  kind: "daily" | "weekly";
  title: string;
  sections: Array<{ heading: string; lines: string[] }>;
  /** Version texte brute, prête pour notify() ; tous les chiffres viennent du SQL. */
  text: string;
  /** Vrai s'il n'y a rien à signaler : l'appelant peut choisir de ne pas envoyer. */
  empty: boolean;
}

export function buildDigest(input: { kind: "daily" | "weekly"; alerts: GrowthAlert[]; broadcastResults?: BroadcastResultRow[]; traffic?: TrafficRow[]; currency?: string; resultsWindowDays?: number }): Digest {
  const currency = input.currency ?? "FCFA";
  const window = input.resultsWindowDays ?? 7;
  const sections: Digest["sections"] = [];
  // Quotidien : seulement ce qui demande une action rapide. Hebdomadaire : tout.
  const shown = input.kind === "daily" ? input.alerts.filter((a) => a.severity !== "medium") : input.alerts;
  if (shown.length > 0) {
    sections.push({ heading: "À traiter", lines: shown.map((a) => `• ${a.title} — ${a.summary} (${a.suggestedAction.label})`) });
  }
  if (input.kind === "weekly") {
    const results = input.broadcastResults ?? [];
    if (results.length > 0) {
      sections.push({
        heading: "Diffusions récentes",
        lines: [
          ...results.slice(0, 5).map((r) => `• « ${r.name} » : ${nf(r.sentCount)} envoyé(s), ${nf(r.orders)} commande(s) dans les ${window} jours suivants (${nf(r.revenue)} ${currency})`),
          "Attribution par proximité dans le temps : c'est une corrélation, pas la preuve que la diffusion a causé la commande.",
        ],
      });
    }
    const traffic = input.traffic ?? [];
    if (traffic.length > 0) {
      sections.push({
        heading: "D'où viennent les visiteurs",
        lines: traffic.slice(0, 5).map((r) => `• ${r.source}${r.campaign ? ` / ${r.campaign}` : ""} : ${nf(r.visitors)} visiteur(s), ${nf(r.whatsappClickers)} ont cliqué vers WhatsApp`),
      });
    }
  }
  const title = input.kind === "daily" ? "Bilan du jour" : "Rapport de la semaine";
  const text = sections.length === 0 ? `${title} : rien de particulier à signaler.` : [title, ...sections.flatMap((s) => ["", s.heading, ...s.lines])].join("\n");
  return { kind: input.kind, title, sections, text, empty: sections.length === 0 };
}
