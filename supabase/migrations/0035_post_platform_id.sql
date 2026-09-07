-- ============================================================
-- 0035_post_platform_id.sql
-- Lot M, Partie 2 — synchronisation des résultats de publication.
--
-- `social_post_targets.platform_post_url` existait déjà (Lot D/0010).
-- CONFIRMÉ (docs.zernio.com — pages "Facebook API"/"Threads API", champ
-- `platforms[].platformPostId` de la ressource `post`, voir
-- infrastructure/providers/messaging/zernio/types.ts) : Zernio renvoie
-- aussi un identifiant natif par plateforme (`platformPostId`), distinct
-- de l'URL publique — utile pour tout futur appel qui aurait besoin de
-- l'id natif (ex: suppression manuelle côté plateforme, support client),
-- jamais utilisé pour construire l'URL nous-mêmes (on garde l'URL
-- fournie telle quelle, jamais reconstruite).
-- ============================================================

alter table social_post_targets add column platform_post_id text;
