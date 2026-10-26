-- ============================================================
-- 0187_ai_token_usage.sql
-- Journal de consommation de tokens IA : une ligne par appel facturé,
-- avec la tâche, le niveau de routage (simple/complexe), le modèle,
-- les tokens réels et les crédits débités. Écrit par le service-role
-- uniquement ; les membres de l'organisation peuvent le lire.
-- ============================================================
create table if not exists ai_token_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  task text not null check (char_length(task) <= 60),
  tier text not null check (tier in ('simple', 'complex')),
  provider text not null,
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  credits_charged integer not null default 0 check (credits_charged >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_token_usage_org_created on ai_token_usage(organization_id, created_at desc);

alter table ai_token_usage enable row level security;

drop policy if exists "members can read ai_token_usage of their org" on ai_token_usage;
create policy "members can read ai_token_usage of their org"
  on ai_token_usage for select
  using (is_member_of_org(organization_id));
-- Aucune policy INSERT/UPDATE/DELETE : écriture réservée au service-role.
