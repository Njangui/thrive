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
