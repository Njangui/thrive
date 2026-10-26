-- 0191 — Décisions Q16/Q20 : un événement de paiement « failed » doit être REJOUÉ (3 essais), puis alerter.
-- Avant : l'événement restait `failed` et la livraison suivante du même événement était ignorée comme doublon,
-- si bien qu'un paiement réel pouvait n'être jamais pris en compte.
alter table webhook_events add column if not exists attempts integer not null default 1 check (attempts >= 0);
alter table webhook_events add column if not exists last_attempt_at timestamptz;
alter table webhook_events drop constraint if exists webhook_events_status_check;
alter table webhook_events add constraint webhook_events_status_check
  check (status in ('received', 'processed', 'failed', 'ignored_duplicate', 'dead'));
-- `dead` : 3 essais épuisés, alerte envoyée, intervention humaine (le paiement reste rattrapable par la réconciliation).
create index if not exists idx_webhook_events_failed on webhook_events(provider, received_at) where status = 'failed';
