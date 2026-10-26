-- ============================================================
-- 0144_c3_comment_assistant.sql
-- C3 (assistant client) — commentaires publics (livrable G).
--
-- * comment_assistant_settings : réglages par entreprise. Tout ce qui engage le
--   commerçant ou crée une donnée personnelle est DÉSACTIVÉ par défaut (création de
--   prospects, masquage du spam, réponse publique aux plaintes, remerciements).
-- * social_comments : état de modération, produit retrouvé via la publication,
--   prospect créé.
-- * contacts : un commentateur n'a pas de numéro ; index unique sur sa clé sociale
--   pour ne jamais créer deux fois le même contact.
--
-- Données personnelles (loi n° 2024/017) : un prospect créé depuis un commentaire ne
-- contient que le nom public du commentateur et sa clé de plateforme — jamais le texte
-- du commentaire ni de numéro. Fonction désactivée par défaut (opt-in par entreprise).
-- ============================================================

create table if not exists public.comment_assistant_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  use_post_product boolean not null default true,
  invite_to_dm boolean not null default true,
  create_leads boolean not null default false,
  hide_spam boolean not null default false,
  complaint_public_ack boolean not null default false,
  reply_to_praise boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_comment_assistant_settings_updated_at
  before update on public.comment_assistant_settings
  for each row execute function set_updated_at();

alter table public.comment_assistant_settings enable row level security;

create policy "owner/admin can manage comment assistant settings"
  on public.comment_assistant_settings for all
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'))
  with check (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));

-- ------------------------------------------------------------
-- Commentaires : modération, produit de la publication, prospect
-- ------------------------------------------------------------
alter table public.social_comments
  add column if not exists moderation_status text not null default 'clean'
    check (moderation_status in ('clean', 'spam_suspected', 'spam', 'spam_hidden')),
  add column if not exists product_id uuid references public.products(id) on delete set null,
  add column if not exists lead_id uuid references public.leads(id) on delete set null;

create index if not exists idx_social_comments_moderation
  on public.social_comments (organization_id, moderation_status)
  where moderation_status <> 'clean';

-- ------------------------------------------------------------
-- Contacts issus des réseaux sociaux : une seule fiche par commentateur et par compte.
-- ------------------------------------------------------------
create unique index if not exists idx_contacts_social_key
  on public.contacts (organization_id, (metadata ->> 'social_key'))
  where metadata ? 'social_key';
