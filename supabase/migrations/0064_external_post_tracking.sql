-- ============================================================
-- 0064_external_post_tracking.sql
-- Lot 5 (20/09/2026) — synchronisation temps réel des commentaires,
-- QUEL QUE SOIT l'endroit où le post a été publié (demande explicite :
-- "synchroniser les commentaires quel qu'en soit où je l'ai publié, et
-- automatiquement"). Jusqu'ici, `social_comments.social_post_id`
-- (0026_social_comments.sql) référence `social_posts(id)` en NOT NULL —
-- un post publié directement sur la plateforme (hors composer CRESYVA)
-- n'a AUCUNE ligne `social_posts` et ses commentaires étaient donc
-- impossibles à stocker, structurellement. Cette migration ne relâche
-- pas cette contrainte : elle permet à une ligne `social_posts` d'exister
-- pour un post que CRESYVA n'a pas publié lui-même, détecté par la
-- synchronisation arrière-plan de Zernio (webhook `post.external.*`,
-- CONFIRMÉ ~horaire, pas temps réel — voir docs/ZERNIO_INTEGRATION.md et
-- ZernioExternalPostWebhookPost dans zernio/types.ts).
-- ============================================================

-- Distingue un post publié depuis CRESYVA ('app', comportement
-- historique — valeur par défaut pour ne rien changer aux lignes
-- existantes) d'un post détecté nativement sur la plateforme ('external').
-- `content`/`media_urls` restent donc "not null"/'{}' par défaut pour un
-- post 'external' : leur contenu réel n'est volontairement PAS rapatrié
-- ici (voir le commentaire en tête de ZernioExternalPostWebhookPost —
-- champs non confirmés au niveau du webhook), seul le nécessaire pour
-- rendre le post "syncable" (bouton manuel + commentaires temps réel).
alter table social_posts add column source text not null default 'app'
  check (source in ('app', 'external'));

comment on column social_posts.source is
  'Lot 5 : ''app'' = publié via le composer CRESYVA (comportement '
  'historique). ''external'' = détecté nativement sur la plateforme par '
  'la synchronisation arrière-plan Zernio (post.external.created), '
  'contenu volontairement non rapatrié (voir zernio/types.ts).';

-- Upsert idempotent keyé sur (organization_id, provider_post_id) —
-- nécessaire pour que trackExternalPost() (social-post-tracking-service.ts)
-- et le filet de sécurité de handleIncomingComment() ne dupliquent jamais
-- la même ligne sur des events rejoués ou concurrents. Index PARTIEL
-- (pas une contrainte de table) : un post encore 'draft'/'scheduled' a
-- `provider_post_id` NULL, et ne doit jamais entrer en collision avec un
-- autre brouillon — Postgres traiterait déjà des NULL comme distincts
-- dans une contrainte unique standard, mais le `where` rend cette
-- intention explicite plutôt que de compter sur ce comportement implicite.
create unique index idx_social_posts_org_provider_post_id_unique
  on social_posts(organization_id, provider_post_id)
  where provider_post_id is not null;
