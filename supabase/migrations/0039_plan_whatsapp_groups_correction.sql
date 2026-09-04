-- ============================================================
-- 0039_plan_whatsapp_groups_correction.sql (renommée 0038→0039 à la
-- fusion : collision avec 0038_atomic_order_stock_transaction.sql d'un
-- autre lot indépendant — voir RAPPORT_FUSION_6.md)
-- Lot 4 — Super Admin + abonnements + domaines + polish.
--
-- Contexte : 0012_plans_entitlements.sql documentait explicitement ses
-- valeurs `whatsapp_groups` comme des PLACEHOLDERS ("chiffres
-- illustration raisonnables, PAS les chiffres officiels"), faute d'accès
-- au master prompt produit au moment du Lot B. Ce master prompt est
-- maintenant disponible (section 55 "PLANS COMMERCIAUX") et donne des
-- chiffres explicites :
--   Starter  : 2 groupes de base, +1 avec un numéro dédié.
--   Business : 5 groupes de base, +3 avec un numéro dédié.
--   Pro      : 10 groupes de base, +5 avec un numéro dédié.
--
-- Ne modifie PAS 0012 (déjà appliquée) — nouvelle migration, comme
-- l'exige le master prompt section 68 ("NE PAS modifier arbitrairement
-- une ancienne migration déjà appliquée en production").
--
-- Deux effets :
--  1. UPDATE des 3 lignes `plan_entitlements` existantes pour la clé
--     'whatsapp_groups' (les lignes existent déjà, seule la valeur
--     change — aucune donnée supprimée).
--  2. INSERT d'une nouvelle clé d'entitlement 'whatsapp_groups_dedicated_bonus'
--     (+1/+3/+5), consommée par entitlements-service.ts::canUseFeature()
--     UNIQUEMENT quand l'organisation a un numéro de téléphone dédié
--     assigné (phone_numbers.status = 'assigned', voir
--     admin-numbers-service.ts::assignPhoneNumberToOrganization). Clé
--     d'entitlement séparée plutôt qu'une constante en dur dans le code :
--     reste éditable depuis /admin/plans comme le reste de la grille,
--     sans migration supplémentaire si les chiffres commerciaux changent.
--     Valeur par défaut si la clé est absente (tenant/plan non seedé) :
--     traitée comme 0 par entitlements-service.ts, jamais comme
--     "illimité" (-1 n'a pas de sens pour un bonus additif).
-- ============================================================

update plan_entitlements set limit_value = 2  where plan_key = 'starter'  and entitlement_key = 'whatsapp_groups';
update plan_entitlements set limit_value = 5  where plan_key = 'business' and entitlement_key = 'whatsapp_groups';
update plan_entitlements set limit_value = 10 where plan_key = 'pro'      and entitlement_key = 'whatsapp_groups';

insert into plan_entitlements (plan_key, entitlement_key, limit_value) values
  ('starter',  'whatsapp_groups_dedicated_bonus', 1),
  ('business', 'whatsapp_groups_dedicated_bonus', 3),
  ('pro',      'whatsapp_groups_dedicated_bonus', 5)
on conflict (plan_key, entitlement_key) do update set limit_value = excluded.limit_value;

comment on table plan_entitlements is
  'Lot B : source de vérité unique des limites par plan. Ne JAMAIS coder '
  'un "if plan === ..." dispersé ailleurs dans le code — tout passe par '
  'canUseFeature() (application/services/entitlements-service.ts). '
  'Lot 4 : les clés suffixées ''_dedicated_bonus'' sont des bonus '
  'additifs conditionnels (numéro dédié assigné), pas des limites — '
  'absence de ligne = 0, jamais -1/illimité (voir entitlements-service.ts).';
