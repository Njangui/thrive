-- ============================================================
-- 0182_c5_track_whatsapp_click.sql
-- C5 — `track()` : nouvel événement `whatsapp_click` (clic vers WhatsApp depuis
-- la vitrine). La contrainte CHECK doit être recréée EN ENTIER (même piège que
-- 0060) : sans cela, trackEvent échoue silencieusement à chaque insertion.
-- Les 9 types existants sont conservés tels quels.
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
  'video_play',
  'whatsapp_click'
));

-- Lecture des commandes par statut/date (analyses C5 : ventes, marges, ruptures, clients inactifs).
create index if not exists idx_orders_org_status_created on orders(organization_id, status, created_at desc);
create index if not exists idx_order_items_product on order_items(product_id);
