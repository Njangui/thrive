# SME-OS AUDIT — Lot 1 : Architecture + Sécurité + DB + Stock + Multi-tenant

Base auditée : `sme-os-fusionne-lot-K-L-M-N.zip` (Lots B→N fusionnés, Lot O
restant). Ce rapport couvre le périmètre demandé — pas les 106 sections du
master prompt (IA, WhatsApp, marketing, finance, etc. restent hors de ce
lot).

```text
Architecture:
████████░░ 80%   — cohérente (hexagonale, providers derrière abstraction,
                    aucune duplication de logique trouvée en dehors du
                    bug stock corrigé ci-dessous), mais 2 docs
                    significativement obsolètes (voir Missing/Broken)

Sécurité:
████████░░ 85%   — RLS complète et vérifiée (56/56 tables), auth chain
                    respectée sur 25/25 server actions, secrets jamais
                    exposés au client, credentials par tenant déjà
                    résolus (Lot N). Corrigé ce lot : fail-safe cron
                    production.

DB / migrations:
████████░░ 80%   — 33 migrations, schéma cohérent, RLS partout, aucune
                    incohérence de contrainte trouvée. Corrigé ce lot :
                    absence de transaction atomique commande/stock.

Multi-tenant:
█████████░ 90%   — organization_id vérifié systématiquement dans le code
                    applicatif ET en RLS (double barrière, conforme au
                    cahier). Le vrai test d'isolation "Tenant A ne lit
                    pas Tenant B" nécessite une DB Postgres réelle,
                    indisponible dans cet environnement (voir section
                    Limitation ci-dessous) — compensé par un test
                    statique qui vérifie structurellement chaque
                    politique RLS.

Stock:
█████████░ 90%   — logique métier correcte (transitions de statut),
                    corrigé ce lot : race condition réelle sous appels
                    concurrents.
```

## P0 — corrigés dans ce lot

1. **Race condition réelle sur commande/stock** (`order-service.ts::markOrderCompleted`,
   `catalog-service.ts::decrementStock`) — décrément de stock en
   lecture-puis-écriture séparée, complétion de commande en plusieurs
   appels Supabase non atomiques. Deux appels concurrents pouvaient
   provoquer un double décrément de stock et un double revenu.
   → Migration `0038_atomic_order_stock_transaction.sql` : deux fonctions
   SQL (`adjust_product_stock`, `complete_order_transaction`),
   verrouillage de ligne (`FOR UPDATE`), réservées `service_role`.
   `order-service.ts` et `catalog-service.ts` réécrits pour les utiliser.
2. **Routes cron sans fail-safe production** (`process-broadcasts`,
   `process-subscription-renewals`) — en l'absence de `CRON_SECRET`, les
   routes restaient exécutables sans authentification, avec un simple
   `console.warn`. → Helper partagé `src/lib/cron-auth.ts` : refuse
   (503) en production si le secret manque, avertit et continue hors
   production (dev/démo).

## P1 — trouvés, non corrigés dans ce lot (hors périmètre "Architecture/Sécurité/DB/Stock/Multi-tenant" ou nécessitant un lot dédié)

1. `docs/MVP_SCOPE.md` sévèrement obsolète — liste comme "hors MVP / non
   implémenté" des fonctionnalités qui existent réellement dans ce
   dépôt fusionné (groupes WhatsApp, paiement NotchPay, rendez-vous
   avec écran dashboard). Risque réel : une session future pourrait
   relire ce document et tenter de reconstruire l'existant (section 99
   du master prompt). Nécessite un audit fonctionnalité-par-fonctionnalité
   complet (section 82) pour être réécrit correctement — au-delà du
   périmètre de ce lot, mais à traiter en priorité avant toute nouvelle
   fonctionnalité.
2. `restockProduct` (`catalog-service.ts`) n'a aucun appelant — le
   workflow de réapprovisionnement manuel (section 18 du master prompt)
   a un backend prêt (et maintenant atomique) mais aucune UI dashboard.
3. `scripts/seed-demo.ts`, référencé par `npm run seed:demo`
   (`package.json`), est absent du dépôt — script cassé.

## Missing

- UI de réapprovisionnement manuel de stock (voir P1.2).
- Documentation figée par lot (`docs/MVP_SCOPE.md`) jamais remise à jour
  au fil des fusions successives.

## Broken

- `npm run seed:demo` (fichier manquant).

## Partial

- Aucune régression multi-tenant structurelle trouvée, mais la garantie
  reste **statique** (analyse des migrations), pas un test d'intégration
  contre une vraie DB avec RLS active — voir Limitation ci-dessous.

## Confirmé sain (vérifié, pas supposé)

- **RLS** : les 56 tables créées ont toutes `enable row level security` ;
  chaque table avec au moins une politique a une politique tenant-safe
  (`organization_id`/`is_member_of_org`/`is_platform_admin`/`auth.uid()`) ;
  les seules politiques `using (true)` concernent 4 tables de référence
  publiques légitimes (`plans`, `plan_entitlements`, `addons`,
  `domain_tld_pricing`) ; les 4 tables sans aucune politique
  (`platform_admins`, `platform_settings`, `webhook_events`,
  `phone_numbers`) sont toutes des tables service-role-only volontaires.
  Vérifié par script exécuté directement (pas seulement écrit), puis
  figé dans `tests/rls-policies.test.ts` pour empêcher toute régression
  future.
- **Auth chain sur les server actions** : 25/25 fichiers `"use server"`
  appellent `requireMembership`/`requireCurrentOrganization`/
  `requirePlatformAdmin`, à l'exception de 2 actions publiques
  (`track-click-action.ts`, `booking-actions.ts`) — vérifiées
  manuellement : écritures non privilégiées (analytics best-effort,
  demande de RDV en attente de confirmation), documentées comme
  volontairement publiques, RLS empêchant de toute façon toute écriture
  anon directe hors de ces routes serveur.
- **Credentials par tenant** : `docs/SECURITY.md` affirmait que la
  résolution per-tenant des clés Zernio/IA restait à construire — FAUX,
  déjà fait (Lot N, `0037_tenant_credentials.sql`, Supabase Vault,
  `secrets-resolver.ts::resolveCredential`, utilisée par les 3
  providers dans `registry.ts`). Doc corrigée.
- Aucune duplication de type `service-v2.ts`/`-final.ts`/`-helper.ts`
  trouvée (section 100/101).
- `CRON_SECRET` correctement documenté dans `.env.example`.

## FICHIERS MODIFIÉS/CRÉÉS

1. `supabase/migrations/0038_atomic_order_stock_transaction.sql` *(nouveau)*
   Fonctions SQL atomiques `adjust_product_stock`/`complete_order_transaction`.

2. `src/application/services/order-service.ts`
   `markOrderCompleted` réécrite pour appeler `complete_order_transaction`.

3. `src/application/services/order-service.test.ts`
   Nouveaux tests : appel RPC correct, idempotence, effets de bord
   rupture de stock, gestion d'erreur.

4. `src/application/services/catalog-service.ts`
   `decrementStock`/`restockProduct` réécrites pour appeler
   `adjust_product_stock` (plus de read-then-write en mémoire).

5. `src/application/services/catalog-service.test.ts`
   Nouveaux tests pour `decrementStock`/`restockProduct`.

6. `src/lib/cron-auth.ts` *(nouveau)*
   Helper partagé `checkCronAuth` — fail-safe production.

7. `src/lib/cron-auth.test.ts` *(nouveau)*
   6 tests couvrant les 3 comportements (secret valide/invalide,
   fail-safe prod, tolérance hors prod).

8. `src/app/api/cron/process-broadcasts/route.ts`
   Utilise `checkCronAuth`.

9. `src/app/api/cron/process-subscription-renewals/route.ts`
   Utilise `checkCronAuth`.

10. `tests/rls-policies.test.ts` *(nouveau)*
    Filet statique de non-régression multi-tenant (voir ci-dessus).

11. `docs/SECURITY.md`
    Correction du paragraphe obsolète sur les credentials par tenant.

12. `docs/DATABASE.md`
    Ajout des migrations `0035`-`0038` manquantes à la table, note sur
    le risque de collision de numérotation avec le Lot O.

## TESTS

```text
Typecheck: NON EXÉCUTÉ (voir Limitation d'environnement)
Lint:      NON EXÉCUTÉ (voir Limitation d'environnement)
Tests:     NON EXÉCUTÉ (voir Limitation d'environnement) — 17 nouveaux
           tests écrits et tracés manuellement contre l'implémentation
           réelle (6 order-service, 6 catalog-service, 6 cron-auth) +
           6 assertions dans tests/rls-policies.test.ts, dont la LOGIQUE
           a été exécutée directement en Node (pas seulement en vitest)
           pour confirmer un résultat vide sur ce dépôt réel avant
           d'écrire le fichier de test définitif.
Build:     NON EXÉCUTÉ (voir Limitation d'environnement)
```

### Limitation d'environnement (a lire avant de faire confiance à ce lot)

Ce bac à sable n'a pas d'accès réseau (`npm install` échoue : `403
Forbidden` sur `registry.npmjs.org`, aucun `node_modules` ni cache
préexistant, confirmé par test direct). Il est donc impossible d'exécuter
`npm run typecheck`/`test`/`lint`/`build` ici.

Compensé par, dans l'ordre de rigueur croissante :
- Vérification manuelle du schéma RÉEL (pas supposé) de chaque table
  touchée par la migration SQL — `orders`, `order_items`, `products`,
  `inventory_movements`, `revenues` — colonne par colonne, contre les
  migrations sources, avant d'écrire la moindre ligne de PL/pgSQL.
- Traçage manuel de chaque nouveau test vitest contre l'implémentation
  réelle, valeur par valeur (pas écrit puis supposé correct).
- Le script `tests/rls-policies.test.ts` a été VALIDÉ en l'exécutant
  d'abord tel quel via `node` directement sur le vrai dossier de
  migrations (pas juste écrit en confiance) — sortie confirmée : `0`
  table sans RLS, `0` politique `using(true)` hors allowlist, `0` table
  tenant sans politique tenant-safe.
- Vérification grossière d'équilibrage accolades/parenthèses sur tous
  les fichiers modifiés (filet minimal, pas un substitut à `tsc`).

**Action requise avant merge, côté porteur du projet** : exécuter
`npm run typecheck && npm run test && npm run lint && npm run build`
avec accès réseau. Je m'y attends à ce que ça passe compte tenu de la
rigueur de vérification ci-dessus, mais je ne peux pas le confirmer avec
la certitude d'un lot où la commande a réellement tourné.

## RISQUES PRODUCTION RESTANTS

1. **Aucun test d'intégration réel contre Postgres** pour l'isolation
   tenant ni pour la concurrence (2 commandes simultanées sur stock=1).
   Le verrouillage `FOR UPDATE` est correct sur le papier (pattern
   Postgres standard), mais seul un test contre une vraie instance
   (ou Supabase local) peut le confirmer sous charge réelle.
2. **Collision de numérotation de migration possible** : ce Lot 1 (audit
   indépendant, hors séquence K-O) a pris `0038`, déjà réservé au Lot O
   par `00_CONVENTIONS_COMMUNES_V3.md`. À résoudre avant application si
   Lot O produit lui aussi une migration.
3. `docs/MVP_SCOPE.md` obsolète (voir P1.1) — risque de re-travail
   inutile sur une fonctionnalité déjà construite si un futur lot s'y
   fie sans vérifier le code.

---

Prêt à enchaîner sur le prochain lot (préciser le périmètre — WhatsApp/
IA/marketing/finance/UI — pour que je fasse l'audit ciblé correspondant
avant de coder, même discipline que ce lot).
