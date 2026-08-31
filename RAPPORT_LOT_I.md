# Rapport — Lot I : Commentaires sociaux, Push notifications, Onboarding reprenable

Contrairement aux Lots B-E (construits sur un snapshot séparé puis fusionnés
manuellement, voir `RAPPORT_FUSION.md`), ce lot a été construit **directement
dans le dépôt déjà fusionné** — pas de snapshot séparé, pas d'étape de fusion
supplémentaire à faire. Toutes les migrations, tous les fichiers modifiés
listés ci-dessous sont donc déjà dans leur état final.

**Différence notable de méthode** : `npm install` fonctionne dans cet
environnement (accès registry.npmjs.org disponible), ce qui n'était pas le
cas pour les lots précédents. `typecheck`, `test` et `lint` ont donc été
exécutés **réellement** contre le code, pas seulement raisonnés par lecture —
voir section 6.

## 1. Fichiers créés

**Push notifications (Partie 1)**
- `supabase/migrations/0024_push_subscriptions.sql`
- `src/application/services/push-service.ts` + `.test.ts` (10 tests)
- `src/app/api/push/resubscribe/route.ts`
- `src/app/dashboard/notifications/push-actions.ts`
- `src/app/dashboard/notifications/push-toggle.tsx`

**Onboarding reprenable (Partie 2)**
- `supabase/migrations/0025_onboarding_progress.sql`
- `src/application/services/onboarding-service.test.ts` (7 tests)

**Commentaires sociaux (Partie 3)**
- `supabase/migrations/0026_social_comments.sql`
- `src/application/services/social-comment-service.ts` + `.test.ts` (13 tests)
- `src/app/dashboard/comments/page.tsx`
- `src/app/dashboard/comments/comment-card.tsx`
- `src/app/dashboard/comments/comments-actions.ts`

## 2. Fichiers modifiés

- `src/lib/env.ts`, `.env.example` — variables `VAPID_PUBLIC_KEY`/
  `VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (optionnelles)
- `package.json` — ajout `web-push@3.6.7` (+ `@types/web-push` en dev)
- `src/application/services/notification-service.ts` — `sendPush` câblé en
  best-effort dans `notifyOrgAdmins` ; `buildRelatedEntityUrl` déplacé ici
  (exporté) pour être partagé avec `dashboard/notifications/page.tsx` au
  lieu d'exister en double
- `src/app/_components/service-worker-register.tsx` — étendu avec
  `subscribeToPush`/`unsubscribeFromPush`/`getExistingPushSubscription`
  (jamais auto-déclenchés)
- `public/sw.js` — étendu avec `push`, `notificationclick`,
  `pushsubscriptionchange` (le comportement `install`/`activate`/`fetch`
  existant n'a pas été touché)
- `src/app/dashboard/notifications/page.tsx` — toggle push affiché si
  configuré
- `src/application/services/onboarding-service.ts` — `updateOnboardingStep`,
  `markOnboardingComplete`, `getOnboardingStatus` ; `createOrganization`
  initialise `onboarding_step: 1`
- `src/app/onboarding/onboarding-actions.ts` — chaque étape (y compris
  "Passer pour plus tard") persiste sa progression en best-effort
- `src/app/onboarding/onboarding-wizard.tsx` — reprise à `initialStep`,
  bannière de reprise, marque l'onboarding terminé à l'étape 6
- `src/app/onboarding/page.tsx` — reprend l'onboarding au lieu de rediriger
  inconditionnellement vers `/dashboard`
- `src/app/dashboard/layout.tsx` — redirige vers `/onboarding` si non
  terminé ; lien nav "Commentaires" ajouté
- `src/domain/ports/social-publishing-provider.ts` — `SocialComment`,
  `listComments`/`replyToComment`/`hideComment`/`unhideComment`
- `src/infrastructure/providers/social/zernio/{types,client,adapter}.ts` —
  implémentation des 4 méthodes ci-dessus

## 3. Décisions et hypothèses prises

- **`service-worker-register.tsx` n'auto-déclenche jamais la demande de
  permission**, contrairement à une lecture littérale du cahier ("demander
  la permission après l'enregistrement du SW"). Ce composant est monté au
  niveau du layout racine, donc sur **toutes** les pages y compris la
  vitrine publique d'un tenant — auto-demander la permission y serait hors
  sujet (ce sont les admins du dashboard qui reçoivent des notifications,
  jamais un visiteur anonyme) et peu fiable techniquement (la plupart des
  navigateurs ignorent une demande de permission non déclenchée par un vrai
  geste utilisateur). La demande de permission est désormais déclenchée par
  le clic sur le toggle dans `/dashboard/notifications` — qui reste "un
  simple toggle", conforme à la lettre du cahier.
- **`pushsubscriptionchange` + route `/api/push/resubscribe`** : au-delà du
  strict minimum demandé, pour une implémentation réellement complète (un
  navigateur peut faire tourner l'endpoint d'une souscription existante).
  Sécurisé par cookie de session — la route ne fait jamais confiance à un
  `organizationId` fourni par l'appelant, elle retrouve la ligne à partir
  de l'ancien endpoint + l'utilisateur authentifié.
- **Backfill de migration critique** (`0025_onboarding_progress.sql`) :
  sans lui, `dashboard/layout.tsx` aurait redirigé **toutes** les
  organisations déjà existantes vers `/onboarding` au premier déploiement
  (elles ont toutes `onboarding_completed_at = null` par défaut). La
  migration marque rétroactivement `onboarding_completed_at = created_at`
  pour toute organisation déjà présente — seules les organisations créées
  après ce lot démarrent réellement à `null`. Repéré et corrigé pendant la
  construction, pas dans le cahier.
- **"Passer pour plus tard" persiste désormais la progression** (via
  `advanceOnboardingStep`, fire-and-forget) — le cahier ne le précisait pas
  explicitement, mais sans ça la reprise après un skip renverrait à une
  étape déjà quittée, ce qui viole l'esprit du critère d'acceptation
  ("jamais à l'étape 1", et plus largement jamais à une étape dépassée).
- **`onboarding_completed_at` est marqué dès que le wizard ATTEINT l'étape
  6** (via `useEffect`), pas seulement au clic sur "Aller à mon tableau de
  bord" — sinon un utilisateur qui ferme l'onglet à l'écran final resterait
  indéfiniment redirigé vers `/onboarding` par `dashboard/layout.tsx`.
- **Masquer/afficher un commentaire** ajouté au-delà du strict "lecture +
  réponse" du cahier — capacité réellement confirmée (SDKs officiels
  Zernio), limitée à Facebook/Instagram/Threads, dérivée de la plateforme
  plutôt que stockée en base (`commentHidingSupportedOnPlatform`, pure,
  sans risque de désynchronisation).
- **Pas de synchronisation temps réel des commentaires** (webhook
  `comment.received` existe côté Zernio mais non exploité) — un pull
  explicite par bouton est suffisant pour le périmètre demandé et évite une
  route webhook supplémentaire, une vérification de signature dédiée et une
  UI d'abonnement, pour un besoin non exprimé dans le cahier.
- **Suggestion IA de réponse aux commentaires** : prompt dédié et minimal
  (nom de l'entreprise uniquement), plutôt que de réutiliser
  `buildTenantAIContext` (conçu pour l'assistant WhatsApp, avec des
  instructions de "transfert humain" qui n'ont pas de sens pour un
  brouillon de réponse à un commentaire). Consomme 1 crédit IA par
  suggestion générée (`reason: "social_comment_draft"`, visible dans
  `ai_usage_events`), jamais si les crédits sont épuisés (retourne `null`
  sans lever).
- **Toggle push reflète l'état RÉEL de l'appareil courant** (via
  `pushManager.getSubscription()`), pas une valeur déduite de la présence
  d'une ligne en base pour l'organisation — un commerçant peut être abonné
  sur son téléphone et pas sur son ordinateur ; le toggle doit refléter
  l'appareil sur lequel il se trouve, pas un état global.

## 4. Ce qui a été vérifié — réellement, pas seulement raisonné

- `npm run typecheck` : **0 erreur**
- `npm test` : **138 tests, tous passent** (125 pré-existants + 13
  nouveaux pour `social-comment-service.ts`, en plus des 10 pour
  `push-service.ts` et 7 pour `onboarding-service.ts` déjà comptés dans les
  125 — voir détail des nouveaux tests dans chaque fichier `.test.ts`)
- `npm run lint` : **0 warning, 0 erreur**
- `npm run build` (Next.js) : a échoué, mais **uniquement** parce que
  `next/font/google` tente de télécharger les polices Google Fonts au
  build, et `fonts.googleapis.com` n'est pas sur la liste blanche réseau de
  cet environnement de vérification (limitation du bac à sable, pas du
  code). `typecheck`/`test`/`lint` couvrent l'essentiel de ce qu'un build
  réel vérifierait en plus (résolution des imports, types des Server
  Actions/routes) ; le build complet reste à confirmer une fois déployé
  avec un accès réseau normal.

## 5. Limites connues restantes

- **`DELETE .../hide` (démasquer un commentaire)** : le placement exact
  d'`accountId` (query string vs corps) est **inféré par symétrie** avec
  `hide`, faute d'exemple officiel documenté pour ce cas précis — à
  vérifier contre un compte de test réel avant mise en production (voir
  `docs/ZERNIO_INTEGRATION.md`).
- **Pas de préférences de notification granulaires** (par type d'événement)
  — un canal push activé reçoit tout ce que `notifyOrgAdmins` envoie déjà,
  cohérent avec le comportement in-app existant (aucune granularité non
  plus).
- **`sendTestPush` à l'activation du toggle est best-effort silencieux** —
  si elle échoue (ex: VAPID mal configuré au runtime malgré la présence des
  variables), l'activation reste un succès (la souscription est bien
  enregistrée) mais sans confirmation visuelle immédiate.
- **Commentaires LinkedIn** : non disponibles pour un compte LinkedIn
  personnel connecté (limite de la plateforme LinkedIn elle-même via
  Zernio, pas de SME-OS) — un compte "page d'entreprise" est requis.

## 6. Migrations à appliquer

Dans l'ordre, après les migrations 0001-0023 déjà en place :
`0024_push_subscriptions.sql`, `0025_onboarding_progress.sql`,
`0026_social_comments.sql`. La migration 0025 contient un `UPDATE` de
rétrocompatibilité (voir section 3) — à exécuter avant toute mise en
production pour éviter de bloquer les tenants existants.

## 7. Variables d'environnement à configurer (optionnelles)

`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (générer avec
`npx web-push generate-vapid-keys`) — en leur absence, le canal push reste
silencieusement désactivé (toggle masqué, `sendPush` no-op), aucune erreur.
