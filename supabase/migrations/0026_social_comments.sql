-- Lot I, Partie 3 (commentaires sociaux). CONFIRMÉ (docs.zernio.com,
-- "Comments API", consulté le 31 août 2026) : lecture (GET
-- /v1/inbox/comments/{postId}?accountId=...) et réponse (POST
-- /v1/inbox/comments/{postId}) sont supportées sur Facebook, Instagram,
-- YouTube, LinkedIn, Threads, X/Twitter, Reddit, Bluesky — voir
-- docs/ZERNIO_INTEGRATION.md pour le détail du verdict et des limites
-- par plateforme. `platform` + `provider_account_id` dupliqués depuis
-- social_post_targets (plutôt qu'un JOIN systématique) : un commentaire
-- reste rattaché à son compte/plateforme d'origine même si la ligne
-- social_post_targets correspondante est supprimée un jour.
create table social_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  social_post_id uuid not null references social_posts(id) on delete cascade,
  platform text not null,
  provider_account_id text not null,
  -- Id du commentaire côté Zernio/plateforme — unique par (post, compte),
  -- jamais globalement unique (deux plateformes peuvent en théorie
  -- produire le même id brut).
  external_comment_id text not null,
  author_name text,
  content text not null,
  status text not null default 'new' check (status in ('new', 'replied', 'hidden')),
  reply_content text,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  unique (social_post_id, provider_account_id, external_comment_id)
);

create index idx_social_comments_org on social_comments(organization_id);
create index idx_social_comments_post on social_comments(social_post_id);
create index idx_social_comments_status on social_comments(organization_id, status);

alter table social_comments enable row level security;

create policy "members can access social_comments of their org" on social_comments for all
  using (is_member_of_org(organization_id));
