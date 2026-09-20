-- ============================================================
-- 0063_whatsapp_multi_numbers.sql
-- Plusieurs numéros WhatsApp de messagerie 1:1 par organisation.
--
-- Zernio impose 1 numéro WhatsApp par profil. Le Pro autorise donc
-- plusieurs profils Zernio, un par numéro. Les groupes restent séparés
-- dans provider_type='whatsapp_groups' et ne sont jamais mélangés ici.
-- ============================================================

create table whatsapp_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  profile_id text not null,
  account_id text not null,
  phone_number text,
  username text,
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, account_id),
  unique (organization_id, profile_id)
);

create trigger trg_whatsapp_accounts_updated_at
  before update on whatsapp_accounts
  for each row execute function set_updated_at();

create index idx_whatsapp_accounts_org_status on whatsapp_accounts(organization_id, status);

alter table whatsapp_accounts enable row level security;

create policy "members can read whatsapp accounts of their org"
  on whatsapp_accounts for select
  using (is_member_of_org(organization_id));

create policy "owner/admin can manage whatsapp accounts"
  on whatsapp_accounts for all
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'))
  with check (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));

-- Migration des connexions WhatsApp 1:1 existantes vers le modèle multi-numéros.
insert into whatsapp_accounts (organization_id, profile_id, account_id, phone_number, username, status, is_primary)
select
  organization_id,
  metadata->>'profileId',
  metadata->>'accountId',
  nullif(metadata->>'username', ''),
  nullif(metadata->>'username', ''),
  case when status = 'error' then 'error' else 'connected' end,
  true
from provider_connections
where provider_name = 'zernio'
  and provider_type = 'messaging'
  and metadata->>'platform' = 'whatsapp'
  and metadata->>'profileId' is not null
  and metadata->>'accountId' is not null
on conflict (organization_id, account_id) do update set
  profile_id = excluded.profile_id,
  username = coalesce(excluded.username, whatsapp_accounts.username),
  status = excluded.status;

-- Les anciennes lignes provider_connections restent conservées pour
-- compatibilité avec les autres canaux Zernio et les organisations
-- existantes. Le nouveau resolver WhatsApp lit désormais whatsapp_accounts.

alter table conversations add column if not exists provider_account_id text;
create index if not exists idx_conversations_provider_account
  on conversations(organization_id, channel, provider_account_id);

comment on table whatsapp_accounts is
  'Numéros WhatsApp de messagerie 1:1. Un profil Zernio = un numéro. Les groupes utilisent une connexion séparée whatsapp_groups.';
