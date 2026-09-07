import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { ValidationError } from "@/lib/errors";

const DEFAULT_EXPENSE_CATEGORIES = ["achats", "transport", "publicité", "salaires", "loyer", "fonctionnement", "autres"];

export interface CreateRevenueInput {
  organizationId: string;
  amount: number;
  category?: string;
  source?: string;
  note?: string;
  date?: string; // YYYY-MM-DD
  actorUserId?: string;
}

export interface CreateExpenseInput {
  organizationId: string;
  amount: number;
  categoryName?: string;
  description?: string;
  supplier?: string;
  date?: string;
  actorUserId?: string;
}

export interface FinanceEntry {
  id: string;
  type: "revenue" | "expense";
  amount: number;
  label: string;
  date: string;
}

async function findOrCreateExpenseCategory(organizationId: string, name: string): Promise<string> {
  const supabase = getSupabaseServiceClient();
  const trimmed = name.trim();

  const { data: existing } = await supabase
    .from("expense_categories")
    .select("id")
    .eq("organization_id", organizationId)
    .ilike("name", trimmed)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("expense_categories")
    .insert({ organization_id: organizationId, name: trimmed })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(`Impossible de créer la catégorie de dépense "${name}": ${error?.message}`);
  }
  return created.id;
}

/** Crée les catégories de dépenses par défaut (section 26) — appelé une fois à l'onboarding. */
export async function seedDefaultExpenseCategories(organizationId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  await supabase
    .from("expense_categories")
    .insert(DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ organization_id: organizationId, name })));
}

export async function createRevenue(input: CreateRevenueInput): Promise<{ revenueId: string }> {
  if (input.amount <= 0) throw new ValidationError("Le montant doit être positif");

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("revenues")
    .insert({
      organization_id: input.organizationId,
      amount: input.amount,
      category: input.category ?? null,
      source: input.source ?? "manuel",
      revenue_date: input.date ?? new Date().toISOString().slice(0, 10),
      note: input.note ?? null,
      created_by: input.actorUserId,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Impossible d'enregistrer le revenu: ${error?.message}`);
  return { revenueId: data.id };
}

export async function createExpense(input: CreateExpenseInput): Promise<{ expenseId: string }> {
  if (input.amount <= 0) throw new ValidationError("Le montant doit être positif");

  const supabase = getSupabaseServiceClient();
  const categoryId = input.categoryName
    ? await findOrCreateExpenseCategory(input.organizationId, input.categoryName)
    : null;

  const { data, error } = await supabase
    .from("expenses")
    .insert({
      organization_id: input.organizationId,
      amount: input.amount,
      category_id: categoryId,
      expense_date: input.date ?? new Date().toISOString().slice(0, 10),
      description: input.description ?? null,
      supplier: input.supplier ?? null,
      created_by: input.actorUserId,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Impossible d'enregistrer la dépense: ${error?.message}`);
  return { expenseId: data.id };
}

/** Historique combiné le plus récent, pour l'écran Finance (section 53). */
export async function listRecentFinanceEntries(organizationId: string, limit = 20): Promise<FinanceEntry[]> {
  const supabase = getSupabaseServiceClient();

  const [{ data: revenues }, { data: expenses }] = await Promise.all([
    supabase
      .from("revenues")
      .select("id, amount, category, source, revenue_date")
      .eq("organization_id", organizationId)
      .order("revenue_date", { ascending: false })
      .limit(limit),
    supabase
      .from("expenses")
      .select("id, amount, description, expense_date, expense_categories(name)")
      .eq("organization_id", organizationId)
      .order("expense_date", { ascending: false })
      .limit(limit),
  ]);

  const revenueEntries: FinanceEntry[] = (revenues ?? []).map((r) => ({
    id: r.id,
    type: "revenue",
    amount: Number(r.amount),
    label: r.category ?? r.source ?? "Revenu",
    date: r.revenue_date,
  }));

  const expenseEntries: FinanceEntry[] = (expenses ?? []).map((e) => ({
    id: e.id,
    type: "expense",
    amount: Number(e.amount),
    label:
      (e as unknown as { expense_categories?: { name?: string } }).expense_categories?.name ??
      e.description ??
      "Dépense",
    date: e.expense_date,
  }));

  return [...revenueEntries, ...expenseEntries]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, limit);
}
