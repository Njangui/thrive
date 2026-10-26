-- 0193 — Lot 4 (décisions Q5, Q6, Q29 ; constats C6, C7, C8, D5).

-- ── Q5 : 4 rôles seulement (owner, admin, manager, employee = « membre ») ─────────────────────────────
-- Les anciens rôles vendeur / caissier / comptable n'avaient presque aucun effet réel. Ils deviennent « employee »
-- (droits minimum : on ne donne jamais plus que ce qu'ils avaient). Les valeurs d'enum restent (Postgres ne sait pas
-- en retirer proprement) mais sont INTERDITES par contrainte.
update memberships set role = 'employee' where role in ('sales', 'cashier', 'accountant');
update team_invitations set role = 'employee' where role in ('sales', 'cashier', 'accountant');
alter table memberships drop constraint if exists memberships_role_allowed;
alter table memberships add constraint memberships_role_allowed check (role in ('owner', 'admin', 'manager', 'employee'));
alter table team_invitations drop constraint if exists team_invitations_role_allowed;
alter table team_invitations add constraint team_invitations_role_allowed check (role in ('admin', 'manager', 'employee'));

-- ── Q29 : sous-domaines réservés ──────────────────────────────────────────────────────────────────────
-- Liste synchronisée avec RESERVED_SLUGS (src/domain/reserved-slugs.ts) : un test compare les deux.
create or replace function public.is_reserved_slug(p_slug text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(coalesce(p_slug, '')) = any (array[
    'www', 'admin', 'api', 'app', 'mail', 'auth', 'login', 'pay', 'support', 'status', 'billing', 'dashboard',
    'affiliate', 'cdn', 'static', 'flexco', 'signup', 'register', 'invite', 'onboarding', 'help', 'docs', 'blog',
    'assets', 'smtp', 'ftp', 'ns1', 'ns2'
  ]);
$$;

-- NOT VALID : n'échoue pas sur d'éventuelles lignes existantes, mais refuse tout NOUVEAU slug réservé (insert/update).
alter table organizations drop constraint if exists organizations_slug_not_reserved;
alter table organizations add constraint organizations_slug_not_reserved check (not public.is_reserved_slug(slug)) not valid;

-- ── C8 + Q6 : création d'une entreprise en UNE transaction, avec limite par utilisateur ───────────────
-- Règle Q6 : une seule entreprise GRATUITE par utilisateur (les suivantes se créent quand les précédentes sont
-- passées sur un forfait payant), et 5 entreprises possédées au maximum.
create or replace function public.create_organization_atomic(
  p_user uuid,
  p_name text,
  p_slug text,
  p_industry text,
  p_currency text,
  p_country text,
  p_modules jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_included integer;
begin
  if p_user is null or not exists (select 1 from auth.users where id = p_user) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  -- Sérialise les créations d'un même utilisateur : deux clics simultanés ne contournent pas la limite.
  perform pg_advisory_xact_lock(hashtext('create_organization:' || p_user::text));

  if (
    select count(*) from public.memberships m where m.user_id = p_user and m.role = 'owner'
  ) >= 5 then
    raise exception 'organization_limit_total' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.memberships m
    left join public.organization_subscriptions s on s.organization_id = m.organization_id
    where m.user_id = p_user
      and m.role = 'owner'
      and coalesce(s.plan_key, 'free') = 'free'
  ) then
    raise exception 'organization_limit_free' using errcode = 'P0001';
  end if;

  insert into public.organizations (name, slug, industry, currency, country_code, onboarding_step)
  values (btrim(p_name), p_slug, p_industry, p_currency, p_country, 1)
  returning id into v_org;

  insert into public.memberships (organization_id, user_id, role) values (v_org, p_user, 'owner');

  insert into public.tenant_modules (organization_id, module, enabled)
  select v_org, (e ->> 'module'), coalesce((e ->> 'enabled')::boolean, false)
  from jsonb_array_elements(coalesce(p_modules, '[]'::jsonb)) e;

  insert into public.ai_config (organization_id, provider, model, enabled)
  values (v_org, 'mistral', 'mistral-small-latest', false);

  insert into public.organization_subscriptions (organization_id, plan_key, status)
  values (v_org, 'free', 'active');

  select coalesce((select limit_value from public.plan_entitlements where plan_key = 'free' and entitlement_key = 'ai_credits'), 0)
  into v_included;
  insert into public.ai_credit_balances (organization_id, included_credits, used_credits, addon_credits)
  values (v_org, v_included, 0, 0);

  return v_org;
end;
$$;

revoke all on function public.create_organization_atomic(uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_organization_atomic(uuid, text, text, text, text, text, jsonb) to service_role;
