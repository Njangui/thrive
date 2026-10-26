-- ============================================================
-- 0124_whatsapp_backoffice.sql
-- C2 — étape 5 : back-office WhatsApp via Zernio.
--
-- Le numéro WhatsApp du tenant est PUBLIC : le personnel s'identifie par une
-- liste de numéros (channel_identities, channel = 'whatsapp') liés à des
-- memberships par un code à usage unique envoyé DEPUIS le numéro à prouver.
--
-- `whatsapp_backoffice_settings` : mode back-office par entreprise (+ numéro
--   dédié optionnel : tout message reçu sur ce numéro est du back-office).
-- `whatsapp_templates`           : modèles Meta (hors fenêtre de 24 h) et leur
--   état d'approbation, synchronisé par webhook et à la demande.
-- `whatsapp_channel_health`      : état du compte (restriction, qualité, alerte).
-- `whatsapp_delivery_failures`   : échecs de livraison -> bannière de diagnostic.
-- Tout est service_role uniquement (RLS activée, aucune policy).
-- ============================================================
create table whatsapp_backoffice_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references organizations(id) on delete cascade,
  enabled boolean not null default false,
  -- account_id Zernio d'un numéro réservé au back-office (optionnel).
  dedicated_account_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_whatsapp_backoffice_settings_updated_at
  before update on whatsapp_backoffice_settings for each row execute function set_updated_at();
alter table whatsapp_backoffice_settings enable row level security;

create table whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  template_key text not null check (template_key in ('alert', 'approval_request', 'daily_summary')),
  name text not null check (name ~ '^[a-z][a-z0-9_]{0,63}$'),
  language text not null check (length(language) between 2 and 10),
  category text not null check (category in ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
  -- Statuts Zernio/Meta + 'NOT_SUBMITTED' avant le premier envoi.
  status text not null default 'NOT_SUBMITTED' check (status in ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED', 'IN_APPEAL', 'PAUSED', 'DISABLED', 'PENDING_DELETION')),
  reason text check (reason is null or length(reason) <= 500),
  provider_template_id text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, template_key)
);
create index idx_whatsapp_templates_name on whatsapp_templates(organization_id, name);
create trigger trg_whatsapp_templates_updated_at
  before update on whatsapp_templates for each row execute function set_updated_at();
alter table whatsapp_templates enable row level security;

create table whatsapp_channel_health (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references organizations(id) on delete cascade,
  account_status text not null default 'active' check (account_status in ('active', 'restricted')),
  restrictions text check (restrictions is null or length(restrictions) <= 500),
  quality_rating text check (quality_rating in ('GREEN', 'YELLOW', 'RED')),
  last_alert_severity text check (last_alert_severity in ('CRITICAL', 'WARNING', 'INFORMATIONAL')),
  last_alert_description text check (last_alert_description is null or length(last_alert_description) <= 500),
  last_alert_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table whatsapp_channel_health enable row level security;

create table whatsapp_delivery_failures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  external_message_id text,
  error_message text check (error_message is null or length(error_message) <= 500),
  -- Classification best-effort du message d'erreur (voir whatsapp-templates.ts::classifyFailure).
  probable_cause text not null default 'other' check (probable_cause in ('payment', 'window', 'other')),
  created_at timestamptz not null default now()
);
create index idx_whatsapp_delivery_failures_org on whatsapp_delivery_failures(organization_id, created_at desc);
alter table whatsapp_delivery_failures enable row level security;

-- Fenêtre de 24 h et fil de conversation du dernier message ENTRANT de l'identité.
alter table channel_identities add column last_inbound_at timestamptz;
alter table channel_identities add column whatsapp_conversation_id text;
alter table channel_identities add column whatsapp_account_id text;
