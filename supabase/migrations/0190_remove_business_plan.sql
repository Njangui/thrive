-- 0190 — Décision Q8 : le plan « business » n'existe ni dans le code ni dans l'offre (prix 19 900 < Pro 30 000).
-- Les abonnements ont déjà été ramenés à « starter » (0061) ; on réaligne par sécurité, puis on supprime
-- le plan et ses lignes de droits/prix — sauf s'il est encore référencé par un paiement historique
-- (on ne réécrit jamais l'historique de facturation : la ligne reste alors, invisible car absente de PLAN_KEYS).
update organization_subscriptions set plan_key = 'starter' where plan_key = 'business';
delete from plan_entitlements where plan_key = 'business';
delete from plan_prices where plan_key = 'business';
delete from plans p
where p.key = 'business'
  and not exists (select 1 from subscription_payments sp where sp.plan_key = 'business')
  and not exists (select 1 from organization_subscriptions os where os.plan_key = 'business');

-- Décision Q18 : la recharge de portefeuille n'est reliée à rien → code retiré ; on retire aussi la fonction
-- SQL qui créditait le portefeuille depuis un paiement (surface d'attaque inutile). Elle sera réécrite le jour où une recharge existera.
drop function if exists public.wallet_topup_settle(text, text);
