-- ============================================================
-- 0104_usage_ledger_wallet.sql
-- C1 / P3 — registre d'usage et portefeuille prépayé, NEUTRES vis-à-vis des
-- prix (principe 12) : aucune devise, aucun tarif ici. Une « unité » est
-- une quantité d'usage d'une nature (ai | media | message | channel) ;
-- ce qu'une recharge de N unités coûte relève de la couche tarifaire
-- (non décidée) qui fournit le montant à l'appelant.
--
--   usage_ledger    journal APPEND-ONLY, idempotent par (tenant, ref, type)
--   wallet_balances solde prépayé par (tenant, nature), jamais négatif
--   wallet_topups   recharges (initiation de paiement, puis crédit idempotent)
--
-- Toutes les écritures passent par les fonctions ci-dessous (SECURITY
-- DEFINER, service_role uniquement) : atomiques, sérialisées par
-- (tenant, ref) via verrou consultatif, donc sûres sous concurrence.
--
-- Ordre des sources pour `ai` : crédits inclus au plan
-- (`ai_credit_balances`, via consume_ai_credit — 0043) d'abord, puis le
-- portefeuille prépayé. Les autres natures ne débitent que le portefeuille.
--
-- Cycle d'une réservation : reserve -> commit (usage confirmé) | release
-- (échec : restitué). Un usage confirmé peut être remboursé (refund).
-- ============================================================

create table wallet_balances (
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('ai', 'media', 'message', 'channel')),
  balance numeric not null default 0 check (balance >= 0),
  low_balance_threshold numeric check (low_balance_threshold is null or low_balance_threshold >= 0),
  -- Anti-spam d'alerte : posé au franchissement du seuil, remis à NULL à la recharge/restitution.
  low_balance_alerted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organization_id, kind)
);

create trigger trg_wallet_balances_updated_at
  before update on wallet_balances
  for each row execute function set_updated_at();

create table usage_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Pas de clé étrangère : un journal append-only ne doit pas être modifié par un ON DELETE SET NULL.
  actor_id uuid,
  kind text not null check (kind in ('ai', 'media', 'message', 'channel')),
  entry_type text not null check (entry_type in ('reserve', 'commit', 'release', 'refund', 'topup')),
  units numeric not null check (units > 0),
  ref text not null check (char_length(ref) between 1 and 200),
  source text check (source in ('plan', 'wallet')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, ref, entry_type)
);

create index idx_usage_ledger_org_created on usage_ledger(organization_id, created_at desc);
create index idx_usage_ledger_org_kind on usage_ledger(organization_id, kind, created_at desc);

create or replace function guard_usage_ledger()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'usage_ledger est append-only (UPDATE interdit)';
  end if;
  -- DELETE : uniquement la suppression en cascade d'un tenant.
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'usage_ledger est append-only (DELETE interdit)';
end;
$$;

create trigger trg_usage_ledger_guard
  before update or delete on usage_ledger
  for each row execute function guard_usage_ledger();

create or replace function guard_usage_ledger_truncate()
returns trigger
language plpgsql
as $$
begin
  raise exception 'usage_ledger est append-only (TRUNCATE interdit)';
end;
$$;

create trigger trg_usage_ledger_no_truncate
  before truncate on usage_ledger
  for each statement execute function guard_usage_ledger_truncate();

create table wallet_topups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('ai', 'media', 'message', 'channel')),
  units numeric not null check (units > 0),
  -- Montant à payer, fourni par la couche tarifaire (non décidée) : jamais calculé ici.
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (char_length(currency) between 3 and 8),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled')),
  provider text,
  provider_reference text unique,
  requested_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index idx_wallet_topups_org_created on wallet_topups(organization_id, created_at desc);
create index idx_wallet_topups_pending on wallet_topups(created_at) where status = 'pending';

create or replace function guard_wallet_topup_update()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.kind is distinct from old.kind
     or new.units is distinct from old.units
     or new.amount_minor is distinct from old.amount_minor
     or new.currency is distinct from old.currency
     or new.requested_by is distinct from old.requested_by
     or new.created_at is distinct from old.created_at then
    raise exception 'wallet_topups: kind, unités, montant, devise et demandeur sont immuables';
  end if;
  if old.provider_reference is not null and new.provider_reference is distinct from old.provider_reference then
    raise exception 'wallet_topups: provider_reference immuable une fois posée';
  end if;
  if new.status is distinct from old.status and old.status <> 'pending' then
    raise exception 'wallet_topups: statut terminal (%), transition interdite', old.status;
  end if;
  return new;
end;
$$;

create trigger trg_wallet_topups_guard_update
  before update on wallet_topups
  for each row execute function guard_wallet_topup_update();

-- Lecture réservée aux rôles qui voient les chiffres : aucune policy d'écriture.
alter table wallet_balances enable row level security;
alter table usage_ledger enable row level security;
alter table wallet_topups enable row level security;

create policy "finance roles can read wallet_balances"
  on wallet_balances for select
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin', 'accountant'));

create policy "finance roles can read usage_ledger"
  on usage_ledger for select
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin', 'accountant'));

create policy "finance roles can read wallet_topups"
  on wallet_topups for select
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin', 'accountant'));

-- ------------------------------------------------------------
-- Fonctions (atomiques, idempotentes). OUT-paramètres préfixés `out_`
-- pour éviter toute ambiguïté avec les colonnes.
-- ------------------------------------------------------------

create or replace function public.usage_reserve(
  p_organization_id uuid, p_actor_id uuid, p_kind text, p_units numeric, p_ref text
)
returns table (out_status text, out_source text, out_balance numeric, out_low_balance boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_source text;
  v_source text;
  v_balance numeric;
  v_threshold numeric;
  v_alerted timestamptz;
  v_low boolean := false;
begin
  if p_units is null or p_units <= 0 then
    raise exception 'usage_reserve: units doit être > 0';
  end if;
  if p_kind not in ('ai', 'media', 'message', 'channel') then
    raise exception 'usage_reserve: nature inconnue (%)', p_kind;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_ref, 0));

  select l.source into v_existing_source
    from public.usage_ledger l
   where l.organization_id = p_organization_id and l.ref = p_ref and l.entry_type = 'reserve';
  if found then
    return query select 'duplicate'::text, v_existing_source, null::numeric, false;
    return;
  end if;

  -- 1) crédits inclus au plan (IA uniquement, quantités entières)
  if p_kind = 'ai' and p_units = trunc(p_units) and p_units <= 2147483647 then
    perform 1 from public.consume_ai_credit(p_organization_id, p_units::integer);
    if found then
      v_source := 'plan';
    end if;
  end if;

  -- 2) portefeuille prépayé
  if v_source is null then
    update public.wallet_balances w
       set balance = w.balance - p_units
     where w.organization_id = p_organization_id and w.kind = p_kind and w.balance >= p_units
    returning w.balance, w.low_balance_threshold, w.low_balance_alerted_at
      into v_balance, v_threshold, v_alerted;
    if found then
      v_source := 'wallet';
    end if;
  end if;

  if v_source is null then
    return query select 'insufficient'::text, null::text, null::numeric, false;
    return;
  end if;

  insert into public.usage_ledger (organization_id, actor_id, kind, entry_type, units, ref, source)
  values (p_organization_id, p_actor_id, p_kind, 'reserve', p_units, p_ref, v_source);

  if v_source = 'wallet' and v_threshold is not null and v_balance < v_threshold and v_alerted is null then
    update public.wallet_balances w set low_balance_alerted_at = now()
     where w.organization_id = p_organization_id and w.kind = p_kind;
    v_low := true;
  end if;

  return query select 'reserved'::text, v_source, v_balance, v_low;
end;
$$;

create or replace function public.usage_commit(p_organization_id uuid, p_ref text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reserve public.usage_ledger%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_ref, 0));

  select * into v_reserve from public.usage_ledger l
   where l.organization_id = p_organization_id and l.ref = p_ref and l.entry_type = 'reserve';
  if not found then return 'not_found'; end if;

  if exists (select 1 from public.usage_ledger l where l.organization_id = p_organization_id and l.ref = p_ref and l.entry_type = 'commit') then
    return 'duplicate';
  end if;
  if exists (select 1 from public.usage_ledger l where l.organization_id = p_organization_id and l.ref = p_ref and l.entry_type = 'release') then
    return 'released';
  end if;

  insert into public.usage_ledger (organization_id, actor_id, kind, entry_type, units, ref, source)
  values (p_organization_id, v_reserve.actor_id, v_reserve.kind, 'commit', v_reserve.units, p_ref, v_reserve.source);
  return 'committed';
end;
$$;

-- Restitution commune (release / refund) : remet les unités à leur source.
create or replace function public._usage_restore(p_organization_id uuid, p_kind text, p_units numeric, p_source text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_source = 'plan' then
    perform public.release_ai_credit(p_organization_id, p_units::integer);
  else
    update public.wallet_balances w
       set balance = w.balance + p_units,
           low_balance_alerted_at = case
             when w.low_balance_threshold is null or w.balance + p_units >= w.low_balance_threshold then null
             else w.low_balance_alerted_at end
     where w.organization_id = p_organization_id and w.kind = p_kind;
  end if;
end;
$$;

create or replace function public.usage_release(p_organization_id uuid, p_ref text)
returns table (out_status text, out_source text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reserve public.usage_ledger%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_ref, 0));

  select * into v_reserve from public.usage_ledger l
   where l.organization_id = p_organization_id and l.ref = p_ref and l.entry_type = 'reserve';
  if not found then
    return query select 'not_found'::text, null::text; return;
  end if;
  if exists (select 1 from public.usage_ledger l where l.organization_id = p_organization_id and l.ref = p_ref and l.entry_type = 'commit') then
    return query select 'already_committed'::text, v_reserve.source; return;
  end if;
  if exists (select 1 from public.usage_ledger l where l.organization_id = p_organization_id and l.ref = p_ref and l.entry_type = 'release') then
    return query select 'duplicate'::text, v_reserve.source; return;
  end if;

  perform public._usage_restore(p_organization_id, v_reserve.kind, v_reserve.units, v_reserve.source);
  insert into public.usage_ledger (organization_id, actor_id, kind, entry_type, units, ref, source)
  values (p_organization_id, v_reserve.actor_id, v_reserve.kind, 'release', v_reserve.units, p_ref, v_reserve.source);
  return query select 'released'::text, v_reserve.source;
end;
$$;

create or replace function public.usage_refund(p_organization_id uuid, p_ref text, p_reason text)
returns table (out_status text, out_source text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reserve public.usage_ledger%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_ref, 0));

  select * into v_reserve from public.usage_ledger l
   where l.organization_id = p_organization_id and l.ref = p_ref and l.entry_type = 'reserve';
  if not found then
    return query select 'not_found'::text, null::text; return;
  end if;
  if not exists (select 1 from public.usage_ledger l where l.organization_id = p_organization_id and l.ref = p_ref and l.entry_type = 'commit') then
    return query select 'not_committed'::text, v_reserve.source; return;
  end if;
  if exists (select 1 from public.usage_ledger l where l.organization_id = p_organization_id and l.ref = p_ref and l.entry_type = 'refund') then
    return query select 'duplicate'::text, v_reserve.source; return;
  end if;

  perform public._usage_restore(p_organization_id, v_reserve.kind, v_reserve.units, v_reserve.source);
  insert into public.usage_ledger (organization_id, actor_id, kind, entry_type, units, ref, source, meta)
  values (p_organization_id, v_reserve.actor_id, v_reserve.kind, 'refund', v_reserve.units, p_ref, v_reserve.source,
          jsonb_build_object('reason', left(coalesce(p_reason, ''), 200)));
  return query select 'refunded'::text, v_reserve.source;
end;
$$;

-- Débit immédiat (réservation + confirmation dans UNE transaction) : contrat `usage.charge`.
create or replace function public.usage_charge(
  p_organization_id uuid, p_actor_id uuid, p_kind text, p_units numeric, p_ref text
)
returns table (out_status text, out_source text, out_balance numeric, out_low_balance boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  select * into r from public.usage_reserve(p_organization_id, p_actor_id, p_kind, p_units, p_ref);
  if r.out_status = 'reserved' then
    perform public.usage_commit(p_organization_id, p_ref);
    return query select 'charged'::text, r.out_source, r.out_balance, r.out_low_balance;
  elsif r.out_status = 'duplicate' then
    return query select 'duplicate'::text, r.out_source, null::numeric, false;
  else
    return query select 'insufficient'::text, null::text, null::numeric, false;
  end if;
end;
$$;

-- Crédit du portefeuille (recharge, geste commercial) : idempotent par (tenant, ref).
create or replace function public.wallet_topup(
  p_organization_id uuid, p_kind text, p_units numeric, p_ref text, p_actor_id uuid default null
)
returns table (out_status text, out_balance numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance numeric;
begin
  if p_units is null or p_units <= 0 then
    raise exception 'wallet_topup: units doit être > 0';
  end if;
  if p_kind not in ('ai', 'media', 'message', 'channel') then
    raise exception 'wallet_topup: nature inconnue (%)', p_kind;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_ref, 0));

  if exists (select 1 from public.usage_ledger l where l.organization_id = p_organization_id and l.ref = p_ref and l.entry_type = 'topup') then
    select w.balance into v_balance from public.wallet_balances w where w.organization_id = p_organization_id and w.kind = p_kind;
    return query select 'duplicate'::text, v_balance;
    return;
  end if;

  insert into public.wallet_balances as w (organization_id, kind, balance)
  values (p_organization_id, p_kind, p_units)
  on conflict (organization_id, kind) do update
    set balance = w.balance + excluded.balance,
        low_balance_alerted_at = case
          when w.low_balance_threshold is null or w.balance + excluded.balance >= w.low_balance_threshold then null
          else w.low_balance_alerted_at end
  returning w.balance into v_balance;

  insert into public.usage_ledger (organization_id, actor_id, kind, entry_type, units, ref, source)
  values (p_organization_id, p_actor_id, p_kind, 'topup', p_units, p_ref, 'wallet');

  return query select 'credited'::text, v_balance;
end;
$$;

-- Issue d'un paiement de recharge : seul chemin qui crédite le portefeuille depuis un paiement.
-- Appelée APRÈS vérification auprès du provider (jamais sur la foi d'un corps de webhook).
create or replace function public.wallet_topup_settle(p_provider_reference text, p_outcome text)
returns table (out_status text, out_balance numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topup public.wallet_topups%rowtype;
  v_status text;
  v_balance numeric;
begin
  if p_outcome not in ('paid', 'failed', 'cancelled') then
    raise exception 'wallet_topup_settle: issue inconnue (%)', p_outcome;
  end if;

  select * into v_topup from public.wallet_topups t where t.provider_reference = p_provider_reference for update;
  if not found then
    return query select 'not_found'::text, null::numeric; return;
  end if;
  if v_topup.status <> 'pending' then
    return query select 'duplicate'::text, null::numeric; return;
  end if;

  if p_outcome = 'paid' then
    update public.wallet_topups t set status = 'paid', paid_at = now() where t.id = v_topup.id;
    select s.out_status, s.out_balance into v_status, v_balance
      from public.wallet_topup(v_topup.organization_id, v_topup.kind, v_topup.units, 'topup:' || v_topup.id::text, v_topup.requested_by) s;
    return query select 'credited'::text, v_balance;
  else
    update public.wallet_topups t set status = p_outcome where t.id = v_topup.id;
    return query select p_outcome, null::numeric;
  end if;
end;
$$;

revoke all on function public.usage_reserve(uuid, uuid, text, numeric, text) from public, anon, authenticated;
revoke all on function public.usage_commit(uuid, text) from public, anon, authenticated;
revoke all on function public._usage_restore(uuid, text, numeric, text) from public, anon, authenticated;
revoke all on function public.usage_release(uuid, text) from public, anon, authenticated;
revoke all on function public.usage_refund(uuid, text, text) from public, anon, authenticated;
revoke all on function public.usage_charge(uuid, uuid, text, numeric, text) from public, anon, authenticated;
revoke all on function public.wallet_topup(uuid, text, numeric, text, uuid) from public, anon, authenticated;
revoke all on function public.wallet_topup_settle(text, text) from public, anon, authenticated;
grant execute on function public.usage_reserve(uuid, uuid, text, numeric, text) to service_role;
grant execute on function public.usage_commit(uuid, text) to service_role;
grant execute on function public.usage_release(uuid, text) to service_role;
grant execute on function public.usage_refund(uuid, text, text) to service_role;
grant execute on function public.usage_charge(uuid, uuid, text, numeric, text) to service_role;
grant execute on function public.wallet_topup(uuid, text, numeric, text, uuid) to service_role;
grant execute on function public.wallet_topup_settle(text, text) to service_role;
