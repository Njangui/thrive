-- ============================================================
-- 0006_webhooks_and_audit.sql
-- Phase 7 — Idempotence des webhooks (section 38) + audit log (section 39)
-- ============================================================

create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  provider text not null,             -- 'zernio' | 'cinetpay' | ...
  external_event_id text not null,    -- id fourni par le provider si disponible
  event_type text not null,
  payload_hash text not null,         -- hash du payload brut, détection doublon
  status text not null default 'received'
    check (status in ('received', 'processed', 'failed', 'ignored_duplicate')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, external_event_id)
);

create index idx_webhook_events_org on webhook_events(organization_id);
create index idx_webhook_events_status on webhook_events(status);

comment on table webhook_events is
  'Section 38: un même external_event_id ne doit jamais être traité deux fois. '
  'Le handler doit INSERT ici avant tout traitement métier ; en cas de '
  'unique_violation, on court-circuite avec status=ignored_duplicate.';

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  action text not null,               -- ex: 'PRICE_UPDATED', 'USER_ROLE_CHANGED'
  entity_type text,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_logs_org on audit_logs(organization_id, created_at);

alter table webhook_events enable row level security;
alter table audit_logs enable row level security;

-- webhook_events est écrit/lu uniquement par service_role (pas de policy
-- pour les users normaux) — RLS activé mais sans policy = accès refusé
-- par défaut à tout rôle non-service_role, ce qui est le comportement voulu.

create policy "members can read audit_logs of their org"
  on audit_logs for select
  using (is_member_of_org(organization_id));
