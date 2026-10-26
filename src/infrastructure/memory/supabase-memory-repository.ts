/** Dépôt Supabase de la mémoire d'entreprise (fonctions SQL de la migration 0108, service-role). */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryHit, MemoryKind, MemoryRepository } from "@/application/memory/memory-service";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

/** Littéral pgvector : `[0.1,0.2,…]` (PostgREST le convertit en `vector`). */
export const toVectorLiteral = (v: number[]) => `[${v.join(",")}]`;

async function rpc(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

export function createSupabaseMemoryRepository(db: SupabaseClient = getSupabaseServiceClient()): MemoryRepository {
  return {
    async existsByHash(tenantId, hash) {
      const { data, error } = await db.from("tenant_memory").select("id").eq("organization_id", tenantId).eq("content_hash", hash).eq("status", "active").maybeSingle();
      if (error) throw new Error(`tenant_memory: ${error.message}`);
      return !!data;
    },
    async upsert(i) {
      const rows = (await rpc(db, "memory_upsert", {
        p_organization_id: i.tenantId, p_kind: i.kind, p_content: i.content, p_hash: i.hash, p_embedding: toVectorLiteral(i.embedding),
        p_model: i.model, p_source: i.source, p_created_by: i.createdBy, p_expires_at: i.expiresAt?.toISOString() ?? null, p_max_active: i.maxActive,
      })) as Array<{ out_status: string; out_id: string | null }>;
      const r = rows[0];
      const status = r?.out_status === "created" || r?.out_status === "duplicate" ? r.out_status : "quota_exceeded";
      return { status, id: r?.out_id ?? undefined };
    },
    async search(tenantId, embedding, limit, minSimilarity) {
      const rows = (await rpc(db, "memory_search", {
        p_organization_id: tenantId, p_embedding: toVectorLiteral(embedding), p_limit: limit, p_min_similarity: minSimilarity,
      })) as Array<Record<string, unknown>> | null;
      return (rows ?? []).map((r): MemoryHit => ({
        id: String(r.id), kind: r.kind as MemoryKind, content: String(r.content), source: String(r.source), similarity: Number(r.similarity),
      }));
    },
    async archive(tenantId, id) {
      return (await rpc(db, "memory_archive", { p_organization_id: tenantId, p_id: id })) === "archived" ? "archived" : "not_found";
    },
    async erase(tenantId, id) {
      return (await rpc(db, "memory_erase", { p_organization_id: tenantId, p_id: id })) === "erased" ? "erased" : "not_found";
    },
  };
}
