/**
 * Implémentations Supabase (service-role) des ports du noyau agentique.
 * Service-role uniquement parce que ces tables n'ont pas de policy d'écriture
 * (0100-0102) : CHAQUE requête filtre explicitement par `organization_id`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MembershipLoader, MembershipRecord } from "@/application/agents/actor";
import type { AuditEvent, AuditSink } from "@/application/agents/audit";
import type { PendingActionRepository, PendingActionRow, TransitionArgs } from "@/application/agents/pending-actions";
import type { AgentProfile, AgentSettings, AgentSettingsRepository, ToolMode, ToolPolicy } from "@/application/agents/settings";
import { AGENT_PROFILES, defaultAgentSettings } from "@/application/agents/settings";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

type Row = Record<string, unknown>;

export function pendingToDb(row: PendingActionRow & { runId?: string }): Row {
  return {
    id: row.id,
    organization_id: row.tenantId,
    tool_name: row.toolName,
    params: row.params,
    params_hash: row.paramsHash,
    params_preview: row.paramsPreview,
    status: row.status,
    requested_by: row.requestedBy,
    channel: row.channel,
    run_id: row.runId ?? null,
    expires_at: row.expiresAt,
  };
}

export function pendingFromDb(db: Row): PendingActionRow {
  return {
    id: db.id as string,
    tenantId: db.organization_id as string,
    toolName: db.tool_name as string,
    params: db.params,
    paramsHash: db.params_hash as string,
    paramsPreview: (db.params_preview ?? {}) as Record<string, unknown>,
    status: db.status as PendingActionRow["status"],
    requestedBy: db.requested_by as string,
    approvedBy: (db.approved_by as string | null) ?? undefined,
    channel: db.channel as PendingActionRow["channel"],
    expiresAt: new Date(db.expires_at as string).toISOString(),
  };
}

const TOOL_MODES: readonly ToolMode[] = ["auto", "confirm", "deny"];

/** Lecture défensive : une entrée illisible devient « confirm » (jamais plus permissive que prévu), sauf « deny » qui est conservé. */
export function sanitizeToolPolicies(raw: unknown): Record<string, ToolPolicy> {
  const out: Record<string, ToolPolicy> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [name, value] of Object.entries(raw as Row)) {
    if (!value || typeof value !== "object") { out[name] = { mode: "confirm" }; continue; }
    const v = value as Row;
    const mode = TOOL_MODES.includes(v.mode as ToolMode) ? (v.mode as ToolMode) : "confirm";
    const amount = typeof v.autoMaxAmount === "number" && v.autoMaxAmount >= 0 ? v.autoMaxAmount : undefined;
    out[name] = amount === undefined ? { mode } : { mode, autoMaxAmount: amount };
  }
  return out;
}

export function settingsFromDb(tenantId: string, db: Row): AgentSettings {
  const autonomy = (db.autonomy ?? {}) as Row;
  const budget = (db.budget ?? {}) as Row;
  const cap = budget.max_units_per_action;
  const profile: AgentProfile = AGENT_PROFILES.includes(db.profile as AgentProfile) ? (db.profile as AgentProfile) : "prudent";
  return {
    tenantId,
    enabledTools: (db.enabled_tools as string[] | null) ?? null,
    autonomy: { write_reversible: autonomy.write_reversible === "allow" ? "allow" : "confirm" },
    budget: typeof cap === "number" && cap >= 0 ? { maxUnitsPerAction: cap } : {},
    profile,
    toolPolicies: sanitizeToolPolicies(db.tool_policies),
  };
}

export class SupabaseAgentSettingsRepository implements AgentSettingsRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseServiceClient()) {}

  async get(tenantId: string): Promise<AgentSettings | null> {
    const { data, error } = await this.client.from("agent_settings").select("*").eq("organization_id", tenantId).maybeSingle();
    if (error) throw new Error(`agent_settings: lecture impossible (${error.message})`);
    return data ? settingsFromDb(tenantId, data as Row) : null;
  }

  async upsert(settings: AgentSettings, updatedBy: string): Promise<void> {
    const base = defaultAgentSettings(settings.tenantId);
    const { error } = await this.client.from("agent_settings").upsert({
      organization_id: settings.tenantId,
      enabled_tools: settings.enabledTools,
      autonomy: { write_reversible: settings.autonomy.write_reversible ?? base.autonomy.write_reversible },
      budget: settings.budget.maxUnitsPerAction === undefined ? {} : { max_units_per_action: settings.budget.maxUnitsPerAction },
      profile: settings.profile,
      tool_policies: settings.toolPolicies,
      updated_by: updatedBy,
    });
    if (error) throw new Error(`agent_settings: écriture impossible (${error.message})`);
  }
}

export class SupabasePendingActionRepository implements PendingActionRepository {
  constructor(private readonly client: SupabaseClient = getSupabaseServiceClient()) {}

  async insert(row: PendingActionRow & { runId?: string }): Promise<PendingActionRow> {
    const { data, error } = await this.client.from("pending_actions").insert(pendingToDb(row)).select("*").single();
    if (error || !data) throw new Error(`pending_actions: insertion impossible (${error?.message})`);
    return pendingFromDb(data as Row);
  }

  async get(tenantId: string, id: string): Promise<PendingActionRow | null> {
    const { data, error } = await this.client
      .from("pending_actions")
      .select("*")
      .eq("organization_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`pending_actions: lecture impossible (${error.message})`);
    return data ? pendingFromDb(data as Row) : null;
  }

  /** UPDATE conditionnel atomique (tenant + statut source [+ non expiré]) : 0 ligne => null. */
  async transition(args: TransitionArgs): Promise<PendingActionRow | null> {
    const now = new Date().toISOString();
    const patch: Row = { status: args.to };
    if (args.approvedBy) patch.approved_by = args.approvedBy;
    if (args.to === "approved" || args.to === "rejected" || args.to === "expired") patch.decided_at = now;
    if (args.to === "executed") patch.executed_at = now;

    let query = this.client
      .from("pending_actions")
      .update(patch)
      .eq("organization_id", args.tenantId)
      .eq("id", args.id)
      .in("status", args.from);
    if (args.notExpiredAt) query = query.gt("expires_at", args.notExpiredAt);
    const { data, error } = await query.select("*").maybeSingle();
    if (error) throw new Error(`pending_actions: transition impossible (${error.message})`);
    return data ? pendingFromDb(data as Row) : null;
  }
}

export class SupabaseAuditSink implements AuditSink {
  constructor(private readonly client: SupabaseClient = getSupabaseServiceClient()) {}

  async record(event: AuditEvent): Promise<void> {
    const { error } = await this.client.from("agent_audit_events").insert({
      organization_id: event.tenantId,
      actor_user_id: event.actorUserId ?? null,
      channel: event.channel,
      run_id: event.runId ?? null,
      tool_name: event.toolName,
      risk: event.risk,
      event: event.event,
      decision: event.decision ?? null,
      reason: event.reason ?? null,
      params_redacted: event.paramsRedacted ?? {},
      pending_action_id: event.pendingActionId ?? null,
      cost: event.cost ?? null,
    });
    if (error) throw new Error(`agent_audit_events: écriture impossible (${error.message})`);
  }
}

/** À n'appeler qu'avec une identité DÉJÀ authentifiée par le canal (session, lien Telegram vérifié…). */
export class SupabaseMembershipLoader implements MembershipLoader {
  constructor(private readonly client: SupabaseClient = getSupabaseServiceClient()) {}

  async load(userId: string, tenantId: string): Promise<MembershipRecord | null> {
    const { data, error } = await this.client
      .from("memberships")
      .select("id, role, extra_permissions")
      .eq("organization_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`memberships: lecture impossible (${error.message})`);
    return data ? { id: data.id as string, role: data.role as MembershipRecord["role"], extra_permissions: data.extra_permissions } : null;
  }
}
