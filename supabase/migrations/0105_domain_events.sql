-- C1 P4 — Outbox `domain_events` : événements métier émis dans la même
-- transaction que leur cause, puis distribués au moins une fois (idempotence
-- côté consommateur via l'id d'événement). Service-role uniquement : aucune
-- politique pour les clients, RLS activée (fail-closed).

create table domain_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  type text not null check (char_length(type) between 1 and 100),
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text check (dedupe_key is null or char_length(dedupe_key) between 1 and 200),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create unique index uq_domain_events_dedupe
  on domain_events(organization_id, type, dedupe_key) where dedupe_key is not null;
create index idx_domain_events_claim on domain_events(next_attempt_at) where status in ('pending', 'processing');
create index idx_domain_events_org_created on domain_events(organization_id, created_at desc);

alter table domain_events enable row level security;
-- Aucune politique : ni lecture ni écriture pour authenticated/anon.
revoke all on domain_events from anon, authenticated;

create or replace function public.emit_domain_event(
  p_organization_id uuid, p_type text, p_payload jsonb, p_dedupe_key text default null
) returns table (out_status text, out_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  insert into public.domain_events(organization_id, type, payload, dedupe_key)
  values (p_organization_id, p_type, coalesce(p_payload, '{}'::jsonb), p_dedupe_key)
  on conflict (organization_id, type, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  if v_id is null then
    return query select 'duplicate'::text, e.id from public.domain_events e
      where e.organization_id = p_organization_id and e.type = p_type and e.dedupe_key = p_dedupe_key;
  else
    return query select 'emitted'::text, v_id;
  end if;
end;
$$;

-- Réserve un lot : FOR UPDATE SKIP LOCKED => deux dispatchers concurrents ne
-- prennent jamais le même événement. Un bail expiré (dispatcher mort) est repris.
create or replace function public.claim_domain_events(p_limit integer, p_lease_seconds integer)
returns setof public.domain_events
language plpgsql security definer set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'claim_domain_events: limite invalide'; end if;
  if p_lease_seconds is null or p_lease_seconds < 5 then raise exception 'claim_domain_events: bail invalide'; end if;
  return query
  with c as (
    select e.id from public.domain_events e
    where ((e.status = 'pending' and e.next_attempt_at <= now())
        or (e.status = 'processing' and e.locked_until < now()))
    order by e.next_attempt_at, e.created_at
    limit p_limit
    for update skip locked
  )
  update public.domain_events e
     set status = 'processing', attempts = e.attempts + 1,
         locked_until = now() + make_interval(secs => p_lease_seconds)
    from c where e.id = c.id
  returning e.*;
end;
$$;

create or replace function public.complete_domain_event(p_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  update public.domain_events set status = 'done', processed_at = now(), locked_until = null, last_error = null
   where id = p_id and status = 'processing';
  get diagnostics n = row_count;
  return case when n = 1 then 'done' else 'ignored' end;
end;
$$;

-- Échec : nouvelle tentative avec attente exponentielle (30 s * 2^(n-1), plafond 1 h),
-- puis `dead` au-delà de p_max_attempts (jamais perdu silencieusement).
create or replace function public.fail_domain_event(p_id uuid, p_error text, p_max_attempts integer)
returns text language plpgsql security definer set search_path = ''
as $$
declare v public.domain_events%rowtype;
begin
  select * into v from public.domain_events where id = p_id and status = 'processing' for update;
  if not found then return 'ignored'; end if;
  if v.attempts >= greatest(coalesce(p_max_attempts, 5), 1) then
    update public.domain_events set status = 'dead', locked_until = null, last_error = left(coalesce(p_error, ''), 300) where id = p_id;
    return 'dead';
  end if;
  update public.domain_events
     set status = 'pending', locked_until = null, last_error = left(coalesce(p_error, ''), 300),
         next_attempt_at = now() + make_interval(secs => least(3600, 30 * power(2, v.attempts - 1)))
   where id = p_id;
  return 'retry';
end;
$$;

revoke all on function public.emit_domain_event(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.claim_domain_events(integer, integer) from public, anon, authenticated;
revoke all on function public.complete_domain_event(uuid) from public, anon, authenticated;
revoke all on function public.fail_domain_event(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.emit_domain_event(uuid, text, jsonb, text) to service_role;
grant execute on function public.claim_domain_events(integer, integer) to service_role;
grant execute on function public.complete_domain_event(uuid) to service_role;
grant execute on function public.fail_domain_event(uuid, text, integer) to service_role;
