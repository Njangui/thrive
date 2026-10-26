-- C1 P5 — Retours utilisateurs, résultats observés, consentements d'entraînement.
-- Principes : tout usage de données pour l'entraînement est OPT-IN (aucune ligne
-- de consentement = aucun consentement) ; aucun contenu de message n'est stocké
-- ici ; l'export est pseudonymisé côté application et filtré côté SQL.

create table feedback_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  run_id uuid references agent_runs(id) on delete set null,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating in (-1, 1)),
  reason_code text check (reason_code is null or reason_code in ('wrong_info', 'tone', 'incomplete', 'too_slow', 'unsafe', 'other')),
  comment text check (comment is null or char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_feedback_run_actor on feedback_events(run_id, actor_user_id) where run_id is not null;
create index idx_feedback_org_created on feedback_events(organization_id, created_at desc);

create or replace function guard_feedback_update() returns trigger language plpgsql as $$
begin
  if new.organization_id is distinct from old.organization_id or new.run_id is distinct from old.run_id
     or new.actor_user_id is distinct from old.actor_user_id or new.created_at is distinct from old.created_at then
    if pg_trigger_depth() > 1 then return new; end if; -- ON DELETE SET NULL de agent_runs
    raise exception 'feedback_events: identité du retour immuable';
  end if;
  new.updated_at = now();
  return new;
end $$;
create trigger trg_feedback_guard before update on feedback_events for each row execute function guard_feedback_update();

alter table feedback_events enable row level security;
create policy "author or owner/admin can read feedback_events" on feedback_events for select
  using (is_member_of_org(organization_id) and (actor_user_id = auth.uid() or current_org_role(organization_id) in ('owner', 'admin')));
revoke insert, update, delete on feedback_events from anon, authenticated;

create or replace function public.record_feedback(
  p_organization_id uuid, p_run_id uuid, p_actor_id uuid, p_rating smallint, p_reason text, p_comment text
) returns text language plpgsql security definer set search_path = ''
as $$
declare v_run_org uuid; v_run_actor uuid; v_run_role text; v_member boolean;
begin
  select organization_id, actor_user_id into v_run_org, v_run_actor from public.agent_runs where id = p_run_id;
  if not found or v_run_org <> p_organization_id then return 'run_not_found'; end if;
  select role into v_run_role from public.memberships where organization_id = p_organization_id and user_id = p_actor_id;
  v_member := found;
  if not v_member then return 'forbidden'; end if;
  -- Seul le demandeur du run, ou un owner/admin, peut le noter.
  if v_run_actor <> p_actor_id and v_run_role not in ('owner', 'admin') then return 'forbidden'; end if;
  insert into public.feedback_events(organization_id, run_id, actor_user_id, rating, reason_code, comment)
  values (p_organization_id, p_run_id, p_actor_id, p_rating, p_reason, left(p_comment, 500))
  on conflict (run_id, actor_user_id) where run_id is not null
  do update set rating = excluded.rating, reason_code = excluded.reason_code, comment = excluded.comment;
  return 'recorded';
end $$;

create table outcome_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  run_id uuid references agent_runs(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('draft_sent', 'draft_edited', 'draft_discarded', 'suggestion_accepted', 'suggestion_rejected', 'action_approved', 'action_rejected')),
  tool_name text check (tool_name is null or char_length(tool_name) <= 100),
  meta jsonb not null default '{}'::jsonb check (char_length(meta::text) <= 2000),
  created_at timestamptz not null default now()
);
create index idx_outcome_org_created on outcome_events(organization_id, created_at desc);
create index idx_outcome_run on outcome_events(run_id);

create or replace function guard_outcome_events() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if; -- cascades d'intégrité référentielle
  raise exception 'outcome_events est append-only';
end $$;
create trigger trg_outcome_guard before update or delete on outcome_events for each row execute function guard_outcome_events();
create or replace function guard_outcome_truncate() returns trigger language plpgsql as $$
begin raise exception 'outcome_events est append-only (TRUNCATE interdit)'; end $$;
create trigger trg_outcome_guard_truncate before truncate on outcome_events for each statement execute function guard_outcome_truncate();

alter table outcome_events enable row level security;
create policy "owner/admin can read outcome_events" on outcome_events for select
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));
revoke insert, update, delete on outcome_events from anon, authenticated;

-- Consentements : journal append-only ; l'état courant = dernier événement par (org, scope).
create table training_consent_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  scope text not null check (scope in ('feedback_export', 'model_improvement')),
  granted boolean not null,
  decided_by uuid not null references auth.users(id) on delete cascade,
  policy_version text not null check (char_length(policy_version) between 1 and 50),
  created_at timestamptz not null default now()
);
create index idx_consent_org_scope on training_consent_events(organization_id, scope, created_at desc);

create or replace function guard_consent_events() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  raise exception 'training_consent_events est append-only';
end $$;
create trigger trg_consent_guard before update or delete on training_consent_events for each row execute function guard_consent_events();
create or replace function guard_consent_truncate() returns trigger language plpgsql as $$
begin raise exception 'training_consent_events est append-only (TRUNCATE interdit)'; end $$;
create trigger trg_consent_guard_truncate before truncate on training_consent_events for each statement execute function guard_consent_truncate();

alter table training_consent_events enable row level security;
create policy "owner/admin can read training_consent_events" on training_consent_events for select
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));
revoke insert, update, delete on training_consent_events from anon, authenticated;

create or replace function public.has_training_consent(p_organization_id uuid, p_scope text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((select e.granted from public.training_consent_events e
    where e.organization_id = p_organization_id and e.scope = p_scope
    order by e.created_at desc, e.id desc limit 1), false);
$$;

-- Seul un OWNER de l'organisation décide ; retrait possible à tout moment, effet immédiat.
create or replace function public.record_training_consent(
  p_organization_id uuid, p_scope text, p_granted boolean, p_decided_by uuid, p_policy_version text
) returns text language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.memberships where organization_id = p_organization_id and user_id = p_decided_by and role = 'owner') then
    return 'forbidden';
  end if;
  insert into public.training_consent_events(organization_id, scope, granted, decided_by, policy_version)
  values (p_organization_id, p_scope, p_granted, p_decided_by, p_policy_version);
  return case when p_granted then 'granted' else 'revoked' end;
end $$;

-- Export candidat : AUCUNE ligne sans consentement actif. Ni commentaire, ni
-- identifiant d'utilisateur, ni contenu ; la pseudonymisation du run_id est faite côté application.
create or replace function public.training_export_rows(p_organization_id uuid, p_since timestamptz, p_limit integer)
returns table (run_id uuid, agent_name text, prompt_version text, model_tier text, run_status text, rating smallint, reason_code text, outcomes text[], created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then raise exception 'training_export_rows: limite invalide'; end if;
  if not public.has_training_consent(p_organization_id, 'feedback_export') then return; end if;
  return query
  select f.run_id, r.agent_name, r.prompt_version, r.model_tier, r.status, f.rating, f.reason_code,
         coalesce((select array_agg(o.kind order by o.created_at) from public.outcome_events o where o.run_id = f.run_id), '{}'::text[]),
         f.created_at
    from public.feedback_events f join public.agent_runs r on r.id = f.run_id
   where f.organization_id = p_organization_id and f.created_at >= coalesce(p_since, '-infinity'::timestamptz)
   order by f.created_at limit p_limit;
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'record_feedback(uuid, uuid, uuid, smallint, text, text)', 'has_training_consent(uuid, text)',
    'record_training_consent(uuid, text, boolean, uuid, text)', 'training_export_rows(uuid, timestamptz, integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
