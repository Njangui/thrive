-- ============================================================
-- 0072_fix_plan_prices_drift.sql
--
-- (renommée depuis 0071_fix_plan_prices_drift.sql lors de la fusion
-- tokoo ×THRIVE du 23/09/2026 — 0071 est désormais
-- ai_handoff_auto_resume, cf. son en-tête)
--
-- Lot 4 — diagnostic et correctif de dérive entre le prix par défaut
-- d'un plan et le prix réellement facturé par pays (plan_prices).
-- ============================================================

-- 1) Diagnostic : liste tout écart entre plans.price_fcfa (prix par
--    défaut, ce que montrent /dashboard/subscription et /tarifs) et la
--    ligne plan_prices active du pays (ce qui est réellement facturé
--    par initiatePayment() -> resolvePlanPriceForCountry()).
select
  pp.country_code,
  pp.plan_key,
  p.price_fcfa as prix_affiche_par_defaut,
  pp.amount    as prix_reellement_facture,
  pp.currency_code
from plan_prices pp
join plans p on p.key = pp.plan_key
where pp.is_active = true
  and pp.amount <> p.price_fcfa;

-- 2) Correctif : réaligne toutes les lignes plan_prices actives sur le
--    prix par défaut courant (même instruction que celle déjà présente
--    en fin de 0049_pricing_v2.sql et 0062_plan_limits_discover_starter_pro.sql,
--    simplement rejouée manuellement ici). Idempotent, sans risque à
--    relancer plusieurs fois.
update plan_prices pp
set amount = p.price_fcfa
from plans p
where pp.plan_key = p.key
  and pp.is_active = true
  and pp.amount <> p.price_fcfa;
