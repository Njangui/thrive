-- ============================================================
-- 0067_freemium_v2_multi_accounts.sql
--
-- Freemium v2 (Discover / Starter / Pro) — lot O :
--   A. Nouvelles clés de plan + verrous (CRM, commandes, rendez-vous,
--      analytique du site, domaine perso, badge, relances, messagerie).
--   B. Multi-comptes réels : bots Telegram, canaux/groupes Telegram,
--      comptes YouTube, comptes sociaux Zernio (Facebook, Instagram...).
--   C. Commentaires FB/IG : pipeline identique aux messages
--      (réponse automatique, escalade) + premier commentaire.
--   D. Diffusions vers des contacts (Starter/Pro) avec désinscription.
--   E. Vidéos du catalogue : rétention par plan, stockage permanent Zernio.
--
-- Idempotente : `if not exists` / `on conflict` partout, rejouable sans
-- effet. Les données historiques (1 bot Telegram, 1 compte YouTube, le
-- dernier compte social) sont recopiées dans les nouvelles tables.
-- ============================================================

-- ------------------------------------------------------------
-- A. Clés de plan
-- ------------------------------------------------------------
insert into plan_entitlements (plan_key, entitlement_key, limit_value) values
  -- Telegram : nombre de canaux et de groupes ENREGISTRÉS (cumulatif).
  -- Anciennement `telegram_groups` = total 2 / 5 / 20 destinations par
  -- publication ; le total est conservé, réparti canaux + groupes.
  ('free',    'telegram_bots',     1),
  ('starter', 'telegram_bots',     3),
  ('pro',     'telegram_bots',    10),
  ('free',    'telegram_channels', 1),
  ('starter', 'telegram_channels', 3),
  ('pro',     'telegram_channels', 12),
  ('free',    'telegram_groups',   1),
  ('starter', 'telegram_groups',   2),
  ('pro',     'telegram_groups',   8),

  -- YouTube (cumulatif, table youtube_accounts).
  ('free',    'youtube_accounts',  1),
  ('starter', 'youtube_accounts',  3),
  ('pro',     'youtube_accounts', 10),

  -- Verrous Starter+ demandés : CRM, commandes, rendez-vous, analytique
  -- du site, relances automatiques (partie du CRM), domaine perso.
  ('free',    'crm',            0),
  ('starter', 'crm',            1),
  ('pro',     'crm',            1),
  ('free',    'follow_ups',     0),
  ('starter', 'follow_ups',     1),
  ('pro',     'follow_ups',     1),
  ('free',    'orders',         0),
  ('starter', 'orders',         1),
  ('pro',     'orders',         1),
  ('free',    'appointments',   0),
  ('starter', 'appointments',   1),
  ('pro',     'appointments',   1),
  ('free',    'site_analytics', 0),
  ('starter', 'site_analytics', 1),
  ('pro',     'site_analytics', 1),
  ('free',    'custom_domain',  0),
  ('starter', 'custom_domain',  1),
  ('pro',     'custom_domain',  1),
  -- Badge « Site propulsé par CRESYVA » retirable en Pro uniquement.
  ('free',    'remove_branding', 0),
  ('starter', 'remove_branding', 0),
  ('pro',     'remove_branding', 1),

  -- Messagerie : semi-automatique (FAQ, infos entreprise, catalogue) pour
  -- tous ; réponse automatique complète (IA en dernier recours) Starter+.
  ('free',    'semi_automatic_messaging', 1),
  ('starter', 'semi_automatic_messaging', 1),
  ('pro',     'semi_automatic_messaging', 1),
  ('free',    'automatic_messaging', 0),
  ('starter', 'automatic_messaging', 1),
  ('pro',     'automatic_messaging', 1),
  -- Messagerie unifiée : Messenger dès Starter, Instagram DM en Pro.
  ('free',    'facebook_messenger', 0),
  ('starter', 'facebook_messenger', 1),
  ('pro',     'facebook_messenger', 1),
  ('free',    'instagram_messages', 0),
  ('starter', 'instagram_messages', 0),
  ('pro',     'instagram_messages', 1),

  -- Commentaires : réponse automatique FB (Starter+), FB+IG (Pro),
  -- commentaires unifiés (Pro). TikTok retiré à la demande (0 partout,
  -- réactivable sans code depuis /admin/plans).
  ('free',    'facebook_auto_comments', 0),
  ('starter', 'facebook_auto_comments', 1),
  ('pro',     'facebook_auto_comments', 1),
  ('free',    'instagram_auto_comments', 0),
  ('starter', 'instagram_auto_comments', 0),
  ('pro',     'instagram_auto_comments', 1),
  ('free',    'tiktok_auto_comments', 0),
  ('starter', 'tiktok_auto_comments', 0),
  ('pro',     'tiktok_auto_comments', 0),
  ('free',    'unified_comments', 0),
  ('starter', 'unified_comments', 0),
  ('pro',     'unified_comments', 1),

  -- Diffusions vers des contacts : contacts par campagne.
  ('free',    'broadcast_contacts', 0),
  ('starter', 'broadcast_contacts', 50),
  ('pro',     'broadcast_contacts', 100),

  -- Vidéos du catalogue : durée de conservation (jours).
  ('free',    'video_retention_days', 7),
  ('starter', 'video_retention_days', 30),
  ('pro',     'video_retention_days', 90)
on conflict (plan_key, entitlement_key) do update set limit_value = excluded.limit_value;

-- ------------------------------------------------------------
-- B1. Bots Telegram (plusieurs par organisation)
-- Secrets (webhook_secret, credential_reference) : RLS activée SANS
-- policy membre — accès uniquement via service-role côté serveur.
-- ------------------------------------------------------------
create table if not exists telegram_bots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  bot_id bigint,
  bot_username text not null,
  bot_name text,
  credential_reference text,
  webhook_path_token text not null unique,
  webhook_secret text not null,
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, bot_username)
);
create index if not exists idx_telegram_bots_org on telegram_bots(organization_id, status);
create unique index if not exists idx_telegram_bots_primary
  on telegram_bots(organization_id) where is_primary and status = 'connected';
drop trigger if exists trg_telegram_bots_updated_at on telegram_bots;
create trigger trg_telegram_bots_updated_at
  before update on telegram_bots
  for each row execute function set_updated_at();
alter table telegram_bots enable row level security;

-- Reprise de l'ancien bot unique (provider_connections messaging/telegram).
insert into telegram_bots (organization_id, bot_username, credential_reference, webhook_path_token, webhook_secret, status, is_primary)
select
  organization_id,
  coalesce(metadata->>'botUsername', 'bot_' || left(id::text, 8)),
  credential_reference,
  metadata->>'webhookPathToken',
  coalesce(metadata->>'webhookSecret', ''),
  case when status = 'connected' then 'connected' else 'disconnected' end,
  status = 'connected'
from provider_connections
where provider_type = 'messaging' and provider_name = 'telegram'
  and metadata->>'webhookPathToken' is not null
on conflict do nothing;

-- ------------------------------------------------------------
-- B2. Destinations Telegram (canaux et groupes enregistrés)
-- ------------------------------------------------------------
create table if not exists telegram_destinations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  bot_id uuid not null references telegram_bots(id) on delete cascade,
  chat_id text not null,
  chat_type text not null check (chat_type in ('channel', 'group')),
  title text,
  username text,
  status text not null default 'active' check (status in ('active', 'disabled', 'error')),
  error_message text,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, chat_id)
);
create index if not exists idx_telegram_destinations_org on telegram_destinations(organization_id, chat_type, status);
drop trigger if exists trg_telegram_destinations_updated_at on telegram_destinations;
create trigger trg_telegram_destinations_updated_at
  before update on telegram_destinations
  for each row execute function set_updated_at();
alter table telegram_destinations enable row level security;
drop policy if exists "members can access telegram destinations of their org" on telegram_destinations;
create policy "members can access telegram destinations of their org"
  on telegram_destinations for all
  using (is_member_of_org(organization_id))
  with check (is_member_of_org(organization_id));

alter table telegram_publications add column if not exists bot_id uuid references telegram_bots(id) on delete set null;
alter table telegram_publications add column if not exists destination_id uuid references telegram_destinations(id) on delete set null;

-- ------------------------------------------------------------
-- B3. Comptes YouTube (plusieurs par organisation)
-- ------------------------------------------------------------
create table if not exists youtube_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  channel_id text not null,
  title text,
  username text,
  credential_reference text,
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, channel_id)
);
create index if not exists idx_youtube_accounts_org on youtube_accounts(organization_id, status);
drop trigger if exists trg_youtube_accounts_updated_at on youtube_accounts;
create trigger trg_youtube_accounts_updated_at
  before update on youtube_accounts
  for each row execute function set_updated_at();
alter table youtube_accounts enable row level security;

insert into youtube_accounts (organization_id, channel_id, title, username, credential_reference, status)
select
  organization_id,
  coalesce(metadata->>'channelId', 'legacy-' || left(id::text, 8)),
  metadata->>'title',
  metadata->>'username',
  credential_reference,
  case when status = 'connected' then 'connected' else 'disconnected' end
from provider_connections
where provider_type = 'social' and provider_name = 'youtube'
on conflict do nothing;

-- ------------------------------------------------------------
-- B4. Comptes sociaux Zernio (Facebook, Instagram, LinkedIn, TikTok...)
-- Registre durable : quotas cumulés, routage des webhooks par compte,
-- réglages de réponse automatique par compte.
-- ------------------------------------------------------------
create table if not exists zernio_social_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  profile_id text not null unique,
  label text,
  created_at timestamptz not null default now()
);
create index if not exists idx_zernio_social_profiles_org on zernio_social_profiles(organization_id);
alter table zernio_social_profiles enable row level security;

create table if not exists social_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  platform text not null,
  account_id text not null unique,
  profile_id text not null,
  username text,
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
  auto_reply_comments boolean not null default true,
  auto_reply_messages boolean not null default true,
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_social_accounts_org on social_accounts(organization_id, platform, status);
create index if not exists idx_social_accounts_profile on social_accounts(profile_id);
drop trigger if exists trg_social_accounts_updated_at on social_accounts;
create trigger trg_social_accounts_updated_at
  before update on social_accounts
  for each row execute function set_updated_at();
alter table social_accounts enable row level security;
drop policy if exists "members can read social accounts of their org" on social_accounts;
create policy "members can read social accounts of their org"
  on social_accounts for select
  using (is_member_of_org(organization_id));

-- Reprise du dernier compte social connu (ligne unique historique).
insert into social_accounts (organization_id, platform, account_id, profile_id, username, status)
select
  organization_id,
  metadata->>'platform',
  metadata->>'accountId',
  metadata->>'profileId',
  metadata->>'username',
  case when status = 'connected' then 'connected' else 'disconnected' end
from provider_connections
where provider_type = 'social' and provider_name = 'zernio'
  and metadata->>'accountId' is not null
  and metadata->>'profileId' is not null
  and metadata->>'platform' is not null
  and metadata->>'platform' not in ('whatsapp')
on conflict (account_id) do nothing;

-- ------------------------------------------------------------
-- C. Commentaires : pipeline identique aux messages + premier commentaire
-- ------------------------------------------------------------
alter table social_comments add column if not exists author_external_id text;
alter table social_comments add column if not exists is_own boolean not null default false;
alter table social_comments add column if not exists needs_human boolean not null default false;
alter table social_comments add column if not exists handoff_reason text;
alter table social_comments add column if not exists auto_reply_intent text;
alter table social_comments add column if not exists reply_sender text check (reply_sender in ('ai', 'human'));
alter table social_comments add column if not exists auto_reply_error text;
create index if not exists idx_social_comments_needs_human
  on social_comments(organization_id, created_at desc) where needs_human;

alter table social_posts add column if not exists first_comment text;

create table if not exists social_first_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  social_post_id uuid not null references social_posts(id) on delete cascade,
  platform text not null,
  account_id text not null,
  content text not null,
  status text not null default 'pending' check (status in ('pending', 'posted', 'failed', 'skipped')),
  attempts integer not null default 0,
  error_message text,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (social_post_id, account_id)
);
alter table social_first_comments enable row level security;
drop policy if exists "members can read first comments of their org" on social_first_comments;
create policy "members can read first comments of their org"
  on social_first_comments for select
  using (is_member_of_org(organization_id));

-- ------------------------------------------------------------
-- D. Diffusions vers des contacts
-- ------------------------------------------------------------
-- Notes sur les prospects (Discover) — texte libre par contact.
alter table contacts add column if not exists notes text;
alter table contacts add column if not exists broadcast_opt_out boolean not null default false;
alter table contacts add column if not exists broadcast_opt_out_at timestamptz;

create table if not exists contact_broadcasts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  content text not null,
  image_url text,
  product_id uuid references products(id) on delete set null,
  channels text[] not null default '{}',
  audience jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'processing', 'completed', 'partial', 'failed', 'cancelled')),
  total_recipients integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_count integer not null default 0,
  created_by uuid references auth.users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_contact_broadcasts_due on contact_broadcasts(status, scheduled_at);
create index if not exists idx_contact_broadcasts_org on contact_broadcasts(organization_id, created_at desc);
drop trigger if exists trg_contact_broadcasts_updated_at on contact_broadcasts;
create trigger trg_contact_broadcasts_updated_at
  before update on contact_broadcasts
  for each row execute function set_updated_at();
alter table contact_broadcasts enable row level security;
drop policy if exists "members can access contact broadcasts of their org" on contact_broadcasts;
create policy "members can access contact broadcasts of their org"
  on contact_broadcasts for all
  using (is_member_of_org(organization_id))
  with check (is_member_of_org(organization_id));

create table if not exists contact_broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  broadcast_id uuid not null references contact_broadcasts(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  channel text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (broadcast_id, contact_id)
);
create index if not exists idx_contact_broadcast_recipients_pending
  on contact_broadcast_recipients(broadcast_id, status);
alter table contact_broadcast_recipients enable row level security;
drop policy if exists "members can read broadcast recipients of their org" on contact_broadcast_recipients;
create policy "members can read broadcast recipients of their org"
  on contact_broadcast_recipients for select
  using (is_member_of_org(organization_id));

-- ------------------------------------------------------------
-- E. Vidéos du catalogue : conservation par plan
-- `storage_class` = ce que Zernio a RÉELLEMENT confirmé à l'upload
-- (clé hors `temp/` = stockage permanent). `expires_at` reste la date
-- de fin de conservation (plan) pour un stockage permanent, ou +7 jours
-- pour un stockage temporaire.
-- ------------------------------------------------------------
alter table catalog_videos add column if not exists storage_class text not null default 'temporary'
  check (storage_class in ('temporary', 'permanent'));
alter table catalog_videos add column if not exists retention_days integer;
alter table catalog_videos add column if not exists purged_at timestamptz;
create index if not exists idx_catalog_videos_expiry on catalog_videos(expires_at) where purged_at is null;
