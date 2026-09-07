# Rapport de fusion #3 — Lot G

Troisième vague, sur la base du projet précédemment fusionné (Lots B à I,
voir `RAPPORT_FUSION.md` et `RAPPORT_FUSION_2.md`). Avec ce lot, **la
vague F-J planifiée dans `GAP_ANALYSIS_V2.md` est complète à l'exception
du Lot J** (tests d'isolation réels, seed démo, consolidation doc).

## 1. Vérifications finales

- `npm run typecheck` → **0 erreur**
- `npm test` → **227/227** (26 fichiers) — 195 pré-existants + 32 ajoutés
  par ce lot, exactement comme annoncé dans `RAPPORT_LOT_G.md`
- `npm run lint` → **0 warning**
- `npm run build` → **succès, code de sortie 0**, 33 routes générées, y
  compris toutes celles ajoutées par ce lot (`/admin/addons`,
  `/dashboard/addons`, `/api/webhooks/notchpay`, sections étendues de
  `/admin/domains`/`/dashboard/subscription`/`/dashboard/site`) — même
  contournement temporaire et sans conséquence du fetch réseau
  `next/font` que pour les vagues précédentes, annulé immédiatement après
  vérification.

## 2. Point de départ : ce lot avait un statut différent des précédents

Le Lot G a été développé "directement intégré au dépôt fusionné" (accès
réseau réel, `npm run` exécutés pour de vrai chez eux) — mais **sur la
base d'avant ma passe d'optimisation, et avant la fusion des Lots F/H/I**
(confirmé par les mêmes marqueurs de vérification que pour la vague
précédente : absence de `subscriptionByOrg`, `OPTIMISATION`, `seoTitle`,
`onboarding_step`, `PAGE_SIZE`, `MESSAGES_PAGE_SIZE` dans leurs copies de
ces fichiers). Une bonne partie des "différences" détectées dans un
premier diff complet n'étaient donc, encore une fois, que des copies
obsolètes plutôt que de vrais changements — vérifiées une par une avant
toute copie, avec la même méthode que la vague précédente.

## 3. Cinq vraies collisions, résolues manuellement

### `src/application/services/entitlements-service.ts` + `.test.ts` (Lot F + Lot G)

Lot F filtrait déjà `countOrganizationRows` par statut actif (ex:
`whatsapp_groups.status = 'connected'` uniquement compte contre le
quota). Lot G ajoutait le bonus add-ons (limite du plan + somme des
add-ons actifs). Les deux mécanismes ne se chevauchaient pas — fusionnés
directement dans `canUseFeature()`. Le fichier de test a nécessité un
vrai merge (pas une simple concaténation) : le test Lot G de la clé
`whatsapp_groups` attendait un appel à `countOrganizationRows` SANS le
filtre `["connected"]` de Lot F — ce test précis n'a pas été repris tel
quel (aurait échoué contre le code fusionné), les 6 nouveaux tests
spécifiques au bonus add-ons de Lot G (non concernés par ce filtre) ont
été ajoutés à la suite des tests déjà fusionnés.

### `src/application/services/plans-repository.ts` (Lot F + Lot G)

Lot F ajoutait `countOrganizationRows`. Lot G rendait la durée d'essai de
`createTrialSubscription()` configurable (`platform_settings.trial_days`
au lieu de `14` en dur). Aucun chevauchement de fonction — fusion
directe. Le call site dans `onboarding-service.ts` (qui passait encore
`14` en dur, ce qui aurait silencieusement annulé le réglage Super Admin
du Lot G) a été corrigé en conséquence.

### `src/application/services/admin-organizations-service.ts` (mon optimisation + Lot G)

Les deux avaient indépendamment généralisé `writeAdminAuditLog()` de la
même façon (`organizationId` nullable, `entityId` optionnel) — pure
coïncidence de conception, pas un vrai désaccord. Gardé ma logique de
requêtes batch (l'optimisation N+1), adopté le typage légèrement plus
précis du Lot G (`entityId?: string | null` plutôt que `string |
undefined`, avec sa remarque utile sur le typage `uuid` d'`entity_id`).

### `src/app/dashboard/site/page.tsx` (Lot H + Lot G)

Lot H ajoutait les champs SEO (titre/description/image de partage). Lot
G ajoutait une section "Domaine personnalisé" (demande de domaine
manuelle). Deux sections indépendantes du même formulaire — fusionnées
sans arbitrage.

### `src/app/dashboard/layout.tsx` + `src/app/admin/layout.tsx` (déjà F+H+I fusionnés + Lot G)

Un seul lien de navigation ajouté à chacun ("Add-ons" côté tenant et côté
Super Admin) — aucun conflit réel avec les ajouts déjà fusionnés des
lots précédents.

## 4. Fusions mineures (additions non chevauchantes)

`.env.example`, `src/lib/env.ts` (correctif `PAYMENT_PROVIDER_DEFAULT`
`cinetpay` → `notchpay` — l'ancienne valeur par défaut aurait fait
échouer `getPaymentProvider()` en silence, + `NOTCHPAY_WEBHOOK_SECRET`),
`docs/DATABASE.md`, `docs/DEPLOYMENT.md` (nouvelle section 3bis, webhook
NotchPay).

## 5. Contenu réel du lot (au-delà du rapport individuel, lire aussi `RAPPORT_LOT_G.md` et `docs/PAYMENT_INTEGRATION.md`)

- **Paiement d'abonnement (NotchPay)** — adapter complet, webhook
  toujours re-vérifié via l'API avant tout crédit (jamais de confiance
  aveugle au corps reçu). Paiement récurrent réel et remboursement via
  API : **NOT_SUPPORTED** (vérifié, pas deviné) — un tenant qui oublie de
  renouveler repasse simplement à échu, sans relance automatique pour
  l'instant.
- **Add-ons** — catalogue Super Admin (`/admin/addons`), achat tenant
  (`/dashboard/addons`), réutilise le même flow de paiement que
  l'abonnement.
- **Domaines** — aucun registrar avec API self-service couvrant le `.cm`
  trouvé dans le délai imparti (OpenProvider et EuroDNS évalués et
  documentés comme candidats futurs). En attendant : demande manuelle
  (`domain_requests`), jamais un faux achat automatique.

## 6. Ce qui reste

- **Lot J** (tests d'isolation multi-tenant réels, tests de limites,
  seed démo "Mode Élégance", consolidation finale de la documentation) —
  dernier lot de la vague F-J, toujours attendu.
