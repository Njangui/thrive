import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { assertActorInOrganization, type PublicationActor } from "../publishing/publication-scheduling";
import type { BroadcastResultRow, DemandRow, DormantStockRow, ForecastRow, GrowthInsights, InactiveCustomerRow, MarginRow, TrafficRow } from "./growth-alerts";

/**
 * C5 — lecture des analyses SQL (migration 0183). Les fonctions SQL ne sont
 * exécutables que par le service-role : ce service vérifie donc d'abord que
 * l'acteur appartient à l'organisation (principe 5), puis passe `p_org`.
 */
export interface InsightParams {
  dormantDays?: number;
  marginDays?: number;
  forecastDays?: number;
  inactiveDays?: number;
  inactiveLimit?: number;
  resultsWindowDays?: number;
  trafficDays?: number;
  demandDays?: number;
}

type Row = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string => String(v ?? "");

export const mapDormant = (r: Row): DormantStockRow => ({ productId: str(r.product_id), name: str(r.name), currentStock: num(r.current_stock), costPrice: numOrNull(r.cost_price), immobilizedValue: numOrNull(r.immobilized_value), costKnown: Boolean(r.cost_known), lastSaleAt: r.last_sale_at ? str(r.last_sale_at) : null });
export const mapMargin = (r: Row): MarginRow => ({ productId: str(r.product_id), name: str(r.name), units: num(r.units), revenue: num(r.revenue), cost: numOrNull(r.cost), margin: numOrNull(r.margin), marginPct: numOrNull(r.margin_pct), costKnown: Boolean(r.cost_known) });
export const mapForecast = (r: Row): ForecastRow => ({ productId: str(r.product_id), name: str(r.name), currentStock: num(r.current_stock), minStock: num(r.min_stock), dailyRate: num(r.daily_rate), daysLeft: num(r.days_left) });
export const mapInactive = (r: Row): InactiveCustomerRow => ({ contactId: str(r.contact_id), fullName: r.full_name ? str(r.full_name) : null, lastOrderAt: str(r.last_order_at), ordersCount: num(r.orders_count), totalSpent: num(r.total_spent) });
export const mapBroadcast = (r: Row): BroadcastResultRow => ({ broadcastId: str(r.broadcast_id), name: str(r.name), scheduledAt: str(r.scheduled_at), status: str(r.status), sentCount: num(r.sent_count), orders: num(r.orders), orderingContacts: num(r.ordering_contacts), revenue: num(r.revenue) });
export const mapDemand = (r: Row): DemandRow => ({ productId: str(r.product_id), name: str(r.name), currentStock: num(r.current_stock), minStock: num(r.min_stock), unitPrice: num(r.unit_price), clicks: num(r.clicks), clicksPrev: num(r.clicks_prev), views: num(r.views), unitsSold: num(r.units_sold) });
export const mapTraffic = (r: Row): TrafficRow => ({ source: str(r.source), campaign: r.campaign ? str(r.campaign) : null, visitors: num(r.visitors), whatsappClickers: num(r.whatsapp_clickers) });

export async function getGrowthInsights(actor: PublicationActor, params: InsightParams = {}): Promise<GrowthInsights> {
  await assertActorInOrganization(actor);
  const supabase = getSupabaseServiceClient();
  const org = actor.organizationId;
  const call = async (fn: string, args: Record<string, unknown>): Promise<Row[]> => {
    const { data, error } = await supabase.rpc(fn, { p_org: org, ...args });
    if (error) throw new Error(`Analyse « ${fn} » impossible: ${error.message}`);
    return (data ?? []) as Row[];
  };
  const [dormant, margins, forecast, inactive, results, traffic, demand] = await Promise.all([
    call("c5_dormant_stock", { p_days: params.dormantDays ?? 60 }),
    call("c5_product_margins", { p_days: params.marginDays ?? 30 }),
    call("c5_stockout_forecast", { p_days: params.forecastDays ?? 30 }),
    call("c5_inactive_customers", { p_days: params.inactiveDays ?? 60, p_limit: params.inactiveLimit ?? 50 }),
    call("c5_broadcast_results", { p_window_days: params.resultsWindowDays ?? 7, p_limit: 20 }),
    call("c5_traffic_by_source", { p_days: params.trafficDays ?? 30 }),
    call("c5_product_demand", { p_days: params.demandDays ?? 14 }),
  ]);
  return {
    dormantStock: dormant.map(mapDormant),
    margins: margins.map(mapMargin),
    forecast: forecast.map(mapForecast),
    inactiveCustomers: inactive.map(mapInactive),
    broadcastResults: results.map(mapBroadcast),
    traffic: traffic.map(mapTraffic),
    demand: demand.map(mapDemand),
  };
}
