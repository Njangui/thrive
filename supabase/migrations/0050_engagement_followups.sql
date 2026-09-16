-- 0050_engagement_followups.sql
-- Relances automatiques 24h/48h, déterministes avant IA.

create table if not exists automated_followups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  tier text not null check (tier in ('engaged_24h', 'standard_48h')),
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  channel text,
  message_content text,
  provider_message_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (lead_id, tier)
);

create index if not exists idx_automated_followups_due
  on automated_followups(status, due_at);
create index if not exists idx_automated_followups_org
  on automated_followups(organization_id, status);

alter table automated_followups enable row level security;
create policy "members can access automated_followups of their org"
  on automated_followups for all
  using (is_member_of_org(organization_id));
