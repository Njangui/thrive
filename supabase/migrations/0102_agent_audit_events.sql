-- ============================================================
-- 0102_agent_audit_events.sql
-- C1 — journal d'audit des agents : APPEND-ONLY (qui, quoi, quand, canal,
-- paramètres expurgés, coût). Distinct de `audit_logs` (0006, avant/après
-- d'entités métier).
--
-- Append-only imposé par trigger (donc aussi contre service-role) :
--   * UPDATE : toujours refusé ;
--   * TRUNCATE : toujours refusé ;
--   * DELETE : refusé, sauf suppression en cascade d'un tenant
--     (pg_trigger_depth() > 1) ou purge de rétention / droit à
--     l'effacement via `purge_agent_audit_events` (SECURITY DEFINER,
--     service-role uniquement).
-- `actor_user_id` n'a volontairement PAS de clé étrangère : une FK
-- `on delete set null` écrirait (UPDATE) dans un journal append-only.
-- ============================================================

create table agent_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  actor_user_id uuid,
  channel text not null
    check (channel in ('dashboard', 'telegram', 'whatsapp', 'scheduler', 'customer')),
  run_id uuid,
  tool_name text not null,
  risk text not null check (risk in ('read', 'write_reversible', 'sensitive')),
  event text not null
    check (event in ('decision', 'approval_requested', 'approved', 'rejected', 'expired', 'executed', 'failed')),
  decision text check (decision in ('allow', 'confirm', 'deny')),
  reason text,
  params_redacted jsonb not null default '{}'::jsonb,
  pending_action_id uuid,
  cost jsonb,
  created_at timestamptz not null default now()
);

create index idx_agent_audit_events_org_created on agent_audit_events(organization_id, created_at desc);
create index idx_agent_audit_events_org_tool on agent_audit_events(organization_id, tool_name);

create or replace function guard_agent_audit_events()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'agent_audit_events est append-only (UPDATE interdit)';
  end if;

  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or current_setting('flexco.audit_purge', true) = 'on' then
      return old;
    end if;
    raise exception 'agent_audit_events est append-only (DELETE interdit)';
  end if;

  return null;
end;
$$;

create trigger trg_agent_audit_events_guard
  before update or delete on agent_audit_events
  for each row execute function guard_agent_audit_events();

-- TRUNCATE contourne les triggers par ligne : garde dédiée.
create or replace function guard_agent_audit_events_truncate()
returns trigger
language plpgsql
as $$
begin
  raise exception 'agent_audit_events est append-only (TRUNCATE interdit)';
end;
$$;

create trigger trg_agent_audit_events_no_truncate
  before truncate on agent_audit_events
  for each statement execute function guard_agent_audit_events_truncate();

-- Purge de rétention / effacement : seul chemin de suppression directe.
create or replace function purge_agent_audit_events(p_organization_id uuid, p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  perform set_config('flexco.audit_purge', 'on', true);
  delete from agent_audit_events
   where organization_id = p_organization_id
     and created_at < p_before;
  get diagnostics deleted_count = row_count;
  perform set_config('flexco.audit_purge', 'off', true);
  return deleted_count;
end;
$$;

revoke all on function purge_agent_audit_events(uuid, timestamptz) from public, anon, authenticated;
grant execute on function purge_agent_audit_events(uuid, timestamptz) to service_role;

alter table agent_audit_events enable row level security;

create policy "owner/admin can read agent_audit_events"
  on agent_audit_events for select
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));
