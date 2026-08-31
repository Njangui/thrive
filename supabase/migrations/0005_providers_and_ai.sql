-- ============================================================
-- 0005_providers_and_ai.sql
-- Phase 2/8 — provider_connections (section 36) + ai_config (section 8/9)
-- ============================================================

create table provider_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  provider_type text not null check (provider_type in
    ('messaging', 'ai', 'payment', 'storage', 'notification')),
  provider_name text not null,        -- 'zernio' | 'mistral' | 'cinetpay' | ...
  status text not null default 'disconnected'
    check (status in ('disconnected', 'connected', 'error')),
  -- IMPORTANT (section 36) : jamais de clé API en clair ici.
  -- `credential_reference` pointe vers un secret stocké dans Supabase Vault
  -- (extension pgsodium/vault) ou un secret manager externe — jamais dans
  -- une colonne lisible via l'API publique. Le frontend ne reçoit jamais
  -- cette valeur (voir docs/providers.md).
  credential_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider_type, provider_name)
);

create trigger trg_provider_connections_updated_at
  before update on provider_connections
  for each row execute function set_updated_at();

create index idx_provider_connections_org on provider_connections(organization_id);

create table ai_config (
  organization_id uuid primary key references organizations(id) on delete cascade,
  provider text not null default 'mistral',
  fallback_provider text,
  model text not null default 'mistral-small-latest',
  system_instructions text,           -- construit via TenantAIContext, pas concaténé brut
  tone text default 'professionnel et chaleureux',
  language text not null default 'fr',
  objectives jsonb not null default '[]'::jsonb,
  max_tokens integer not null default 512,
  temperature numeric(3,2) default 0.4,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create trigger trg_ai_config_updated_at
  before update on ai_config
  for each row execute function set_updated_at();

alter table provider_connections enable row level security;
alter table ai_config enable row level security;

create policy "members can read provider_connections of their org"
  on provider_connections for select
  using (is_member_of_org(organization_id));

create policy "owner/admin can manage provider_connections"
  on provider_connections for all
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));

create policy "members can read ai_config of their org"
  on ai_config for select
  using (is_member_of_org(organization_id));

create policy "owner/admin can manage ai_config"
  on ai_config for all
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));
