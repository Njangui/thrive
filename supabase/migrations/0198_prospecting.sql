-- ============================================================
-- 0198_prospecting.sql
-- Agent de prospection WhatsApp (Flexco -> entreprises) : campagnes, liste de prospects importée (CSV/Excel),
-- désinscriptions persistantes et modèles Meta de prospection.
--
-- Garde-fous portés par la base :
--  - une campagne ne démarre qu'après une validation du propriétaire liée à l'empreinte du message et de la liste ;
--  - 1 relance maximum par prospect (max_followups <= 1) ;
--  - un numéro désinscrit (STOP) ne peut plus jamais être contacté, par aucune campagne (table prospect_opt_outs) ;
--  - plafond quotidien borné (1 à 200).
-- Toutes les écritures passent par le service (service-role) ; les membres ne font que lire leurs données.
-- ============================================================

create table prospect_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'draft' check (status in ('draft', 'approved', 'running', 'paused', 'completed', 'cancelled')),
  daily_cap integer not null default 20 check (daily_cap between 1 and 200),
  window_start_hour smallint not null default 9 check (window_start_hour between 0 and 23),
  window_end_hour smallint not null default 18 check (window_end_hour between 1 and 24),
  timezone text not null default 'Africa/Douala',
  max_followups smallint not null default 1 check (max_followups between 0 and 1),
  followup_delay_hours integer not null default 72 check (followup_delay_hours between 24 and 336),
  default_country_code text not null default '237' check (default_country_code ~ '^[0-9]{1,3}$'),
  -- Attestation de l'émetteur : base de contact des numéros importés (obligatoire à la validation).
  consent_basis text check (consent_basis is null or char_length(consent_basis) between 10 and 500),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  -- Empreinte (message d'introduction + relance + liste) vue au moment de la validation ; toute modification la rend caduque.
  approved_fingerprint text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_prospect_campaign_window check (window_end_hour > window_start_hour),
  constraint ck_prospect_campaign_approval check (status not in ('approved', 'running') or (approved_at is not null and approved_fingerprint is not null and consent_basis is not null))
);
create index idx_prospect_campaigns_org on prospect_campaigns (organization_id, status);
create trigger trg_prospect_campaigns_updated_at before update on prospect_campaigns for each row execute function set_updated_at();

create table prospects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  campaign_id uuid not null references prospect_campaigns(id) on delete cascade,
  full_name text check (full_name is null or char_length(full_name) <= 120),
  company text check (company is null or char_length(company) <= 120),
  sector text check (sector is null or char_length(sector) <= 80),
  city text check (city is null or char_length(city) <= 80),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (email is null or char_length(email) <= 200),
  extra jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object' and pg_column_size(extra) <= 4096),
  status text not null default 'queued' check (status in ('queued', 'contacted', 'followed_up', 'replied', 'interested', 'not_interested', 'opted_out', 'failed', 'converted')),
  contacted_at timestamptz,
  followup_sent_at timestamptz,
  last_reply_at timestamptz,
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, phone_e164)
);
create index idx_prospects_campaign_status on prospects (campaign_id, status);
create index idx_prospects_org_phone on prospects (organization_id, phone_e164);
create trigger trg_prospects_updated_at before update on prospects for each row execute function set_updated_at();

create table prospect_opt_outs (
  organization_id uuid not null references organizations(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  reason text not null default 'stop' check (reason in ('stop', 'refusal', 'manual')),
  created_at timestamptz not null default now(),
  primary key (organization_id, phone_e164)
);

-- Modèles Meta de prospection (catégorie MARKETING) : un par usage et par entreprise.
create table prospecting_templates (
  organization_id uuid not null references organizations(id) on delete cascade,
  template_key text not null check (template_key in ('intro', 'followup')),
  name text not null check (name ~ '^[a-z][a-z0-9_]{0,63}$'),
  status text not null default 'NOT_SUBMITTED' check (status in ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED', 'IN_APPEAL', 'PAUSED', 'DISABLED', 'PENDING_DELETION')),
  reason text check (reason is null or char_length(reason) <= 500),
  provider_template_id text,
  updated_at timestamptz not null default now(),
  primary key (organization_id, template_key)
);

alter table prospect_campaigns enable row level security;
alter table prospects enable row level security;
alter table prospect_opt_outs enable row level security;
alter table prospecting_templates enable row level security;

create policy "members can read prospect_campaigns of their org" on prospect_campaigns for select using (is_member_of_org(organization_id));
create policy "members can read prospects of their org" on prospects for select using (is_member_of_org(organization_id));
create policy "members can read prospect_opt_outs of their org" on prospect_opt_outs for select using (is_member_of_org(organization_id));
create policy "members can read prospecting_templates of their org" on prospecting_templates for select using (is_member_of_org(organization_id));
