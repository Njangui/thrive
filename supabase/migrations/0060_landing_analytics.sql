-- ============================================================
-- 0060_landing_analytics.sql
-- Analytique de la landing / vitrine (sept. 2026).
--
-- 1. Nouveau type d'événement `video_play` (première lecture d'une vidéo du
--    catalogue sur la vitrine — voir catalog_videos, 0059).
-- 2. Les événements `page_view` portent désormais des métadonnées
--    (path, source, appareil, pays, visiteur haché, entrée de session) —
--    aucune colonne à ajouter : `metadata` est déjà un JSONB. Les anciens
--    `page_view` (sans `path`) restent valides et sont lus comme « / ».
--
-- La contrainte CHECK d'origine (0023) liste les types autorisés : elle doit
-- être recréée pour accepter `video_play`, sans quoi tout INSERT échouerait
-- (silencieusement — trackEvent ne lève jamais).
-- ============================================================
alter table analytics_events drop constraint if exists analytics_events_event_type_check;

alter table analytics_events add constraint analytics_events_event_type_check check (event_type in (
  'page_view',
  'product_view',
  'product_click',
  'cta_click',
  'lead_created',
  'conversation_started',
  'order_created',
  'publication_published',
  'video_play'
));

-- La page d'analytique lit toutes les lignes d'une organisation sur une
-- période, tous types confondus.
create index if not exists idx_analytics_events_org_date on analytics_events(organization_id, created_at desc);
