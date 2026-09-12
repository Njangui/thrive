-- ============================================================
-- 0042_subscription_payments_currency.sql
-- Country Engine, partie 3 — subscription_payments.amount_fcfa
-- (0019_subscription_payments.sql) suppose implicitement le XAF pour
-- CHAQUE ligne, ce qui devient factuellement faux dès qu'une
-- organisation non-camerounaise paie dans une autre devise (ex: XOF,
-- GHS). Corrigé par l'ajout explicite de `currency_code`, plutôt qu'un
-- renommage risqué de `amount_fcfa` (colonne déjà référencée par de
-- nombreux appelants existants — subscription-payment-service.ts,
-- admin-organizations-service.ts, tests). Le nom historique est
-- documenté ci-dessous comme dette assumée, cohérent avec la
-- discipline déjà en place dans ce projet pour ce type d'écart (voir
-- ex: organization_addons.quantity dans 0036_recurring_billing.sql).
--
-- Backfill : toute ligne existante a été payée avant le Country Engine
-- (donc par une organisation camerounaise, en XAF) — 'XAF' est donc la
-- valeur correcte, pas une supposition risquée, cohérent avec le
-- backfill organizations.country_code = 'CM' de la migration
-- précédente (0041).
-- ============================================================

alter table subscription_payments
  add column currency_code text;

update subscription_payments
set currency_code = 'XAF'
where currency_code is null;

alter table subscription_payments
  alter column currency_code set not null,
  alter column currency_code set default 'XAF',
  add constraint subscription_payments_currency_code_format check (currency_code ~ '^[A-Z]{3}$');

comment on column subscription_payments.amount_fcfa is
  'DETTE ASSUMÉE : nom historique de l''ère mono-devise (XAF/FCFA '
  'uniquement). Depuis le Country Engine (0042), cette colonne contient '
  'le montant dans la plus petite unité de `currency_code` — PAS '
  'nécessairement du XAF. Un renommage complet casserait tous les '
  'appelants existants pour un bénéfice cosmétique ; documenté ici '
  'plutôt que renommé, comme organization_addons.quantity '
  '(0036_recurring_billing.sql) le fait déjà pour un écart analogue. '
  'Toujours lire ce montant avec `currency_code`, jamais en isolation.';
