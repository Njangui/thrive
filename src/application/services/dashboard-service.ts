import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

export interface DashboardSummary {
  revenueLast30Days: number;
  expensesLast30Days: number;
  resultLast30Days: number;
  ordersPending: number;
  newLeadsLast7Days: number;
  customersCount: number;
  conversationsNeedingAttention: number;
  productsOutOfStock: number;
  postsScheduled: number;
  currency: string;
}

/**
 * Une seule fonction qui rassemble tout ce que la section 7 demande sur la
 * vue principale — plusieurs requêtes ciblées en parallèle plutôt qu'un
 * chargement de toute la base (section 40 : "le dashboard ne doit pas
 * charger toute la base").
 */
export async function getDashboardSummary(organizationId: string): Promise<DashboardSummary> {
  const supabase = getSupabaseServiceClient();
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: org },
    { data: revenues },
    { data: expenses },
    { count: ordersPending },
    { count: newLeads },
    { count: customersCount },
    { count: conversationsNeedingAttention },
    { count: productsOutOfStock },
    { count: postsScheduled },
  ] = await Promise.all([
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
    supabase.from("revenues").select("amount").eq("organization_id", organizationId).gte("created_at", since30d),
    supabase.from("expenses").select("amount").eq("organization_id", organizationId).gte("created_at", since30d),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "pending"),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gte("created_at", since7d),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "customer"),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("handoff_status", "pending_human"),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "out_of_stock"),
    supabase
      .from("social_posts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "scheduled"),
  ]);

  const revenueLast30Days = (revenues ?? []).reduce((sum, r) => sum + Number(r.amount), 0);
  const expensesLast30Days = (expenses ?? []).reduce((sum, e) => sum + Number(e.amount), 0);

  return {
    revenueLast30Days,
    expensesLast30Days,
    resultLast30Days: revenueLast30Days - expensesLast30Days,
    ordersPending: ordersPending ?? 0,
    newLeadsLast7Days: newLeads ?? 0,
    customersCount: customersCount ?? 0,
    conversationsNeedingAttention: conversationsNeedingAttention ?? 0,
    productsOutOfStock: productsOutOfStock ?? 0,
    postsScheduled: postsScheduled ?? 0,
    currency: org?.currency ?? "XAF",
  };
}
