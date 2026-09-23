import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { ValidationError } from "@/lib/errors";
import { getPlatformSettingNumber, setPlatformSetting } from "./platform-settings-service";
import { writeAdminAuditLog } from "./admin-organizations-service";

export const ZERNIO_PRICING = {
  freeAccounts: 2,
  tiers: [
    { from: 3, to: 10, priceUsd: 6 },
    { from: 11, to: 100, priceUsd: 3 },
    { from: 101, to: 2000, priceUsd: 1 },
  ],
} as const;

export const PLATFORM_COST_CATEGORIES = [
  "zernio", "hosting", "database", "storage", "email", "ai", "payment", "domain",
  "phone", "marketing", "affiliate", "salary", "legal", "accounting", "monitoring", "other",
] as const;
export type PlatformCostCategory = (typeof PLATFORM_COST_CATEGORIES)[number];
export type ExpenseClass = "cost_of_revenue" | "operating" | "tax";

export interface ZernioCostBreakdown {
  connectedAccounts: number;
  freeAccounts: number;
  billableAccounts: number;
  tier6Accounts: number;
  tier3Accounts: number;
  tier1Accounts: number;
  over2000Accounts: number;
  grossMonthlyUsd: number;
  freeCreditUsd: number;
  netMonthlyUsd: number;
}

export function calculateZernioMonthlyCost(connectedAccounts: number): ZernioCostBreakdown {
  const accounts = Math.max(0, Math.floor(connectedAccounts));
  const tier6Accounts = Math.max(0, Math.min(accounts, 10) - 2);
  const tier3Accounts = Math.max(0, Math.min(accounts, 100) - 10);
  const tier1Accounts = Math.max(0, Math.min(accounts, 2000) - 100);
  const over2000Accounts = Math.max(0, accounts - 2000);
  // Zernio's current pricing remains $1/account from account 101 onward,
  // including accounts above 2,000. The calculator is a run-rate estimate
  // for the current connected-account count; Zernio itself prorates changes
  // by day during the month.
  const grossMonthlyUsd = tier6Accounts * 6 + tier3Accounts * 3 + tier1Accounts + over2000Accounts;
  return {
    connectedAccounts: accounts,
    freeAccounts: Math.min(accounts, 2),
    billableAccounts: Math.max(0, accounts - 2),
    tier6Accounts,
    tier3Accounts,
    tier1Accounts,
    over2000Accounts,
    grossMonthlyUsd,
    freeCreditUsd: 12,
    netMonthlyUsd: grossMonthlyUsd,
  };
}

export interface PlatformCost {
  id: string;
  provider: string;
  label: string;
  category: PlatformCostCategory;
  costClass: ExpenseClass;
  billingType: "fixed" | "usage" | "one_time";
  billingCycle: "monthly" | "annual" | "one_time";
  monthlyBudgetFcfa: number | null;
  monthlyBudgetUsd: number | null;
  active: boolean;
  startsOn: string;
  endsOn: string | null;
  notes: string | null;
}

export interface PlatformExpense {
  id: string;
  category: string;
  label: string;
  amountFcfa: number;
  expenseClass: ExpenseClass;
  expenseDate: string;
  vendor: string | null;
  notes: string | null;
  createdAt: string;
}

export interface FinancialMonth {
  label: string;
  grossRevenue: number;
  refunds: number;
  netRevenue: number;
  costOfRevenue: number;
  grossProfit: number;
  operatingExpenses: number;
  taxes: number;
  netProfit: number;
}

export interface AdminFinancialOverview {
  periodDays: number;
  grossRevenue30dFcfa: number;
  refunds30dFcfa: number;
  netRevenue30dFcfa: number;
  costOfRevenue30dFcfa: number;
  grossProfit30dFcfa: number;
  grossMargin30dPct: number | null;
  operatingExpenses30dFcfa: number;
  operatingProfit30dFcfa: number;
  taxes30dFcfa: number;
  netProfit30dFcfa: number;
  netMargin30dPct: number | null;
  expenses30dFcfa: number;
  revenue30dFcfa: number;
  net30dFcfa: number;
  subscribersByPlan: { planKey: string; planName: string; count: number; revenue30d: number }[];
  revenueTrend30d: { label: string; value: number }[];
  expenseTrend30d: { label: string; value: number }[];
  profitTrend30d: { label: string; value: number }[];
  twelveMonthTrend: FinancialMonth[];
  expenseBreakdown30d: { label: string; value: number; category: string }[];
  zernio: ZernioCostBreakdown;
  zernioUsdToXaf: number;
  recurringCosts: PlatformCost[];
  recurringBudgetFcfa: number;
  recentExpenses: PlatformExpense[];
}

function dayKey(date: Date): string { return date.toISOString().slice(0, 10); }
function monthKey(date: Date): string { return date.toISOString().slice(0, 7); }
function safeMargin(profit: number, revenue: number): number | null { return revenue > 0 ? (profit / revenue) * 100 : null; }
function money(value: unknown): number { return Number(value ?? 0); }

function make30DaySeries(
  payments: { created_at: string; amount_fcfa: number; status: string }[],
  expenses: { expense_date: string; amount_fcfa: number }[],
) {
  const rev = new Map<string, number>();
  const exp = new Map<string, number>();
  for (const row of payments) {
    const key = dayKey(new Date(row.created_at));
    const amount = money(row.amount_fcfa);
    const signed = row.status === "refunded" ? -amount : row.status === "completed" ? amount : 0;
    rev.set(key, (rev.get(key) ?? 0) + signed);
  }
  for (const row of expenses) exp.set(row.expense_date, (exp.get(row.expense_date) ?? 0) + money(row.amount_fcfa));
  const formatter = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" });
  const revenueTrend30d: { label: string; value: number }[] = [];
  const expenseTrend30d: { label: string; value: number }[] = [];
  const profitTrend30d: { label: string; value: number }[] = [];
  for (let i = 29; i >= 0; i -= 1) {
    const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - i);
    const key = dayKey(date); const label = formatter.format(date);
    const revenue = rev.get(key) ?? 0; const expense = exp.get(key) ?? 0;
    revenueTrend30d.push({ label, value: revenue });
    expenseTrend30d.push({ label, value: expense });
    profitTrend30d.push({ label, value: revenue - expense });
  }
  return { revenueTrend30d, expenseTrend30d, profitTrend30d };
}

function buildMonthlySeries(
  payments: { created_at: string; amount_fcfa: number; status: string }[],
  expenses: { expense_date: string; amount_fcfa: number; expense_class: ExpenseClass }[],
  months = 12,
): FinancialMonth[] {
  const map = new Map<string, FinancialMonth>();
  const formatter = new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric" });
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() - i);
    map.set(monthKey(d), { label: formatter.format(d), grossRevenue: 0, refunds: 0, netRevenue: 0, costOfRevenue: 0, grossProfit: 0, operatingExpenses: 0, taxes: 0, netProfit: 0 });
  }
  for (const p of payments) {
    const row = map.get(monthKey(new Date(p.created_at))); if (!row) continue;
    const amount = money(p.amount_fcfa);
    if (p.status === "refunded") { row.grossRevenue += amount; row.refunds += amount; }
    else if (p.status === "completed") { row.grossRevenue += amount; row.netRevenue += amount; }
  }
  // A refunded payment remains a historical gross sale and a refund; therefore
  // the monthly net is gross sales minus refunds. A completed payment is both
  // gross and net revenue.
  for (const e of expenses) {
    const row = map.get(e.expense_date.slice(0, 7)); if (!row) continue;
    const amount = money(e.amount_fcfa);
    if (e.expense_class === "cost_of_revenue") row.costOfRevenue += amount;
    else if (e.expense_class === "tax") row.taxes += amount;
    else row.operatingExpenses += amount;
  }
  return [...map.values()].map((row) => ({
    ...row,
    grossProfit: row.netRevenue - row.costOfRevenue,
    netProfit: row.netRevenue - row.costOfRevenue - row.operatingExpenses - row.taxes,
  }));
}

export async function getAdminFinancialOverview(): Promise<AdminFinancialOverview> {
  const supabase = getSupabaseServiceClient();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since12 = new Date(); since12.setDate(1); since12.setMonth(since12.getMonth() - 11); since12.setHours(0, 0, 0, 0);
  const since12Iso = since12.toISOString();

  const [
    payments30Result,
    payments12Result,
    expenses30Result,
    expenses12Result,
    subsResult,
    plansResult,
    socialResult,
    whatsappResult,
    rate,
    recurringResult,
  ] = await Promise.all([
    supabase.from("subscription_payments").select("amount_fcfa, created_at, status, plan_key, payment_type").in("status", ["completed", "refunded"]).gte("created_at", since30),
    supabase.from("subscription_payments").select("amount_fcfa, created_at, status").in("status", ["completed", "refunded"]).gte("created_at", since12Iso),
    supabase.from("platform_expenses").select("id, category, label, amount_fcfa, expense_class, expense_date, vendor, notes, created_at").gte("expense_date", since30.slice(0, 10)).order("expense_date", { ascending: false }),
    supabase.from("platform_expenses").select("expense_date, amount_fcfa, expense_class").gte("expense_date", since12.toISOString().slice(0, 10)),
    supabase.from("organization_subscriptions").select("plan_key, status").eq("status", "active"),
    supabase.from("plans").select("key, name"),
    supabase.from("social_accounts").select("id", { count: "exact", head: true }).eq("status", "connected"),
    supabase.from("whatsapp_accounts").select("id", { count: "exact", head: true }).eq("status", "connected"),
    getPlatformSettingNumber("zernio_usd_to_xaf_rate", 600),
    supabase.from("platform_costs").select("id, provider, label, category, cost_class, billing_type, billing_cycle, monthly_budget_fcfa, monthly_budget_usd, active, starts_on, ends_on, notes").eq("active", true).order("category"),
  ]);

  for (const result of [payments30Result, payments12Result, expenses30Result, expenses12Result, subsResult, plansResult, socialResult, whatsappResult, recurringResult]) {
    if (result.error) throw new Error(`Lecture finance impossible: ${result.error.message}`);
  }

  const payments30 = (payments30Result.data ?? []) as { amount_fcfa: number; created_at: string; status: string; plan_key: string | null; payment_type: string }[];
  const payments12 = (payments12Result.data ?? []) as { amount_fcfa: number; created_at: string; status: string }[];
  const expenses30 = (expenses30Result.data ?? []) as { id: string; category: string; label: string; amount_fcfa: number; expense_class: ExpenseClass; expense_date: string; vendor: string | null; notes: string | null; created_at: string }[];
  const expenses12 = (expenses12Result.data ?? []) as { expense_date: string; amount_fcfa: number; expense_class: ExpenseClass }[];

  const grossRevenue30dFcfa = payments30.reduce((s, p) => s + money(p.amount_fcfa), 0);
  const refunds30dFcfa = payments30.filter((p) => p.status === "refunded").reduce((s, p) => s + money(p.amount_fcfa), 0);
  const netRevenue30dFcfa = Math.max(0, grossRevenue30dFcfa - refunds30dFcfa);
  const costOfRevenue30dFcfa = expenses30.filter((e) => e.expense_class === "cost_of_revenue").reduce((s, e) => s + money(e.amount_fcfa), 0);
  const operatingExpenses30dFcfa = expenses30.filter((e) => e.expense_class === "operating").reduce((s, e) => s + money(e.amount_fcfa), 0);
  const taxes30dFcfa = expenses30.filter((e) => e.expense_class === "tax").reduce((s, e) => s + money(e.amount_fcfa), 0);
  const grossProfit30dFcfa = netRevenue30dFcfa - costOfRevenue30dFcfa;
  const operatingProfit30dFcfa = grossProfit30dFcfa - operatingExpenses30dFcfa;
  const netProfit30dFcfa = operatingProfit30dFcfa - taxes30dFcfa;
  const expenses30dFcfa = costOfRevenue30dFcfa + operatingExpenses30dFcfa + taxes30dFcfa;

  const plans = new Map((plansResult.data ?? []).map((p) => [p.key as string, p.name as string]));
  const counts = new Map<string, number>();
  for (const sub of subsResult.data ?? []) counts.set(sub.plan_key as string, (counts.get(sub.plan_key as string) ?? 0) + 1);
  const revenueByPlan = new Map<string, number>();
  for (const payment of payments30.filter((p) => p.status === "completed" && p.payment_type === "plan_subscription" && p.plan_key)) {
    revenueByPlan.set(payment.plan_key as string, (revenueByPlan.get(payment.plan_key as string) ?? 0) + money(payment.amount_fcfa));
  }
  const subscribersByPlan = [...counts.entries()].map(([planKey, count]) => ({ planKey, planName: plans.get(planKey) ?? planKey, count, revenue30d: revenueByPlan.get(planKey) ?? 0 })).sort((a, b) => b.count - a.count);

  const expenseBreakdownMap = new Map<string, number>();
  for (const e of expenses30) expenseBreakdownMap.set(e.category, (expenseBreakdownMap.get(e.category) ?? 0) + money(e.amount_fcfa));
  const expenseBreakdown30d = [...expenseBreakdownMap.entries()].sort((a, b) => b[1] - a[1]).map(([category, value]) => ({ label: category, category, value }));

  const { revenueTrend30d, expenseTrend30d, profitTrend30d } = make30DaySeries(
    payments30,
    expenses30,
  );
  const twelveMonthTrend = buildMonthlySeries(payments12, expenses12);

  // Zernio bills connected accounts, not profiles. WhatsApp group provider
  // connections are profiles/configuration records and must NOT be counted
  // as another connected account. YouTube is a direct Google connection in
  // this project and is therefore not a Zernio account either.
  const connectedAccounts = (socialResult.count ?? 0) + (whatsappResult.count ?? 0);
  const zernio = calculateZernioMonthlyCost(connectedAccounts);
  const recurringCosts: PlatformCost[] = (recurringResult.data ?? []).map((c) => ({
    id: c.id, provider: c.provider, label: c.label, category: c.category as PlatformCostCategory,
    costClass: c.cost_class as ExpenseClass, billingType: c.billing_type, billingCycle: c.billing_cycle,
    monthlyBudgetFcfa: c.monthly_budget_fcfa == null ? null : money(c.monthly_budget_fcfa),
    monthlyBudgetUsd: c.monthly_budget_usd == null ? null : money(c.monthly_budget_usd), active: c.active,
    startsOn: c.starts_on, endsOn: c.ends_on, notes: c.notes,
  }));
  const recurringBudgetFcfa = recurringCosts.reduce((sum, c) => sum + (c.monthlyBudgetFcfa ?? 0) + ((c.monthlyBudgetUsd ?? 0) * rate), 0);

  return {
    periodDays: 30,
    grossRevenue30dFcfa, refunds30dFcfa, netRevenue30dFcfa, costOfRevenue30dFcfa,
    grossProfit30dFcfa, grossMargin30dPct: safeMargin(grossProfit30dFcfa, netRevenue30dFcfa),
    operatingExpenses30dFcfa, operatingProfit30dFcfa, taxes30dFcfa, netProfit30dFcfa,
    netMargin30dPct: safeMargin(netProfit30dFcfa, netRevenue30dFcfa), expenses30dFcfa,
    revenue30dFcfa: netRevenue30dFcfa, net30dFcfa: netProfit30dFcfa,
    subscribersByPlan, revenueTrend30d, expenseTrend30d, profitTrend30d, twelveMonthTrend,
    expenseBreakdown30d, zernio, zernioUsdToXaf: rate, recurringCosts, recurringBudgetFcfa,
    recentExpenses: expenses30.slice(0, 12).map((e) => ({ id: e.id, category: e.category, label: e.label, amountFcfa: money(e.amount_fcfa), expenseClass: e.expense_class, expenseDate: e.expense_date, vendor: e.vendor, notes: e.notes, createdAt: e.created_at })),
  };
}

export async function createPlatformExpense(input: {
  category: string; label: string; amountFcfa: number; expenseDate: string; vendor?: string; notes?: string; expenseClass?: ExpenseClass;
}, actorUserId: string): Promise<void> {
  const label = input.label.trim();
  if (!label) throw new ValidationError("Le libellé de la dépense est requis.");
  if (!Number.isFinite(input.amountFcfa) || input.amountFcfa <= 0) throw new ValidationError("Le montant de la dépense est invalide.");
  if (!PLATFORM_COST_CATEGORIES.includes(input.category as PlatformCostCategory)) throw new ValidationError("Catégorie de dépense invalide.");
  const expenseClass = input.expenseClass ?? "operating";
  if (!("cost_of_revenue" === expenseClass || "operating" === expenseClass || "tax" === expenseClass)) throw new ValidationError("Classe de dépense invalide.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expenseDate)) throw new ValidationError("Date de dépense invalide.");
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("platform_expenses").insert({
    category: input.category, label: label.slice(0, 160), amount_fcfa: Math.round(input.amountFcfa), expense_date: input.expenseDate,
    vendor: input.vendor?.trim().slice(0, 160) || null, notes: input.notes?.trim().slice(0, 1000) || null,
    expense_class: expenseClass, created_by: actorUserId,
  }).select("id").single();
  if (error) throw new Error(`Impossible d'enregistrer la dépense: ${error.message}`);
  await writeAdminAuditLog({ actorUserId, organizationId: null, action: "PLATFORM_EXPENSE_CREATED", entityType: "platform_expense", entityId: data.id,
    beforeState: null, afterState: { category: input.category, label, amountFcfa: Math.round(input.amountFcfa), expenseDate: input.expenseDate, vendor: input.vendor ?? null, expenseClass }, });
}

export async function updateZernioUsdToXafRate(value: number, actorUserId: string): Promise<void> {
  if (!Number.isFinite(value) || value <= 0) throw new ValidationError("Le taux USD/FCFA doit être supérieur à 0.");
  await setPlatformSetting("zernio_usd_to_xaf_rate", Math.round(value * 100) / 100, actorUserId);
}

export async function updatePlatformCost(input: {
  id: string;
  monthlyBudgetFcfa?: number | null;
  monthlyBudgetUsd?: number | null;
  active?: boolean;
  notes?: string | null;
}, actorUserId: string): Promise<void> {
  if (!input.id.trim()) throw new ValidationError("Coût récurrent introuvable.");
  if ((input.monthlyBudgetFcfa ?? 0) < 0 || (input.monthlyBudgetUsd ?? 0) < 0) {
    throw new ValidationError("Le budget ne peut pas être négatif.");
  }
  const supabase = getSupabaseServiceClient();
  const { data: before, error: readError } = await supabase
    .from("platform_costs")
    .select("id, monthly_budget_fcfa, monthly_budget_usd, active, notes")
    .eq("id", input.id)
    .maybeSingle();
  if (readError || !before) throw new Error(`Impossible de lire le coût récurrent: ${readError?.message ?? "introuvable"}`);

  const patch = {
    monthly_budget_fcfa: input.monthlyBudgetFcfa ?? null,
    monthly_budget_usd: input.monthlyBudgetUsd ?? null,
    active: input.active ?? true,
    notes: input.notes?.trim().slice(0, 1000) || null,
  };
  const { error } = await supabase.from("platform_costs").update(patch).eq("id", input.id);
  if (error) throw new Error(`Impossible de mettre à jour le coût récurrent: ${error.message}`);
  await writeAdminAuditLog({
    actorUserId, organizationId: null, action: "PLATFORM_COST_UPDATED", entityType: "platform_cost", entityId: input.id,
    beforeState: before, afterState: patch,
  });
}

export async function createPlatformCost(input: {
  provider: string; label: string; category: PlatformCostCategory; costClass: ExpenseClass; billingType: "fixed" | "usage" | "one_time";
  billingCycle: "monthly" | "annual" | "one_time"; monthlyBudgetFcfa?: number | null; monthlyBudgetUsd?: number | null; startsOn: string; endsOn?: string | null; notes?: string;
}, actorUserId: string) {
  if (!input.provider.trim() || !input.label.trim()) throw new ValidationError("Fournisseur et libellé sont requis.");
  if ((input.monthlyBudgetFcfa ?? 0) < 0 || (input.monthlyBudgetUsd ?? 0) < 0) throw new ValidationError("Le budget ne peut pas être négatif.");
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("platform_costs").insert({
    provider: input.provider.trim().slice(0, 120), label: input.label.trim().slice(0, 160), category: input.category,
    cost_class: input.costClass, billing_type: input.billingType, billing_cycle: input.billingCycle,
    monthly_budget_fcfa: input.monthlyBudgetFcfa ?? null, monthly_budget_usd: input.monthlyBudgetUsd ?? null,
    starts_on: input.startsOn, ends_on: input.endsOn || null, notes: input.notes?.trim().slice(0, 1000) || null, created_by: actorUserId,
  }).select("id").single();
  if (error) throw new Error(`Impossible d'enregistrer le coût récurrent: ${error.message}`);
  await writeAdminAuditLog({ actorUserId, organizationId: null, action: "PLATFORM_COST_CREATED", entityType: "platform_cost", entityId: data.id, beforeState: null, afterState: input });
}
