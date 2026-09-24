import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

export type TenantExpenseClass = "cost_of_revenue" | "operating" | "tax";

export interface TenantFinancialMonth {
  label: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  taxes: number;
  netProfit: number;
}

export interface TenantFinancialOverview {
  currency: string;
  revenue30d: number;
  cashCollected30d: number;
  cogs30d: number;
  grossProfit30d: number;
  grossMarginPct: number | null;
  operatingExpenses30d: number;
  operatingProfit30d: number;
  taxes30d: number;
  netProfit30d: number;
  netMarginPct: number | null;
  receivablesOpen: number;
  receivablesOverdue: number;
  revenueTrend30d: { label: string; value: number }[];
  grossProfitTrend30d: { label: string; value: number }[];
  netProfitTrend30d: { label: string; value: number }[];
  expenseBreakdown30d: { label: string; value: number }[];
  monthlyTrend: TenantFinancialMonth[];
  topProducts: { label: string; revenue: number; cogs: number; grossProfit: number; marginPct: number | null }[];
}

function money(value: unknown): number { return Number(value ?? 0); }
function safeMargin(profit: number, revenue: number): number | null { return revenue > 0 ? (profit / revenue) * 100 : null; }
function dayKey(d: Date): string { return d.toISOString().slice(0, 10); }
function monthKey(d: Date): string { return d.toISOString().slice(0, 7); }

export async function getTenantFinancialOverview(organizationId: string): Promise<TenantFinancialOverview> {
  const supabase = getSupabaseServiceClient();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const since12 = new Date(); since12.setDate(1); since12.setHours(0, 0, 0, 0); since12.setMonth(since12.getMonth() - 11);

  const [orgResult, revenuesResult, expensesResult, paymentsResult, receivablesResult] = await Promise.all([
    supabase.from("organizations").select("currency").eq("id", organizationId).maybeSingle(),
    supabase.from("revenues").select("id, order_id, amount, currency, revenue_date, created_at").eq("organization_id", organizationId).gte("revenue_date", since12.toISOString().slice(0, 10)).order("revenue_date", { ascending: true }),
    supabase.from("expenses").select("id, amount, expense_date, expense_class, description, supplier, expense_categories(name)").eq("organization_id", organizationId).gte("expense_date", since12.toISOString().slice(0, 10)).order("expense_date", { ascending: false }),
    supabase.from("payments").select("amount, status, created_at").eq("organization_id", organizationId).eq("status", "succeeded").gte("created_at", since30.toISOString()),
    supabase.from("receivables").select("amount_total, amount_paid, due_date, status").eq("organization_id", organizationId).in("status", ["open", "partially_paid", "overdue"]),
  ]);
  if (orgResult.error) throw new Error(`Lecture entreprise impossible: ${orgResult.error.message}`);
  if (revenuesResult.error) throw new Error(`Lecture revenus impossible: ${revenuesResult.error.message}`);
  if (expensesResult.error) throw new Error(`Lecture dépenses impossible: ${expensesResult.error.message}`);
  if (paymentsResult.error) throw new Error(`Lecture encaissements impossible: ${paymentsResult.error.message}`);
  if (receivablesResult.error) throw new Error(`Lecture créances impossible: ${receivablesResult.error.message}`);

  const revenues = (revenuesResult.data ?? []) as { id: string; order_id: string | null; amount: number; revenue_date: string; created_at: string }[];
  const expenses = (expensesResult.data ?? []) as { id: string; amount: number; expense_date: string; expense_class: TenantExpenseClass; description: string | null; supplier: string | null; expense_categories?: { name?: string | null } | null }[];
  const orderIds = revenues.map((r) => r.order_id).filter((id): id is string => Boolean(id));

  let itemRows: { order_id: string; product_id: string | null; label: string; unit_price: number; unit_cost: number; quantity: number }[] = [];
  if (orderIds.length) {
    const { data, error } = await supabase.from("order_items").select("order_id, product_id, label, unit_price, unit_cost, quantity").eq("organization_id", organizationId).in("order_id", orderIds);
    if (error) throw new Error(`Lecture coûts des ventes impossible: ${error.message}`);
    itemRows = (data ?? []) as typeof itemRows;
  }

  const cogsByOrder = new Map<string, number>();
  const productTotals = new Map<string, { label: string; revenue: number; cogs: number }>();
  for (const item of itemRows) {
    const cogs = money(item.unit_cost) * money(item.quantity);
    cogsByOrder.set(item.order_id, (cogsByOrder.get(item.order_id) ?? 0) + cogs);
    const key = item.product_id ?? item.label;
    const current = productTotals.get(key) ?? { label: item.label, revenue: 0, cogs: 0 };
    current.revenue += money(item.unit_price) * money(item.quantity);
    current.cogs += cogs;
    productTotals.set(key, current);
  }

  const revenue30 = revenues.filter((r) => r.revenue_date >= since30.toISOString().slice(0, 10)).reduce((s, r) => s + money(r.amount), 0);
  const cogs30 = revenues.filter((r) => r.revenue_date >= since30.toISOString().slice(0, 10)).reduce((s, r) => s + (r.order_id ? (cogsByOrder.get(r.order_id) ?? 0) : 0), 0);
  const operatingExpenses30 = expenses.filter((e) => e.expense_date >= since30.toISOString().slice(0, 10) && e.expense_class === "operating").reduce((s, e) => s + money(e.amount), 0);
  const taxes30 = expenses.filter((e) => e.expense_date >= since30.toISOString().slice(0, 10) && e.expense_class === "tax").reduce((s, e) => s + money(e.amount), 0);
  const costExpenses30 = expenses.filter((e) => e.expense_date >= since30.toISOString().slice(0, 10) && e.expense_class === "cost_of_revenue").reduce((s, e) => s + money(e.amount), 0);
  const totalCogs30 = cogs30 + costExpenses30;
  const grossProfit30d = revenue30 - totalCogs30;
  const operatingProfit30d = grossProfit30d - operatingExpenses30;
  const netProfit30d = operatingProfit30d - taxes30;
  const cashCollected30d = (paymentsResult.data ?? []).reduce((s, p) => s + money(p.amount), 0);

  const receivablesOpen = (receivablesResult.data ?? []).reduce((s, r) => s + Math.max(0, money(r.amount_total) - money(r.amount_paid)), 0);
  const receivablesOverdue = (receivablesResult.data ?? []).filter((r) => r.status === "overdue").reduce((s, r) => s + Math.max(0, money(r.amount_total) - money(r.amount_paid)), 0);

  const revenueMap = new Map<string, number>();
  const cogsMap = new Map<string, number>();
  const opMap = new Map<string, number>();
  const taxMap = new Map<string, number>();
  const formatter = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" });
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    revenueMap.set(dayKey(d), 0); cogsMap.set(dayKey(d), 0); opMap.set(dayKey(d), 0); taxMap.set(dayKey(d), 0);
  }
  for (const r of revenues) if (revenueMap.has(r.revenue_date)) {
    revenueMap.set(r.revenue_date, (revenueMap.get(r.revenue_date) ?? 0) + money(r.amount));
    if (r.order_id) cogsMap.set(r.revenue_date, (cogsMap.get(r.revenue_date) ?? 0) + (cogsByOrder.get(r.order_id) ?? 0));
  }
  for (const e of expenses) if (revenueMap.has(e.expense_date)) {
    if (e.expense_class === "operating") opMap.set(e.expense_date, (opMap.get(e.expense_date) ?? 0) + money(e.amount));
    if (e.expense_class === "tax") taxMap.set(e.expense_date, (taxMap.get(e.expense_date) ?? 0) + money(e.amount));
    if (e.expense_class === "cost_of_revenue") cogsMap.set(e.expense_date, (cogsMap.get(e.expense_date) ?? 0) + money(e.amount));
  }
  const revenueTrend30d: { label: string; value: number }[] = [];
  const grossProfitTrend30d: { label: string; value: number }[] = [];
  const netProfitTrend30d: { label: string; value: number }[] = [];
  for (const [date, revenue] of revenueMap) {
    const d = new Date(`${date}T00:00:00`); const cogs = cogsMap.get(date) ?? 0; const op = opMap.get(date) ?? 0; const tax = taxMap.get(date) ?? 0;
    revenueTrend30d.push({ label: formatter.format(d), value: revenue });
    grossProfitTrend30d.push({ label: formatter.format(d), value: revenue - cogs });
    netProfitTrend30d.push({ label: formatter.format(d), value: revenue - cogs - op - tax });
  }

  const monthlyMap = new Map<string, TenantFinancialMonth>();
  const monthFormatter = new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric" });
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    monthlyMap.set(monthKey(d), { label: monthFormatter.format(d), revenue: 0, cogs: 0, grossProfit: 0, operatingExpenses: 0, taxes: 0, netProfit: 0 });
  }
  for (const r of revenues) {
    const row = monthlyMap.get(r.revenue_date.slice(0, 7)); if (!row) continue;
    row.revenue += money(r.amount); if (r.order_id) row.cogs += cogsByOrder.get(r.order_id) ?? 0;
  }
  for (const e of expenses) {
    const row = monthlyMap.get(e.expense_date.slice(0, 7)); if (!row) continue;
    if (e.expense_class === "cost_of_revenue") row.cogs += money(e.amount);
    if (e.expense_class === "operating") row.operatingExpenses += money(e.amount);
    if (e.expense_class === "tax") row.taxes += money(e.amount);
  }
  const monthlyTrend = [...monthlyMap.values()].map((m) => ({ ...m, grossProfit: m.revenue - m.cogs, netProfit: m.revenue - m.cogs - m.operatingExpenses - m.taxes }));

  const expenseBreakdownMap = new Map<string, number>();
  for (const e of expenses.filter((e) => e.expense_date >= since30.toISOString().slice(0, 10))) {
    const label = e.expense_categories?.name ?? e.description ?? "Autre";
    expenseBreakdownMap.set(label, (expenseBreakdownMap.get(label) ?? 0) + money(e.amount));
  }
  const expenseBreakdown30d = [...expenseBreakdownMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }));
  const topProducts = [...productTotals.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8).map((p) => ({ ...p, grossProfit: p.revenue - p.cogs, marginPct: safeMargin(p.revenue - p.cogs, p.revenue) }));

  return {
    currency: orgResult.data?.currency ?? "XAF",
    revenue30d: revenue30,
    cashCollected30d,
    cogs30d: totalCogs30,
    grossProfit30d,
    grossMarginPct: safeMargin(grossProfit30d, revenue30),
    operatingExpenses30d: operatingExpenses30,
    operatingProfit30d,
    taxes30d: taxes30,
    netProfit30d,
    netMarginPct: safeMargin(netProfit30d, revenue30),
    receivablesOpen,
    receivablesOverdue,
    revenueTrend30d,
    grossProfitTrend30d,
    netProfitTrend30d,
    expenseBreakdown30d,
    monthlyTrend,
    topProducts,
  };
}
