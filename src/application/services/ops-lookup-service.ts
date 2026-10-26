import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

/**
 * Lectures minces pour l'agent Opérations (C2, étape 6) qui n'existaient pas comme services :
 * recherche de clients et produits à stock bas. Toujours filtrées par `organization_id`.
 */

export interface ContactMatch { id: string; fullName: string | null; phoneE164: string | null }

/** Recherche par nom OU téléphone (fragment). `query` est échappé : jamais interprété comme motif. */
export async function findContacts(organizationId: string, query: string, limit = 5, db: SupabaseClient = getSupabaseServiceClient()): Promise<ContactMatch[]> {
  const q = query.trim().replace(/[%_,()\\]/g, " ").trim();
  if (q.length < 2) return [];
  const [byName, byPhone] = await Promise.all([
    db.from("contacts").select("id, full_name, phone_e164").eq("organization_id", organizationId).ilike("full_name", `%${q}%`).limit(limit),
    db.from("contacts").select("id, full_name, phone_e164").eq("organization_id", organizationId).ilike("phone_e164", `%${q}%`).limit(limit),
  ]);
  if (byName.error) throw new Error(`Recherche de clients impossible: ${byName.error.message}`);
  if (byPhone.error) throw new Error(`Recherche de clients impossible: ${byPhone.error.message}`);
  const seen = new Map<string, ContactMatch>();
  for (const r of [...(byName.data ?? []), ...(byPhone.data ?? [])] as { id: string; full_name: string | null; phone_e164: string | null }[]) {
    if (!seen.has(r.id)) seen.set(r.id, { id: r.id, fullName: r.full_name, phoneE164: r.phone_e164 });
  }
  return [...seen.values()].slice(0, limit);
}

export interface LowStockItem { id: string; name: string; currentStock: number; minStock: number; status: string }

/** Produits actifs/en rupture dont le stock est au plus égal au seuil d'alerte (seuil > 0). */
export async function listLowStock(organizationId: string, limit = 20, db: SupabaseClient = getSupabaseServiceClient()): Promise<LowStockItem[]> {
  const { data, error } = await db.from("products").select("id, name, current_stock, min_stock, status").eq("organization_id", organizationId).in("status", ["active", "out_of_stock"]).order("current_stock", { ascending: true }).limit(500);
  if (error) throw new Error(`Lecture du stock impossible: ${error.message}`);
  return ((data ?? []) as { id: string; name: string; current_stock: number | string; min_stock: number | string | null; status: string }[])
    .map((p) => ({ id: p.id, name: p.name, currentStock: Number(p.current_stock), minStock: Number(p.min_stock ?? 0), status: p.status }))
    .filter((p) => p.minStock > 0 && p.currentStock <= p.minStock)
    .slice(0, limit);
}

/** Un client précis, uniquement s'il appartient à l'entreprise (garde anti-IDOR avant de créer une commande). */
export async function getContact(organizationId: string, contactId: string, db: SupabaseClient = getSupabaseServiceClient()): Promise<ContactMatch | null> {
  const { data, error } = await db.from("contacts").select("id, full_name, phone_e164").eq("organization_id", organizationId).eq("id", contactId).maybeSingle();
  if (error) throw new Error(`Lecture du client impossible: ${error.message}`);
  const r = data as { id: string; full_name: string | null; phone_e164: string | null } | null;
  return r ? { id: r.id, fullName: r.full_name, phoneE164: r.phone_e164 } : null;
}
