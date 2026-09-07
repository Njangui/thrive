-- ============================================================
-- 0010_marketing_social_publishing.sql
-- Phase 15/16 doc 2 — Publications sociales via Zernio.
-- Statuts alignés section 51 : DRAFT/SCHEDULED/PUBLISHED/FAILED/
-- CANCELLED/PAUSED.
-- ============================================================

create table social_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_social_campaigns_updated_at
  before update on social_campaigns
  for each row execute function set_updated_at();

create index idx_social_campaigns_org on social_campaigns(organization_id);

create table social_posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  campaign_id uuid references social_campaigns(id) on delete set null,
  -- Section 30 : un produit peut avoir plusieurs publications (PRODUCT 1---N POST).
  product_id uuid references products(id),
  service_id uuid references services(id),
  content text not null,
  media_urls text[] not null default '{}',
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'published', 'failed', 'partial', 'cancelled', 'paused')),
  scheduled_for timestamptz,
  timezone text default 'Africa/Douala',
  -- Id du post côté Zernio (`post._id`, confirmé docs.zernio.com) —
  -- nécessaire pour getPostStatus/cancelPost et pour router les webhooks
  -- post.* vers la bonne ligne.
  provider_post_id text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_social_posts_updated_at
  before update on social_posts
  for each row execute function set_updated_at();

create index idx_social_posts_org on social_posts(organization_id);
create index idx_social_posts_provider_post_id on social_posts(provider_post_id);
create index idx_social_posts_campaign on social_posts(campaign_id);

comment on column social_posts.status is
  'Section 52 : si le produit lié passe OUT_OF_STOCK et que le post est '
  'encore scheduled, il doit pouvoir passer à paused (logique applicative, '
  'pas de trigger DB — voir marketing-service.ts). Jamais de suppression '
  'd''un post déjà published (historique conservé, section 10/52).';

-- Résultat par plateforme (un post peut cibler plusieurs comptes/réseaux,
-- section 29 : "Facebook / Instagram / TikTok" pour un même post).
create table social_post_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  post_id uuid not null references social_posts(id) on delete cascade,
  platform text not null,
  provider_account_id text not null,
  status text not null default 'pending' check (status in ('pending', 'published', 'failed')),
  platform_post_url text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_social_post_targets_updated_at
  before update on social_post_targets
  for each row execute function set_updated_at();

create index idx_social_post_targets_post on social_post_targets(post_id);

alter table social_campaigns enable row level security;
alter table social_posts enable row level security;
alter table social_post_targets enable row level security;

-- provider_connections.provider_type doit accepter 'social' (section 31 doc 2).
alter table provider_connections drop constraint provider_connections_provider_type_check;
alter table provider_connections add constraint provider_connections_provider_type_check
  check (provider_type in ('messaging', 'ai', 'payment', 'storage', 'notification', 'social'));

create policy "members can access social_campaigns of their org" on social_campaigns for all
  using (is_member_of_org(organization_id));
create policy "members can access social_posts of their org" on social_posts for all
  using (is_member_of_org(organization_id));
create policy "members can access social_post_targets of their org" on social_post_targets for all
  using (is_member_of_org(organization_id));
