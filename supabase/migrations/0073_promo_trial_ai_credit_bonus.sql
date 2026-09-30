-- Essai Pro offert (fenêtre datée globale, voir promo-trial-core.ts) :
-- le plan effectif passe à Pro par simple comparaison de dates, sans toucher
-- aux lignes d'abonnement. Seuls les crédits IA sont un SNAPSHOT en base
-- (`ai_credit_balances.included_credits`) : pour que Pro donne aussi ses
-- crédits pendant l'essai, on ajoute la différence (Pro − plan réel) et on
-- la mémorise ici, afin de pouvoir la retirer exactement à la fin.
alter table ai_credit_balances
  add column if not exists promo_bonus_credits integer not null default 0
  check (promo_bonus_credits >= 0);

comment on column ai_credit_balances.promo_bonus_credits is
  'Crédits IA accordés temporairement par l''essai Pro offert (déjà inclus dans included_credits) ; retirés à la fin de l''essai.';
