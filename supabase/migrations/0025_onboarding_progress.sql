-- Lot I, Partie 2 (onboarding reprenable). `onboarding_step` : 0 = jamais
-- commencé (valeur par défaut pour compat descendante), 1..6 = étape du
-- wizard atteinte (voir onboarding-wizard.tsx, TOTAL_STEPS = 6).
-- `onboarding_completed_at` : null tant que l'étape 6 n'a pas été atteinte.
alter table organizations add column onboarding_step integer not null default 0;
alter table organizations add column onboarding_completed_at timestamptz;

-- RÉTROCOMPATIBILITÉ CRITIQUE (00_CONVENTIONS_COMMUNES_V2.md : "ne jamais
-- modifier destructivement le schéma existant sans expliquer pourquoi
-- c'est sûr") : dashboard/layout.tsx va désormais rediriger vers
-- /onboarding tout utilisateur dont l'organisation a
-- onboarding_completed_at = null. Sans ce backfill, TOUTES les
-- organisations créées avant ce lot (déjà pleinement opérationnelles en
-- production) se retrouveraient soudainement bloquées devant un wizard
-- qu'elles n'ont jamais commencé — une vraie régression, pas une
-- amélioration. On les marque donc comme "onboarding terminé" au moment
-- de la migration ; seules les organisations créées APRÈS ce lot
-- démarrent réellement avec onboarding_completed_at = null (voir
-- onboarding-service.ts::createOrganization).
update organizations
set onboarding_completed_at = coalesce(onboarding_completed_at, created_at),
    onboarding_step = 6
where onboarding_completed_at is null;
