-- C1 P4 — Planificateur d'agents + hygiène (runs bloqués, rétention).
-- Une tâche planifiée s'exécute avec les droits de son CRÉATEUR (canal
-- `scheduler`) : l'agent n'a jamais plus de droits que l'humain qui l'a planifiée.

create table scheduled_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  agent_name text not null check (char_length(agent_name) between 1 and 100),
  instruction text not null check (char_length(instruction) between 1 and 2000),
  schedule_kind text not null check (schedule_kind in ('once', 'interval')),
  interval_seconds integer check (interval_seconds is null or interval_seconds >= 300),
  next_run_at timestamptz not null,
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_status text,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  check ((schedule_kind = 'interval') = (interval_seconds is not null))
);
create index idx_scheduled_tasks_due on scheduled_tasks(next_run_at) where enabled;
create index idx_scheduled_tasks_org on scheduled_tasks(organization_id);

alter table scheduled_tasks enable row level security;
create policy "owner/admin can read scheduled_tasks"
  on scheduled_tasks for select
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));
-- Écriture : service-role uniquement (le service applique permissions + audit).
revoke insert, update, delete on scheduled_tasks from anon, authenticated;

create or replace function public.claim_scheduled_tasks(p_limit integer, p_lease_seconds integer)
returns setof public.scheduled_tasks
language plpgsql security definer set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then raise exception 'claim_scheduled_tasks: limite invalide'; end if;
  if p_lease_seconds is null or p_lease_seconds < 30 then raise exception 'claim_scheduled_tasks: bail invalide'; end if;
  return query
  with c as (
    select t.id from public.scheduled_tasks t
    where t.enabled and t.next_run_at <= now() and (t.locked_until is null or t.locked_until < now())
    order by t.next_run_at limit p_limit
    for update skip locked
  )
  update public.scheduled_tasks t set locked_until = now() + make_interval(secs => p_lease_seconds)
    from c where t.id = c.id
  returning t.*;
end;
$$;

-- Clôture d'une exécution. `once` => désactivée. `interval` => prochaine
-- échéance dans le futur (jamais de rattrapage en rafale). Désactivation
-- automatique après p_max_failures échecs consécutifs.
create or replace function public.complete_scheduled_task(p_id uuid, p_ok boolean, p_status text, p_max_failures integer)
returns text language plpgsql security definer set search_path = ''
as $$
declare t public.scheduled_tasks%rowtype; v_fail integer; v_enabled boolean; v_next timestamptz;
begin
  select * into t from public.scheduled_tasks where id = p_id for update;
  if not found then return 'not_found'; end if;
  v_fail := case when p_ok then 0 else t.consecutive_failures + 1 end;
  v_enabled := t.enabled and t.schedule_kind = 'interval' and v_fail < greatest(coalesce(p_max_failures, 5), 1);
  v_next := case when t.schedule_kind = 'interval'
    then greatest(t.next_run_at + make_interval(secs => t.interval_seconds), now() + make_interval(secs => t.interval_seconds))
    else t.next_run_at end;
  update public.scheduled_tasks
     set last_run_at = now(), last_status = left(coalesce(p_status, ''), 60), consecutive_failures = v_fail,
         enabled = v_enabled, next_run_at = v_next, locked_until = null
   where id = p_id;
  return case when v_enabled then 'rescheduled' when t.schedule_kind = 'once' then 'completed' else 'disabled' end;
end;
$$;

-- Runs restés `running` au-delà du délai (processus tué) : clôturés en `failed`.
-- Ne touche jamais `awaiting_approval`.
create or replace function public.close_stuck_agent_runs(p_older_than_seconds integer)
returns integer language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  if p_older_than_seconds is null or p_older_than_seconds < 60 then raise exception 'close_stuck_agent_runs: délai invalide'; end if;
  update public.agent_runs set status = 'failed', error_code = 'stuck_timeout', finished_at = now()
   where status = 'running' and created_at < now() - make_interval(secs => p_older_than_seconds);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Rétention : durées fournies par l'appelant (décision produit/juridique en
-- attente — loi 2024/017). Les événements `dead` et le journal d'audit ne sont
-- JAMAIS purgés ici.
create or replace function public.purge_agent_runs(p_before timestamptz)
returns integer language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  if p_before is null or p_before > now() - interval '1 day' then raise exception 'purge_agent_runs: date trop récente'; end if;
  delete from public.agent_runs where status <> 'running' and status <> 'awaiting_approval' and created_at < p_before and parent_run_id is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.purge_domain_events(p_before timestamptz)
returns integer language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  if p_before is null or p_before > now() - interval '1 day' then raise exception 'purge_domain_events: date trop récente'; end if;
  delete from public.domain_events where status = 'done' and processed_at < p_before;
  get diagnostics n = row_count;
  return n;
end;
$$;

do $$ declare f text; begin
  foreach f in array array[
    'claim_scheduled_tasks(integer, integer)', 'complete_scheduled_task(uuid, boolean, text, integer)',
    'close_stuck_agent_runs(integer)', 'purge_agent_runs(timestamptz)', 'purge_domain_events(timestamptz)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
