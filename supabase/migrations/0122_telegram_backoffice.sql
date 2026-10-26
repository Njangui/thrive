-- ============================================================
-- 0122_telegram_backoffice.sql
-- C2 — étape 3 : bot Telegram de back-office.
--
-- `channel_active_org`        : entreprise active d'une identité liée à PLUSIEURS
--   tenants (commande /org). Une ligne par (canal, identifiant externe).
-- `channel_approval_prompts`  : cartes d'approbation envoyées dans Telegram
--   (message Telegram <-> action en attente <-> défi StepUp), pour que les
--   boutons inline et la saisie du PIN retrouvent la bonne action.
--
-- Écriture ET lecture : service_role uniquement (aucune policy, RLS activée) —
-- ces tables ne contiennent que des références, mais elles pilotent des
-- approbations : un client n'a aucune raison d'y toucher.
-- ============================================================
create table channel_active_org (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('telegram', 'whatsapp')),
  external_id text not null check (length(external_id) between 3 and 64),
  organization_id uuid not null references organizations(id) on delete cascade,
  updated_at timestamptz not null default now(),
  unique (channel, external_id)
);
create index idx_channel_active_org_org on channel_active_org(organization_id);
alter table channel_active_org enable row level security;

create table channel_approval_prompts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  membership_id uuid not null references memberships(id) on delete cascade,
  channel text not null default 'telegram' check (channel in ('telegram', 'whatsapp')),
  -- Telegram : chat privé (= id utilisateur) et id du message portant les boutons.
  chat_id text not null,
  channel_message_id text,
  assistant_message_id uuid references assistant_messages(id) on delete set null,
  -- Référence à l'action en attente de C1 (pending_actions), sans FK : table de C1.
  pending_action_id text not null,
  challenge_id uuid,
  -- Texte affiché de la carte : permet de la figer (sans boutons) après décision, y compris après saisie du PIN.
  card_text text,
  allowed_methods text[] not null default '{}',
  -- 'open' : boutons actifs ; 'awaiting_pin' : le prochain message numérique est
  -- un PIN ; 'done' : décidée ; 'expired'.
  status text not null default 'open' check (status in ('open', 'awaiting_pin', 'done', 'expired')),
  awaiting_pin_until timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_channel_approval_prompts_updated_at
  before update on channel_approval_prompts for each row execute function set_updated_at();
create index idx_channel_approval_prompts_lookup on channel_approval_prompts(membership_id, chat_id, status);
create index idx_channel_approval_prompts_org on channel_approval_prompts(organization_id);
create index idx_channel_approval_prompts_expiry on channel_approval_prompts(expires_at) where status in ('open', 'awaiting_pin');
alter table channel_approval_prompts enable row level security;
