-- ============================================================
-- 0052_affiliate_promo_codes.sql
-- Code promo à l'inscription (alternative au lien de suivi cliqué) :
-- réutilise `affiliate_links.code` tel quel (un affilié n'a rien de
-- nouveau à créer/gérer, son code sert aux deux usages), mais avec une
-- économie DIFFÉRENTE de l'attribution par cookie — décision produit :
--   - lien cliqué (cookie)   : commission plein taux, 0% remise client
--   - code promo tapé        : commission réduite, remise sur le 1er paiement
-- Voir docs/AFFILIATE_SYSTEM.md pour le flux complet, et
-- domain/entities/affiliate.ts pour le calcul (computeDiscountedAmountFcfa).
-- ============================================================

-- ------------------------------------------------------------
-- Nouvelle méthode d'attribution. La contrainte existante (0044) n'était
-- pas nommée explicitement -> nom auto-généré par Postgres
-- (`{table}_{colonne}_check`), qu'on doit donc DROP avant de la recréer.
-- ------------------------------------------------------------
alter table affiliate_referrals
  drop constraint affiliate_referrals_attribution_method_check;

alter table affiliate_referrals
  add constraint affiliate_referrals_attribution_method_check
  check (attribution_method in ('cookie', 'manual', 'promo_code'));

-- ------------------------------------------------------------
-- Réglages plateforme (même table générique platform_settings,
-- 0020_addons.sql — même discipline que affiliate_commission_rate_bps) :
-- ⚠️ VALEURS PLACEHOLDER, ajustables depuis /admin/affiliates/settings
-- sans migration, comme le reste du programme.
--
-- affiliate_promo_code_commission_rate_bps : commission affilié quand
--   l'attribution vient d'un CODE PROMO tapé (pas d'un lien cliqué) —
--   1000 = 10%, distinct de affiliate_commission_rate_bps (défaut 20%).
-- affiliate_promo_code_discount_bps : remise accordée au CLIENT sur son
--   tout premier paiement d'abonnement quand il s'est inscrit avec un
--   code promo — 1000 = 10%. N'existe que pour ce canal : un lien cliqué
--   ne donne aucune remise (seule l'attribution change).
-- ------------------------------------------------------------
insert into platform_settings (key, value) values
  ('affiliate_promo_code_commission_rate_bps', '1000'::jsonb),
  ('affiliate_promo_code_discount_bps', '1000'::jsonb)
on conflict (key) do nothing;
