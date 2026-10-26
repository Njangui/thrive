/**
 * Dépôts Supabase du registre d'usage (P3). Toute la logique d'atomicité vit
 * dans les fonctions SQL de la migration 0104 ; ici : appels rpc + effets de
 * bord best-effort (bonus promo, journal ai_usage_events).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UsageChargeInput } from "@/application/agents/contracts";
import { initializeCreditBalance } from "@/application/services/ai-credits-service";
import type { UsageLedgerRepository } from "@/application/usage/usage-service";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

type Row = Record<string, unknown>;

async function rpc(db: SupabaseClient, fn: string, args: Row): Promise<Row[]> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  if (data == null) return [];
  return Array.isArray(data) ? (data as Row[]) : [{ value: data } as Row];
}

const chargeArgs = (i: UsageChargeInput) => ({
  p_organization_id: i.tenantId, p_actor_id: i.actorId, p_kind: i.kind, p_units: i.units, p_ref: i.ref,
});

export function createSupabaseUsageRepository(db: SupabaseClient = getSupabaseServiceClient()): UsageLedgerRepository {
  const prepare = async (i: UsageChargeInput) => {
  };
  const journal = async (i: UsageChargeInput, status: string) => {
    if (i.kind !== "ai" || status === "duplicate" || status === "insufficient") return;
    try {
      await db.from("ai_usage_events").insert({
        organization_id: i.tenantId, type: "consumption", amount: i.units, reason: "agent_run", metadata: { ref: i.ref },
      });
    } catch { /* journal best-effort */ }
  };
  const withInit = async (fn: string, i: UsageChargeInput) => {
    let rows = await rpc(db, fn, chargeArgs(i));
    if (rows[0]?.out_status === "insufficient" && i.kind === "ai") {
      // Compte antérieur au mécanisme : initialiser puis UNE seule nouvelle tentative.
      await initializeCreditBalance(i.tenantId);
      rows = await rpc(db, fn, chargeArgs(i));
    }
    return rows[0] ?? {};
  };
  return {
    async charge(i) {
      await prepare(i);
      const r = await withInit("usage_charge", i);
      const status = String(r.out_status) as "charged" | "duplicate" | "insufficient";
      await journal(i, status);
      return { status, source: r.out_source as "plan" | "wallet" | undefined, lowBalance: r.out_low_balance === true };
    },
    async reserve(i) {
      await prepare(i);
      const r = await withInit("usage_reserve", i);
      return {
        status: String(r.out_status) as "reserved" | "duplicate" | "insufficient",
        source: r.out_source as "plan" | "wallet" | undefined, lowBalance: r.out_low_balance === true,
      };
    },
    async commit(tenantId, ref) {
      const r = await rpc(db, "usage_commit", { p_organization_id: tenantId, p_ref: ref });
      return String(r[0]?.value ?? "not_found") as "committed" | "duplicate" | "released" | "not_found";
    },
    async release(tenantId, ref) {
      const r = await rpc(db, "usage_release", { p_organization_id: tenantId, p_ref: ref });
      return { status: String(r[0]?.out_status), source: r[0]?.out_source as "plan" | "wallet" | undefined };
    },
    async refund(tenantId, ref, reason) {
      const r = await rpc(db, "usage_refund", { p_organization_id: tenantId, p_ref: ref, p_reason: reason });
      return { status: String(r[0]?.out_status), source: r[0]?.out_source as "plan" | "wallet" | undefined };
    },
  };
}
