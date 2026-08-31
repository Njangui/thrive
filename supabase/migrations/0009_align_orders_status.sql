-- ============================================================
-- 0009_align_orders_status.sql
-- Doc 2 section 24 : statuts PENDING/CONFIRMED/COMPLETED/CANCELLED,
-- plus simples que le PENDING/CONFIRMED/PROCESSING/READY/DELIVERED/
-- CANCELLED posé sous le doc 1. Table `orders` encore vide à ce stade
-- (aucun seed exécuté) — migration sans risque de perte de données.
--
-- On profite de ce changement pour passer de l'ENUM Postgres (pénible à
-- faire évoluer) à un CHECK constraint sur `text`, plus simple à amender
-- dans une future migration si le besoin business change encore.
-- ============================================================

alter table orders alter column status drop default;
alter table orders alter column status type text using status::text;
alter table orders add constraint orders_status_check
  check (status in ('pending', 'confirmed', 'completed', 'cancelled'));
alter table orders alter column status set default 'pending';

drop type order_status;

comment on column orders.status is
  'Section 24 doc 2 : PENDING -> CONFIRMED -> COMPLETED, ou CANCELLED. '
  'Le passage à COMPLETED déclenche décrément de stock + entrée revenues '
  '(voir application/services/order-service.ts), en couche application, '
  'pas via trigger DB, pour rester explicite et testable.';
