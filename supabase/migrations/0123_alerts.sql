-- ============================================================
-- 0123_alerts.sql
-- C2 — étape 4 : alertes propriétaire (notify + heures calmes + escalade).
--
-- `alert_settings`   : réglages par entreprise (déclencheurs, seuils, heures
--   calmes, délai d'escalade, personne de repli). Une ligne par entreprise.
-- `alerts`           : une alerte levée (dédupliquée tant qu'elle est ouverte).
-- `alert_deliveries` : journal des envois par canal (preuve + diagnostic).
--
-- Échelle d'escalade : 0 push -> 1 Telegram/WhatsApp/email aux propriétaires
-- -> 2 personne de repli -> 3 expirée. AUCUN appel téléphonique.
-- Écriture ET lecture : service_role uniquement (RLS activée, aucune policy).
-- ============================================================
create table alert_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references organizations(id) on delete cascade,
  -- { "<trigger>": { "enabled": bool, "threshold": number? } } — fusionné avec les défauts côté code.
  triggers jsonb not null default '{}'::jsonb,
  quiet_enabled boolean not null default false,
  quiet_start text not null default '22:00' check (quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  quiet_end text not null default '07:00' check (quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  escalation_delay_minutes integer not null default 15 check (escalation_delay_minutes between 1 and 1440),
  fallback_membership_id uuid references memberships(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_alert_settings_updated_at
  before update on alert_settings for each row execute function set_updated_at();
alter table alert_settings enable row level security;

create table alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trigger_key text not null check (length(trigger_key) between 1 and 64),
  severity text not null check (severity in ('info', 'important', 'critical')),
  title text not null check (length(title) between 1 and 200),
  body text not null default '' check (length(body) <= 2000),
  url text,
  dedupe_key text not null check (length(dedupe_key) between 1 and 200),
  value numeric,
  -- held : retenue (heures calmes) ; open : en cours d'escalade ; acknowledged ; expired.
  status text not null default 'open' check (status in ('held', 'open', 'acknowledged', 'expired')),
  escalation_step integer not null default 0 check (escalation_step between 0 and 3),
  release_at timestamptz,
  next_escalation_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid references memberships(id) on delete set null,
  acknowledged_via text check (acknowledged_via in ('dashboard', 'telegram', 'whatsapp')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_alerts_updated_at
  before update on alerts for each row execute function set_updated_at();
-- Une seule alerte vivante par (entreprise, clé) : 23505 = doublon.
create unique index uq_alerts_live_dedupe on alerts(organization_id, dedupe_key) where status in ('held', 'open');
create index idx_alerts_org_created on alerts(organization_id, created_at desc);
create index idx_alerts_due on alerts(next_escalation_at) where status = 'open';
create index idx_alerts_release on alerts(release_at) where status = 'held';
alter table alerts enable row level security;

create table alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references alerts(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  membership_id uuid references memberships(id) on delete set null,
  channel text not null check (channel in ('push', 'telegram', 'whatsapp', 'email', 'in_app')),
  step integer not null check (step between 0 and 3),
  status text not null check (status in ('sent', 'skipped', 'failed')),
  reason text check (reason is null or length(reason) <= 200),
  created_at timestamptz not null default now()
);
create index idx_alert_deliveries_alert on alert_deliveries(alert_id);
create index idx_alert_deliveries_org on alert_deliveries(organization_id, created_at desc);
alter table alert_deliveries enable row level security;
