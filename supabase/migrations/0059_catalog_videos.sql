-- ============================================================
-- 0059_catalog_videos.sql
-- Vidéos du catalogue (sept. 2026).
--
-- Contexte : le système ne gérait volontairement aucune vidéo. L'ajout de
-- YouTube, TikTok, Instagram, Facebook et Telegram comme canaux de
-- publication rend la vidéo nécessaire. Les fichiers sont hébergés chez
-- ZERNIO (URL présignée `POST /v1/media/presign`), pas dans Supabase
-- Storage : le bucket `tenant-media` est plafonné à 5 Mo et les fonctions
-- Vercel refusent tout corps de requête > 4,5 Mo — une vidéo ne peut ni
-- s'y stocker ni y transiter.
--
-- CONTRAINTE STRUCTURANTE : Zernio ne conserve ces fichiers que 7 jours
-- (stockage temporaire, préfixe `temp/`). `expires_at` matérialise cette
-- échéance pour que :
--   1. le back-office l'affiche (compte à rebours, badge « expirée ») ;
--   2. la programmation d'une publication vidéo au-delà de l'échéance soit
--      REFUSÉE côté serveur (catalog-video-service.ts) ;
--   3. la vitrine (fiche produit, page d'accueil) n'affiche jamais un
--      lecteur pointant vers un fichier déjà supprimé.
--
-- Une vidéo peut être rattachée à un produit, à un service, ou à aucun des
-- deux (vidéo générale de la boutique) — jamais aux deux à la fois.
-- ============================================================
create table catalog_videos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  service_id uuid references services(id) on delete cascade,
  title text,
  -- URL publique renvoyée par Zernio (`publicUrl`, hôte media.zernio.com).
  url text not null,
  -- Clé de l'objet chez Zernio (`key`), conservée pour le diagnostic.
  storage_key text,
  content_type text not null,
  size_bytes bigint,
  uploaded_at timestamptz not null default now(),
  -- uploaded_at + 7 jours (voir VIDEO_RETENTION_DAYS, catalog-video-service.ts).
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint catalog_videos_single_target check (product_id is null or service_id is null),
  constraint catalog_videos_url_https check (url like 'https://%')
);

create index idx_catalog_videos_org_expiry on catalog_videos(organization_id, expires_at desc);
create index idx_catalog_videos_product on catalog_videos(product_id) where product_id is not null;
create index idx_catalog_videos_service on catalog_videos(service_id) where service_id is not null;
create index idx_catalog_videos_url on catalog_videos(organization_id, url);

alter table catalog_videos enable row level security;

create policy "members can access catalog_videos of their org" on catalog_videos for all
  using (is_member_of_org(organization_id));
