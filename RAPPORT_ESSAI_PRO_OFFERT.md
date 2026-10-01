# Essai Pro offert — 14 jours, pour tout le monde

## Comportement
- Tout compte (gratuit, Starter, **et nouveaux inscrits pendant la période**) a le forfait Pro jusqu'à une **date de fin fixe** commune = lancement + 14 jours.
- À la date de fin, tout s'arrête **tout seul** : le plan effectif est calculé par comparaison de dates (`plans-repository.ts::getOrganizationPlanKey`). Aucune donnée client n'est modifiée, aucun cron n'est nécessaire pour couper l'accès, les abonnés Pro payants ne sont jamais touchés.
- Fail-closed : si le réglage est illisible ou mal formé, personne n'a Pro (retour au vrai plan).
- Notifications aux non-Pro : **J-3** puis **jour de la fin** (une seule fois chacune), envoyées par le cron `process-subscription-renewals` déjà planifié (1–4 h).
- Crédits IA : le bonus Pro est ajouté pendant l'essai (`promo_bonus_credits`, migration 0073) et retiré exactement à la fin (lazy à la 1re lecture + balayage par le cron). Les crédits déjà consommés restent comptés.
- Bandeau « Essai Pro offert… jusqu'au <date> (N jours restants) » dans le dashboard (masqué pour les Pro payants).

## Lancer
1. Appliquer la migration `supabase/migrations/0073_promo_trial_ai_credit_bonus.sql`.
2. Vérifier que le cron `/api/cron/process-subscription-renewals` tourne (1–4 h) — voir `docs/DEPLOYMENT.md`.
3. Console Super Admin → **Essai Pro offert** → « Lancer l'essai Pro maintenant (14 jours) ». Bouton « Arrêter maintenant » disponible (raccourcit la fenêtre). Actions tracées dans `audit_logs`.

## Fichiers
- Nouveaux : `promo-trial-core.ts` (lecture, phases, cache 30 s), `promo-trial-service.ts` (lancer/arrêter, notifications, balayage), `admin/promo/page.tsx`, `dashboard/_components/promo-trial-banner.tsx`, migration 0073, 3 fichiers de tests (19 tests).
- Modifiés : `plans-repository.ts` (+ `getOrganizationRealPlanKey`), `ai-credits-service.ts` (+ `syncPromoCredits`), cron route, `dashboard/layout.tsx`, `admin/_components/sidebar.tsx`, `ai-credits-service.test.ts` (mocks).

## À savoir
- Ce qui a été créé pendant l'essai est **conservé** ; ce qui dépasse les limites du plan réel n'est simplement plus utilisable/modifiable après la fin.
- Comptes actifs (WhatsApp, Telegram, etc.) connectés pendant l'essai au-delà des limites du plan réel : aucune déconnexion automatique n'est faite (choix volontaire, sans risque de perte de données) — à surveiller à la fin.
- Les statistiques admin (« abonnés », revenus) continuent d'utiliser le plan **réel** : l'essai ne fausse pas les chiffres.
- Vérifs : `tsc` 0 erreur, `eslint` 0 erreur, vitest 1136 tests dont 2 échecs Fapshi déjà présents avant (voir RAPPORT_FUSION_27.md). Non testé en conditions réelles (`next build`, base de données, rendu visuel).

## Lancer / vérifier / arrêter directement en SQL (Supabase → SQL Editor)
Utile si la page admin n'est pas accessible. Nécessite que le code de cette version soit déployé.

```sql
-- Lancer maintenant, fin fixe dans 14 jours
insert into platform_settings (key, value)
values ('free_pro_promo', jsonb_build_object(
  'startsAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'endsAt',   to_char((now() + interval '14 days') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'reminderSentAt', null, 'endNoticeSentAt', null, 'creditsRevertedAt', null, 'stoppedAt', null))
on conflict (key) do update set value = excluded.value;

-- Vérifier l'état
select value from platform_settings where key = 'free_pro_promo';

-- Arrêter immédiatement
delete from platform_settings where key = 'free_pro_promo';
```

## Diagnostic « la page reste verrouillée »
- Le bandeau violet « Essai Pro offert » doit apparaître en haut de TOUTES les pages du dashboard tant que l'essai est actif. Absent = l'essai n'est pas actif ou la nouvelle version n'est pas déployée.
- Attendre jusqu'à 30 s après le lancement (cache mémoire par instance), puis recharger.
- Test automatisé de bout en bout : `promo-trial.e2e.test.ts` (verrou « Mon site » s'ouvre pendant l'essai, se referme à la fin).

## Correctifs et outils ajoutés après le retour « même les comptes payants sont verrouillés »
- **Migration `0074_repair_plan_entitlements_grid.sql`** : comble les lignes de limites manquantes (126 lignes de la grille actuelle), `on conflict do nothing` → n'écrase jamais une limite réglée dans Super Admin > Plans. Une ligne absente = « 0 » = verrouillé pour tous les plans, y compris Pro (cas typique : une clé ajoutée à une migration déjà appliquée en production).
- **Super Admin > Diagnostic d'accès** (`/admin/diagnostic`) : saisir le nom d'une entreprise → ligne d'abonnement, plan réel/effectif, état de l'essai, décision de l'application pour 6 fonctionnalités, limites lues en base, 5 derniers paiements. Alerte si la grille est incomplète.
- **Correctif crédits IA** : un changement de palier (paiement) pendant l'essai remet aussi `promo_bonus_credits` à 0 (sinon le bonus aurait été retiré une 2e fois à la fin). Repli si la migration 0073 n'est pas encore appliquée.

## Requêtes SQL de contrôle (Supabase → SQL Editor)
```sql
-- 1) La limite qui gouverne « Mon site » existe-t-elle pour chaque plan ? (attendu : free 0, starter 1, pro 1)
select plan_key, limit_value from plan_entitlements where entitlement_key = 'site_customization';

-- 2) Plan réel d'un compte (remplacer le nom)
select o.name, s.plan_key, s.status, s.current_period_end
from organizations o left join organization_subscriptions s on s.organization_id = o.id
where o.name ilike '%NOM%';

-- 3) Ses derniers paiements
select created_at, payment_type, plan_key, status, amount_fcfa
from subscription_payments sp join organizations o on o.id = sp.organization_id
where o.name ilike '%NOM%' order by created_at desc limit 5;
```

## Cause probable trouvée : utilisateur membre de plusieurs entreprises
`requireCurrentOrganization()` prenait toujours la 1re appartenance, **sans tri** et **sans sélecteur** (le layout le disait : « simplification volontaire »). Un utilisateur membre de plusieurs entreprises (ex. une gratuite de test + une payante) voyait une entreprise arbitraire, donc « Discover » même quand son entreprise payante était une autre.
- Tri déterministe des appartenances (plus ancienne d'abord).
- Choix mémorisé par cookie `flexco_active_org`, **validé contre les appartenances réelles** (un cookie vers une entreprise étrangère est ignoré — testé).
- Sélecteur « Entreprise » en haut du dashboard, affiché seulement si l'utilisateur a 2 entreprises ou plus.
- Même règle pour la page d'onboarding (évite une boucle dashboard ↔ onboarding) et la route des notifications.

## CAUSE RACINE CONFIRMÉE PAR L'AUDIT DE LA BASE (01/10/2026)
`limite_site_customization_du_plan_lu = null` pour **toutes** les entreprises, y compris les 3 Pro payantes → la limite `site_customization` n'existe pour **aucun plan** dans `plan_entitlements` (111 lignes au lieu de 135). Une clé connue sans ligne = 0 = verrouillé, pour tous les plans.
- 8 clés manquantes, exactement celles qui n'existent que dans la migration `0062` : `site_customization`, `scheduled_publications`, `immediate_publications`, `analytics`, `push_notifications`, `finance`, `prospect_notes`, `twitter_accounts` (24 lignes). La migration 0062 n'a jamais été appliquée en production (les descriptions de plans en base sont aussi celles de 0061).
- Le code, l'essai Pro (actif : 30/09 → 14/10) et le choix d'entreprise n'étaient PAS en cause.
- Réparation : migration `0074` (ou la requête ciblée `reparation-limites-manquantes.sql`). `on conflict do nothing` : la grille de production a été modifiée depuis l'admin (ex. gratuit = 300 crédits IA, alors que toutes les migrations disent 0) et n'est pas écrasée.
- Autre constat : soldes de crédits IA des comptes gratuits à 0 alors que la grille dit 300 (le solde est un instantané). Le bonus de l'essai Pro se calcule désormais contre le solde réel (amené au niveau Pro), retiré à la fin.
