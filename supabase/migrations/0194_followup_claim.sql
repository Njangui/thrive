-- 0194_followup_claim.sql
-- Audit R2 : une relance est réservée (pending -> processing) avant l'envoi, pour qu'aucune
-- double exécution du cron n'envoie deux fois le même message.
alter table automated_followups add column if not exists claimed_at timestamptz;
alter table automated_followups drop constraint if exists automated_followups_status_check;
alter table automated_followups
  add constraint automated_followups_status_check
  check (status in ('pending', 'processing', 'sent', 'skipped', 'failed'));
