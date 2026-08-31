-- ============================================================
-- 0003_crm.sql
-- Phase 4 (préparée dès Phase 1 pour supporter le workflow central,
-- section 64) — Contact / Lead / Conversation / Message.
-- ============================================================

create table contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  full_name text,
  phone_e164 text,                    -- canal WhatsApp = identifiant principal V1
  email text,
  source_channel text,                -- 'whatsapp' | 'website' | 'manual' | ...
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, phone_e164)
);

create trigger trg_contacts_updated_at
  before update on contacts
  for each row execute function set_updated_at();

create index idx_contacts_org on contacts(organization_id);

create type lead_status as enum (
  'visitor', 'lead', 'qualified', 'opportunity', 'customer', 'lost'
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  status lead_status not null default 'lead',
  source text,
  intent text,
  budget_estimate numeric(14,2),
  -- Score IA (section 12) : jamais inventé, toujours accompagné de sa raison
  -- et du modèle qui l'a produit. NULL tant qu'aucun calcul n'a eu lieu.
  score integer check (score is null or (score between 0 and 100)),
  score_reason text,
  score_model text,
  score_computed_at timestamptz,
  assigned_user_id uuid references auth.users(id),
  last_contact_at timestamptz,
  next_follow_up_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_leads_updated_at
  before update on leads
  for each row execute function set_updated_at();

create index idx_leads_org on leads(organization_id);
create index idx_leads_org_status on leads(organization_id, status);
create index idx_leads_contact on leads(contact_id);

create table lead_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  event_type text not null,          -- ex: 'STATUS_CHANGED', 'SCORE_UPDATED', 'NOTE_ADDED'
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_lead_events_lead on lead_events(lead_id);

create table follow_up_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  assigned_to uuid references auth.users(id),
  channel text,                      -- 'whatsapp' | 'call' | 'email'
  reason text,
  created_at timestamptz not null default now()
);

create index idx_follow_up_org_status on follow_up_tasks(organization_id, status);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  channel text not null default 'whatsapp',
  external_thread_id text,           -- identifiant côté provider (ex: Zernio)
  handoff_status text not null default 'ai'
    check (handoff_status in ('ai', 'pending_human', 'human', 'resolved')),
  handoff_reason text,
  assigned_user_id uuid references auth.users(id),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, channel, external_thread_id)
);

create trigger trg_conversations_updated_at
  before update on conversations
  for each row execute function set_updated_at();

create index idx_conversations_org on conversations(organization_id);

create table messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  sender text not null check (sender in ('contact', 'ai', 'human')),
  content text not null,
  external_message_id text,          -- id côté provider, pour idempotence
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_messages_conversation on messages(conversation_id, created_at);

-- ------------------------------------------------------------
-- RLS — même pattern que 0002 pour toutes les tables ci-dessus
-- ------------------------------------------------------------
alter table contacts enable row level security;
alter table leads enable row level security;
alter table lead_events enable row level security;
alter table follow_up_tasks enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;

create policy "members can access contacts of their org"
  on contacts for all
  using (is_member_of_org(organization_id));

create policy "members can access leads of their org"
  on leads for all
  using (is_member_of_org(organization_id));

create policy "members can access lead_events of their org"
  on lead_events for all
  using (is_member_of_org(organization_id));

create policy "members can access follow_up_tasks of their org"
  on follow_up_tasks for all
  using (is_member_of_org(organization_id));

create policy "members can access conversations of their org"
  on conversations for all
  using (is_member_of_org(organization_id));

create policy "members can access messages of their org"
  on messages for all
  using (is_member_of_org(organization_id));
