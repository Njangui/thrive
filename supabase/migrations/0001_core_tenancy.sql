-- ============================================================
-- 0001_core_tenancy.sql
-- Phase 1 — Fondation multi-tenant : organizations, profils, memberships,
-- modules activables. Toute table métier future référence organization_id.
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- updated_at trigger générique, réutilisé par toutes les tables
-- ------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ------------------------------------------------------------
-- organizations = un tenant
-- ------------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,                -- utilisé pour tenant.sme-os.app
  industry text,                             -- ex: 'beauty' | 'restaurant' | 'real_estate'
                                              -- volontairement text libre, pas un enum fermé
                                              -- (section 32 : ne pas bloquer l'extensibilité)
  is_demo boolean not null default false,     -- section 43 : jamais mélanger demo/prod
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'suspended', 'cancelled')),
  plan text not null default 'trial',
  trial_start timestamptz not null default now(),
  trial_end timestamptz not null default (now() + interval '14 days'),
  timezone text not null default 'Africa/Douala',
  currency text not null default 'XAF',
  locale text not null default 'fr',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_organizations_updated_at
  before update on organizations
  for each row execute function set_updated_at();

-- Domaines custom (section 23) — préparé dès Phase 1, exploité en Phase 6
create table tenant_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  domain text not null unique,               -- ex: 'client.com' ou 'monsalon.sme-os.app'
  is_primary boolean not null default false,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_tenant_domains_org on tenant_domains(organization_id);

-- ------------------------------------------------------------
-- profiles = extension de auth.users (Supabase Auth)
-- ------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- memberships = lien user <-> organization + rôle (section 34)
-- Un même user peut appartenir à plusieurs tenants (ex: consultant).
-- ------------------------------------------------------------
create type member_role as enum (
  'owner', 'admin', 'manager', 'sales', 'cashier', 'employee', 'accountant'
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null default 'employee',
  -- permissions additionnelles ponctuelles au-delà du rôle standard
  -- (ex: {"manage_ai": true}). Le rôle reste la source de vérité principale.
  extra_permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index idx_memberships_org on memberships(organization_id);
create index idx_memberships_user on memberships(user_id);

-- ------------------------------------------------------------
-- tenant_modules = system de modules activables (section 33)
-- Une ligne par (organization, module). Absence de ligne = désactivé.
-- ------------------------------------------------------------
create table tenant_modules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  module text not null
    check (module in (
      'crm', 'revenue', 'finance', 'inventory', 'appointments',
      'orders', 'website', 'automation', 'ai_insights'
    )),
  enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (organization_id, module)
);

create trigger trg_tenant_modules_updated_at
  before update on tenant_modules
  for each row execute function set_updated_at();

create index idx_tenant_modules_org on tenant_modules(organization_id);

comment on table tenant_modules is
  'Section 33: une entreprise ne doit jamais voir/utiliser un module non activé. '
  'Vérifié à la fois côté route/server action ET, quand pertinent, via RLS.';
