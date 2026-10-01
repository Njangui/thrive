-- ============================================================
-- 0075_freemium_v3_domain_video_tiktok.sql
--
-- Lot P — ajustements demandés après le lot O :
--   A. Domaine personnalisé retiré des forfaits (service à la demande,
--      hors forfait, ouvert à TOUS les plans — voir /dashboard/domain).
--   B. Badge « propulsé par Flexco » : visible sur Discover SEULEMENT
--      (retirable dès Starter — inverse du lot O, qui le réservait à Pro).
--   C. Réponse automatique aux commentaires TikTok activée en Pro (Zernio
--      le permet pour les comptes API Business — voir PLAN_LOT_P.md §0.2).
--   D. Vidéos : conservation 7/30/90 jours honorée par RENOUVELLEMENT
--      périodique vers Zernio (seul hébergeur — aucun stockage permanent
--      vérifié chez eux, voir PLAN_LOT_P.md §0.1).
--   E. Paiement des demandes de domaine : statut suivi manuellement.
--   F. Comptes sociaux : drapeau « reconnexion requise » (TikTok, lot P).
--
-- Idempotente comme les précédentes migrations de ce dépôt.
-- NB fusion : numérotée 0075 (0067 était déjà prise par freemium_v2, 0074 par
-- repair_plan_entitlements_grid, qui réinsère custom_domain — d'où le delete en A
-- DOIT passer APRÈS elle).
-- ============================================================

-- ------------------------------------------------------------
-- A. Domaine personnalisé : retiré des forfaits
-- ------------------------------------------------------------
delete from plan_entitlements where entitlement_key = 'custom_domain';

-- ------------------------------------------------------------
-- B. Badge Flexco : visible sur Discover seulement
-- ------------------------------------------------------------
insert into plan_entitlements (plan_key, entitlement_key, limit_value) values
  ('free',    'remove_branding', 0),
  ('starter', 'remove_branding', 1),
  ('pro',     'remove_branding', 1)
on conflict (plan_key, entitlement_key) do update set limit_value = excluded.limit_value;

-- ------------------------------------------------------------
-- C. TikTok : réponse automatique aux commentaires activée en Pro
-- ------------------------------------------------------------
insert into plan_entitlements (plan_key, entitlement_key, limit_value) values
  ('free',    'tiktok_auto_comments', 0),
  ('starter', 'tiktok_auto_comments', 0),
  ('pro',     'tiktok_auto_comments', 1)
on conflict (plan_key, entitlement_key) do update set limit_value = excluded.limit_value;

-- ------------------------------------------------------------
-- D. Vidéos : conservation 7/30/90 jours HONORÉE SANS QUITTER ZERNIO.
--
-- Décision explicite (après le premier jet de ce lot, revenue en arrière) :
-- les vidéos restent hébergées chez Zernio, quelle que soit la contrainte.
-- Zernio ne fournit AUCUN stockage permanent vérifié (doc + SDK + changelog
-- — voir PLAN_LOT_P.md §0.1) : chaque fichier y vit 7 jours, point final.
-- Pour honorer la promesse 7/30/90 jours de l'offre malgré cette limite, un
-- CRON retéléverse périodiquement le fichier vers un nouveau presign Zernio
-- AVANT l'expiration des 7 jours (`host_expires_at`), jusqu'à la date
-- promise par l'offre (`expires_at`, fixée à l'envoi d'origine, jamais
-- reculée). Voir catalog-video-service.ts::renewExpiringZernioVideos.
--
-- `storage_class`/`permanent`/`storage_provider` (tentatives précédentes de
-- ce lot) sont abandonnés : un seul hébergeur (Zernio), pas de distinction
-- à faire. Pas de quota de VOLUME non plus (`video_storage_mb`) : Zernio
-- porte le coût de stockage, pas nous — seule la durée (video_retention_days,
-- lot O, inchangée) différencie les offres.
-- ------------------------------------------------------------
alter table catalog_videos add column if not exists host_expires_at timestamptz;
alter table catalog_videos add column if not exists renewal_error text;
alter table catalog_videos add column if not exists notified_expiry_soon boolean not null default false;
alter table catalog_videos drop column if exists storage_class;
alter table catalog_videos drop column if exists storage_provider;

-- Vidéos déjà enregistrées (si une base a été seedée avec le premier jet de
-- ce lot) : `host_expires_at` inconnu → traité comme "à renouveler dès que
-- possible" par le cron plutôt que de risquer une expiration silencieuse.
update catalog_videos set host_expires_at = uploaded_at where host_expires_at is null;
alter table catalog_videos alter column host_expires_at set not null;

create index if not exists idx_catalog_videos_renew
  on catalog_videos(host_expires_at) where expires_at > now();
create index if not exists idx_catalog_videos_notify
  on catalog_videos(notified_expiry_soon, expires_at);

-- ------------------------------------------------------------
-- E. domain_requests : paiement suivi manuellement (encaissement hors
-- application — Mobile Money, espèces… — décision D2 du lot P). Impossible
-- de marquer une demande "registered" sans "paid" (admin-domains-service.ts).
-- ------------------------------------------------------------
alter table domain_requests add column if not exists payment_status text not null default 'unpaid'
  check (payment_status in ('unpaid', 'paid'));

-- ------------------------------------------------------------
-- F. social_accounts : reconnexion requise (TikTok, détection automatique
-- d'une erreur de permission — voir comment-auto-reply-service.ts).
-- ------------------------------------------------------------
alter table social_accounts add column if not exists needs_reconnect boolean not null default false;
