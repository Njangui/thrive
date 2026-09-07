-- ============================================================
-- 0002_rls_policies.sql
-- Phase 1 — Isolation tenant stricte (section 2, 35).
-- Règle d'or : AUCUNE query ne doit pouvoir traverser un organization_id
-- sans passer par ces policies. Le service_role (utilisé côté serveur
-- pour les webhooks/jobs) bypass RLS par design Supabase — c'est
-- pourquoi TOUTE logique appelée avec service_role doit filtrer
-- explicitement par organization_id dans le code applicatif (voir
-- docs/tenancy.md, section "double vérification").
-- ============================================================

-- ------------------------------------------------------------
-- Helper : l'utilisateur courant est-il membre de cette organization ?
-- SECURITY DEFINER pour pouvoir lire `memberships` même si la policy
-- sur `memberships` elle-même restreint l'accès direct.
-- ------------------------------------------------------------
create or replace function is_member_of_org(target_org_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from memberships m
    where m.organization_id = target_org_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function current_org_role(target_org_id uuid)
returns member_role
language sql
security definer
stable
as $$
  select m.role
  from memberships m
  where m.organization_id = target_org_id
    and m.user_id = auth.uid()
  limit 1;
$$;

-- ------------------------------------------------------------
-- organizations
-- ------------------------------------------------------------
alter table organizations enable row level security;

create policy "members can read their organization"
  on organizations for select
  using (is_member_of_org(id));

create policy "owner/admin can update their organization"
  on organizations for update
  using (is_member_of_org(id) and current_org_role(id) in ('owner', 'admin'));

-- L'insertion d'une organization se fait via une fonction serveur dédiée
-- (onboarding, section 31) avec service_role — pas de policy INSERT publique.

-- ------------------------------------------------------------
-- tenant_domains
-- ------------------------------------------------------------
alter table tenant_domains enable row level security;

create policy "members can read their domains"
  on tenant_domains for select
  using (is_member_of_org(organization_id));

create policy "owner/admin can manage domains"
  on tenant_domains for all
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));

-- ------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------
alter table profiles enable row level security;

create policy "user can read own profile"
  on profiles for select
  using (id = auth.uid());

create policy "user can update own profile"
  on profiles for update
  using (id = auth.uid());

-- ------------------------------------------------------------
-- memberships
-- ------------------------------------------------------------
alter table memberships enable row level security;

create policy "members can see co-members of their org"
  on memberships for select
  using (is_member_of_org(organization_id));

create policy "owner/admin can manage memberships"
  on memberships for all
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));

-- ------------------------------------------------------------
-- tenant_modules
-- ------------------------------------------------------------
alter table tenant_modules enable row level security;

create policy "members can read enabled modules"
  on tenant_modules for select
  using (is_member_of_org(organization_id));

create policy "owner/admin can manage modules"
  on tenant_modules for all
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));
