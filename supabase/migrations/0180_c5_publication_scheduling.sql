-- ============================================================
-- 0180_c5_publication_scheduling.sql
-- C5 (Croissance) — étape 1 : annulation / reprogrammation honnêtes des
-- publications + réglage d'autonomie par tenant.
--
-- Rien n'est supprimé : une annulation laisse une trace (qui, quand).
-- Telegram est un canal DIRECT (telegram_publications, cron maison),
-- jamais Zernio : son annulation est un simple changement de statut.
-- ============================================================

-- 1. Une cible sociale peut désormais être « cancelled » (post annulé chez le
--    fournisseur). Avant : pending | published | failed seulement.
alter table social_post_targets drop constraint if exists social_post_targets_status_check;
alter table social_post_targets
  add constraint social_post_targets_status_check
  check (status in ('pending', 'published', 'failed', 'cancelled'));

-- 2. Trace d'annulation + métadonnées générées (titre, hashtags, CTA...).
alter table social_posts
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists publication_meta jsonb not null default '{}'::jsonb;

alter table telegram_publications
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null;

comment on column social_posts.publication_meta is
  'C5 — métadonnées de publication (titre, hashtags, appel à l''action, '
  'variante A/B, origine proposée/ajoutée). Données applicatives, jamais un secret.';

-- 3. Réglages de croissance par tenant. `publication_autonomy` :
--    'propose' (défaut : l'agent propose, le propriétaire valide) ou 'add'
--    (l'agent ajoute directement). Une diffusion ou une pub reste « sensitive »
--    quel que soit ce réglage (moteur de règles C1).
create table if not exists growth_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  publication_autonomy text not null default 'propose'
    check (publication_autonomy in ('propose', 'add')),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_growth_settings_updated_at
  before update on growth_settings
  for each row execute function set_updated_at();

alter table growth_settings enable row level security;

create policy "members can read growth_settings of their org"
  on growth_settings for select
  using (is_member_of_org(organization_id));

-- Écriture réservée aux owner/admin (le propriétaire décide de l'autonomie).
create policy "owner/admin can insert growth_settings"
  on growth_settings for insert
  with check (current_org_role(organization_id) in ('owner', 'admin'));

create policy "owner/admin can update growth_settings"
  on growth_settings for update
  using (current_org_role(organization_id) in ('owner', 'admin'))
  with check (current_org_role(organization_id) in ('owner', 'admin'));

-- Index : listage des publications programmées par organisation.
create index if not exists idx_social_posts_org_status_sched
  on social_posts(organization_id, status, scheduled_for);
