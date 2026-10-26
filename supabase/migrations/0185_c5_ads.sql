-- ============================================================
-- 0185_c5_ads.sql
-- C5 — Pubs : plafonds de dépense par tenant et journal des demandes de pub.
--
-- L'argent de la pub est payé À META par le tenant (Zernio ne prend aucun pourcentage) :
-- Flexco ne peut pas le « débiter » dans le registre d'usage. Le garde-fou est donc posé
-- À LA CRÉATION : sans plafonds définis, AUCUNE pub n'est possible (défaut sûr, aucun
-- montant inventé). Les plafonds sont dans la devise du compte pub, sans conversion.
-- ============================================================
alter table growth_settings
  add column if not exists ads_daily_cap numeric(14, 2) check (ads_daily_cap is null or ads_daily_cap > 0),
  add column if not exists ads_monthly_cap numeric(14, 2) check (ads_monthly_cap is null or ads_monthly_cap > 0),
  add column if not exists ads_cap_currency text check (ads_cap_currency is null or ads_cap_currency ~ '^[A-Z]{3}$');

alter table growth_settings drop constraint if exists growth_settings_ads_caps_consistent;
alter table growth_settings add constraint growth_settings_ads_caps_consistent check (
  (ads_daily_cap is null and ads_monthly_cap is null and ads_cap_currency is null)
  or (ads_daily_cap is not null and ads_monthly_cap is not null and ads_cap_currency is not null and ads_daily_cap <= ads_monthly_cap)
);

create table if not exists ad_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  kind text not null default 'whatsapp_ad' check (kind in ('whatsapp_ad')),
  request jsonb not null,
  -- Empreinte confirmée par l'humain : l'agent ne peut rien changer après le « oui ».
  request_fingerprint text not null,
  idempotency_key text not null,
  account_id text not null,        -- compte Zernio connecté (vérifié appartenir au tenant)
  ad_account_id text not null,     -- compte pub Meta (vérifié joignable par ce compte)
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  budget_type text not null check (budget_type in ('daily', 'lifetime')),
  budget_amount numeric(14, 2) not null check (budget_amount > 0),
  start_date date not null,
  end_date date not null,
  status text not null default 'pending' check (status in ('pending', 'submitted', 'failed', 'paused')),
  zernio_ad_id text,
  platform_campaign_id text,
  platform_ad_set_id text,
  platform_ad_id text,
  review_status text,
  paused_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  unique (organization_id, idempotency_key)
);

create trigger trg_ad_requests_updated_at
  before update on ad_requests
  for each row execute function set_updated_at();

create index idx_ad_requests_org_status on ad_requests(organization_id, status);
create index idx_ad_requests_org_created on ad_requests(organization_id, created_at desc);

alter table ad_requests enable row level security;

-- Lecture seule pour les membres ; AUCUNE politique d'écriture : seul le service-role écrit.
create policy "members can read ad_requests of their org"
  on ad_requests for select
  using (is_member_of_org(organization_id));
