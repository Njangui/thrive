-- ============================================================
-- 0103_agent_runs.sql
-- C1 / P2 — traçage du runtime d'agents (principe 7) et coupe-circuit.
--
--   agent_runs             une exécution d'agent (orchestrateur ou sous-agent)
--   agent_steps            un pas : appel LLM ou appel d'outil (IMMUABLE)
--   agent_circuit_breakers coupe-circuit par tenant (agent_name NULL) ou par agent
--
-- Minimisation (loi 2024/017) : AUCUN contenu de message ni sortie d'outil
-- n'est stocké ici — seulement noms, versions, jetons, unités, durées,
-- codes d'erreur et paramètres expurgés. Les écritures de runs/steps se
-- font en service-role (aucune policy d'écriture) ; le propriétaire peut
-- armer/relâcher le coupe-circuit de son tenant (policies ci-dessous).
-- ============================================================

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  agent_name text not null,
  prompt_version text not null,
  actor_user_id uuid not null,
  channel text not null
    check (channel in ('dashboard', 'telegram', 'whatsapp', 'scheduler', 'customer')),
  parent_run_id uuid references agent_runs(id) on delete cascade,
  depth integer not null default 0 check (depth between 0 and 2),
  model_tier text not null check (model_tier in ('small', 'large')),
  status text not null default 'running'
    check (status in ('running', 'completed', 'awaiting_approval', 'failed', 'budget_exceeded', 'max_steps', 'blocked')),
  steps_count integer not null default 0 check (steps_count >= 0),
  units_used numeric not null default 0 check (units_used >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  error_code text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index idx_agent_runs_org_created on agent_runs(organization_id, created_at desc);
create index idx_agent_runs_org_agent on agent_runs(organization_id, agent_name, created_at desc);
create index idx_agent_runs_parent on agent_runs(parent_run_id);
create index idx_agent_runs_actor on agent_runs(actor_user_id);

create or replace function guard_agent_run_update()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.agent_name is distinct from old.agent_name
     or new.prompt_version is distinct from old.prompt_version
     or new.actor_user_id is distinct from old.actor_user_id
     or new.channel is distinct from old.channel
     or new.parent_run_id is distinct from old.parent_run_id
     or new.depth is distinct from old.depth
     or new.model_tier is distinct from old.model_tier
     or new.created_at is distinct from old.created_at then
    raise exception 'agent_runs: identité de l''exécution immuable';
  end if;

  -- Une exécution terminée est figée, sauf la reprise après approbation
  -- (awaiting_approval -> running) et les compteurs d'une exécution en cours.
  if old.status <> 'running' and not (old.status = 'awaiting_approval' and new.status = 'running') then
    if row(new.status, new.steps_count, new.units_used, new.input_tokens, new.output_tokens, new.error_code, new.finished_at)
       is distinct from
       row(old.status, old.steps_count, old.units_used, old.input_tokens, old.output_tokens, old.error_code, old.finished_at) then
      raise exception 'agent_runs: exécution terminée (%), modification interdite', old.status;
    end if;
  end if;

  -- Les compteurs ne diminuent jamais.
  if new.steps_count < old.steps_count or new.units_used < old.units_used
     or new.input_tokens < old.input_tokens or new.output_tokens < old.output_tokens then
    raise exception 'agent_runs: les compteurs ne peuvent pas diminuer';
  end if;
  return new;
end;
$$;

create trigger trg_agent_runs_guard_update
  before update on agent_runs
  for each row execute function guard_agent_run_update();

alter table agent_runs enable row level security;

create policy "requester or owner/admin can read agent_runs"
  on agent_runs for select
  using (
    is_member_of_org(organization_id)
    and (actor_user_id = auth.uid() or current_org_role(organization_id) in ('owner', 'admin'))
  );

create table agent_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references agent_runs(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  step_index integer not null check (step_index >= 0),
  kind text not null check (kind in ('llm', 'tool')),
  tool_name text,
  provider text,
  model text,
  prompt_version text,
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  units numeric not null default 0 check (units >= 0),
  status text not null check (status in ('ok', 'error', 'denied', 'pending_confirmation')),
  error_code text,
  duration_ms integer check (duration_ms >= 0),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, step_index)
);

create index idx_agent_steps_org_created on agent_steps(organization_id, created_at desc);
create index idx_agent_steps_run on agent_steps(run_id, step_index);

-- Les pas sont immuables (UPDATE interdit ; DELETE seulement en cascade).
create or replace function guard_agent_steps()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'agent_steps est immuable (UPDATE interdit)';
  end if;
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'agent_steps est immuable (DELETE interdit)';
end;
$$;

create trigger trg_agent_steps_guard
  before update or delete on agent_steps
  for each row execute function guard_agent_steps();

alter table agent_steps enable row level security;

create policy "owner/admin can read agent_steps"
  on agent_steps for select
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));

create table agent_circuit_breakers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- NULL = tous les agents du tenant.
  agent_name text,
  reason text not null default 'manual' check (char_length(reason) <= 200),
  tripped_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid references auth.users(id) on delete set null
);

-- Un seul coupe-circuit ACTIF par (tenant, agent).
create unique index uq_agent_circuit_breakers_active
  on agent_circuit_breakers(organization_id, coalesce(agent_name, '*'))
  where released_at is null;
create index idx_agent_circuit_breakers_org on agent_circuit_breakers(organization_id, created_at desc);

create or replace function guard_agent_circuit_breaker_update()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.agent_name is distinct from old.agent_name
     or new.reason is distinct from old.reason
     or new.tripped_by is distinct from old.tripped_by
     or new.created_at is distinct from old.created_at then
    raise exception 'agent_circuit_breakers: seul le relâchement est modifiable';
  end if;
  if old.released_at is not null and new.released_at is distinct from old.released_at then
    raise exception 'agent_circuit_breakers: déjà relâché';
  end if;
  return new;
end;
$$;

create trigger trg_agent_circuit_breakers_guard
  before update on agent_circuit_breakers
  for each row execute function guard_agent_circuit_breaker_update();

alter table agent_circuit_breakers enable row level security;

create policy "members can read agent_circuit_breakers"
  on agent_circuit_breakers for select
  using (is_member_of_org(organization_id));

create policy "owner/admin can trip agent_circuit_breakers"
  on agent_circuit_breakers for insert
  with check (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin')
              and released_at is null);

create policy "owner/admin can release agent_circuit_breakers"
  on agent_circuit_breakers for update
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'))
  with check (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));
