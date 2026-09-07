# Rapport — Lot 4 : Super Admin + abonnements + domaines + polish + tests + build

## ⚠️ Avertissement d'environnement (à lire avant tout le reste)

Contrairement aux lots précédents (G, K-O : "développé et vérifié directement contre le projet... accès réseau réel"), **cette session tourne dans un bac à sable sans accès réseau et sans `node_modules`** (l'archive livrée n'en contient pas, `npm install` est refusé : `403`). Conséquence directe :

- `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` **n'ont PAS pu être exécutés**. Aucune de ces commandes n'a tourné, et ce rapport ne prétend pas le contraire.
- À la place : relecture manuelle exhaustive de chaque fichier touché, vérification d'équilibre accolades/parenthèses par script, et une passe `tsc --noEmit` en mode syntaxe seule (compilateur global de la sandbox, sans les types du projet — utile uniquement pour détecter des erreurs de syntaxe franches, pas une vraie vérification de types). Aucune erreur de syntaxe trouvée sur les fichiers listés en section 4, mais **ceci ne remplace pas un vrai `npm run typecheck && npm run lint && npm test && npm run build` avant mise en production.**
- Recommandation : faire tourner la suite de validation complète dans un environnement avec accès réseau (comme les lots précédents) avant de fusionner ce lot.

## 1. Ce qui a été fait

### Partie 1 — Super Admin : gestion des plans (section 54 du master prompt)

**Constat d'audit** : `plans` et `plan_entitlements` sont bien pilotés par la DB (aucune limite codée en dur côté frontend — conforme section 54), mais **rien ne les écrivait**. Le commentaire de tête de `0012_plans_entitlements.sql` documentait déjà explicitement ce renvoi : *"la gestion des plans se fait en service_role (Lot C / Super Admin, cf. cahier Lot B 'Hors scope')"* — jamais repris par le Lot C, qui n'a livré que la console elle-même (organisations, add-ons, canaux, domaines, numéros, logs). Confirmé par grep : aucun fichier applicatif n'appelait `.from("plans")`/`.from("plan_entitlements")` en écriture avant ce lot.

Ajouté :
- `admin-plans-service.ts` — seul point d'écriture pour ces deux tables. Réutilise le catalogue de clés d'entitlement d'`subscription-service.ts` (`USAGE_GAUGES`/`FEATURE_FLAGS`, désormais exportées) plutôt que d'en tenir une seconde liste qui pourrait diverger. Ne gère PAS la création/suppression de plans (3 clés fixées par le modèle commercial, section 55) — uniquement leurs attributs.
- `/admin/plans` — tarification (nom/prix/description) par plan, et grille éditable (une ligne = une clé × les 3 plans, un upsert par cellule pour un audit log précis).
- Chaque écriture passe par `writeAdminAuditLog` — les clés texte (`starter`/`business`/...) vivent dans `before_state`/`after_state`, jamais dans `entity_id` (colonne `uuid`, même convention que `upsertTldPricing`/`createAddon`).

### Partie 2 — Numéros dédiés : assignation + bonus (sections 55 et 62)

**Constat d'audit, deux écarts liés** :
1. L'assignation d'un numéro à une entreprise était explicitement hors périmètre du Lot C (commentaire d'origine dans `admin-numbers-service.ts`). `phone_numbers.organization_id` ne passait donc jamais de `null` — le bonus "numéro dédié" du master prompt (+1/+3/+5 groupes WhatsApp selon le plan, section 55) était inatteignable.
2. Les limites de base `whatsapp_groups` seedées en 0012 (3/10/illimité) ne correspondaient déjà pas aux chiffres du master prompt (2/5/10) — 0012 documentait elle-même ces valeurs comme des placeholders, faute d'accès à ce document à l'époque.

Ajouté :
- `assignPhoneNumberToOrganization` / `unassignPhoneNumber` (`admin-numbers-service.ts`) — refuse d'écraser l'assignation d'une AUTRE organisation, refuse un numéro suspendu, `NotFoundError` propre. `/admin/numbers` : sélecteur d'entreprise + bouton Assigner par numéro disponible, bouton Retirer par numéro assigné.
- `phone-number-repository.ts` (nouveau, minimal) — `hasDedicatedPhoneNumber(organizationId)`, lecture seule, ne lève jamais. Fichier séparé pour la même raison que `plans-repository.ts` l'est d'`entitlements-service.ts` : évite une dépendance "cœur métier → module admin".
- `entitlements-service.ts::canUseFeature()` — pour la clé `whatsapp_groups` uniquement, et seulement si le plan n'est pas déjà illimité : ajoute le bonus configuré (`whatsapp_groups_dedicated_bonus`, nouvelle clé d'entitlement, éditable depuis `/admin/plans`) si l'organisation a un numéro assigné. Garde explicite contre l'ambiguïté de `getEntitlementLimit` (-1 = illimité pour une LIMITE, mais n'a aucun sens pour un bonus additif → traité comme 0).
- `0038_plan_whatsapp_groups_correction.sql` — corrige les 3 limites de base + seed la nouvelle clé de bonus. Nouvelle migration (0012 déjà appliquée n'est pas modifiée), conforme section 68.

### Partie 3 — Super Admin : vue plateforme des paiements (section 52)

**Constat d'audit** : `listPaymentsForOrganization` n'existait qu'à l'échelle d'un tenant (dashboard `/dashboard/subscription`). Aucune vue d'ensemble plateforme — l'opérateur SME-OS n'avait aucun moyen de repérer un paiement bloqué ou de rapprocher le chiffre d'affaires confirmé tous tenants confondus.

Ajouté :
- `listAllPaymentsForAdmin` (`subscription-payment-service.ts`) — lecture seule, jointure `organizations(name)`. Aucune action d'écriture : les changements de statut restent exclusivement la responsabilité de `handlePaymentWebhook` (section 58 : "Ne jamais activer un abonnement uniquement sur la base du frontend").
- `/admin/payments` — total confirmé, compteurs en attente/échoués, table des paiements récents. Pas de BI (section 47).

### Partie 4 — Recherche/filtrage sur `/admin/organizations` (section 53)

Le cahier demande explicitement "recherche ; filtrage" pour cet écran ; ni l'un ni l'autre n'existait. Ajouté un filtre GET (nom/identifiant + statut) — formulaire simple, aucun JS client, cohérent avec le reste de la console (tout en Server Components/Server Actions).

### Partie 5 — Polish : tableaux illisibles sur mobile (sections 50, 75, 93)

**Constat d'audit** : `overflow-hidden` au lieu d'`overflow-x-auto` sur le conteneur de 11 tableaux (5 dans `/admin` : add-ons, canaux, domaines ×2, numéros ; 6 dans `/dashboard` : rendez-vous, finance, prospects, commandes, produits, abonnement). Sur un écran étroit, ça ne fait pas défiler le tableau — ça **coupe silencieusement les colonnes de droite**, les rendant inaccessibles. Seul `/admin/logs` avait le bon réglage. Corrigé les 11 occurrences (changement mécanique d'une classe CSS, aucun risque comportemental). Étendu au-delà du strict périmètre "Super Admin + abonnements + domaines" par cohérence — c'est le même bug répété partout, et le corriger partout est plus sûr que le corriger à moitié.

Navigation `/admin` : ajout des liens "Plans" et "Paiements", et passage en `flex-wrap` (7 liens ne tenaient déjà plus sur une seule ligne en dessous d'une largeur d'écran raisonnable).

## 2. Écarts assumés vs le cahier

1. **Pas de page `/admin/settings` dédiée** — section 52 la liste séparément des add-ons, mais `trial_days` (seul réglage plateforme correspondant identifié) vit déjà sensiblement sous `/admin/addons` depuis un lot précédent. Créer une page à un seul champ pour respecter la lettre de la liste sans gain fonctionnel réel n'a pas semblé justifié (section 104 : privilégier une fonctionnalité robuste plutôt que dupliquer une checklist).
2. **`listAllPaymentsForAdmin` non testé unitairement** — `subscription-payment-service.test.ts` utilise un mock Supabase *stateful* spécifiquement construit pour tester l'idempotence webhook (garde `.eq("status","pending")`), qui ne supporte pas nativement `.order()`/`.limit()`/jointure. Sa fonction sœur `listPaymentsForOrganization`, déjà en place avant ce lot, n'était elle-même pas testée pour la même raison. Étendre ce mock au risque de fragiliser les tests d'idempotence existants n'a pas semblé un bon rapport risque/valeur pour une fonction de lecture pure ; documenté ici plutôt que passé sous silence.
3. **Aucun test pour `addPhoneNumber`/`createAddon`/`upsertTldPricing` (préexistants)** — non modifiés par ce lot, laissés tels quels ; mentionné ici uniquement parce que `admin-plans-service.test.ts`/`admin-numbers-service.test.ts` (nouveaux) auraient pu laisser croire à une couverture totale de la couche admin. Elle reste partielle, par choix (voir section 3).
4. **`docs/GAP_ANALYSIS.md`/`docs/ROADMAP.md` non mis à jour** — déjà signalés obsolètes par `RAPPORT_FUSION_5.md` (leur consolidation fait partie du périmètre documenté du Lot O, pas de celui-ci). Les toucher partiellement sans audit complet aurait pu introduire des incohérences plutôt que d'en résoudre.

## 3. Fichiers modifiés / créés

**Nouveaux :**
- `src/application/services/admin-plans-service.ts`
- `src/application/services/admin-plans-service.test.ts`
- `src/application/services/phone-number-repository.ts`
- `src/application/services/admin-numbers-service.test.ts`
- `src/app/admin/plans/page.tsx`
- `src/app/admin/payments/page.tsx`
- `supabase/migrations/0038_plan_whatsapp_groups_correction.sql`
- `RAPPORT_LOT_4.md` (ce fichier)

**Modifiés :**
- `src/application/services/entitlements-service.ts` — bonus numéro dédié (Partie 2).
- `src/application/services/entitlements-service.test.ts` — mock de `phone-number-repository.ts` (nécessaire : sans lui, plusieurs tests `whatsapp_groups` préexistants auraient silencieusement appelé un vrai client Supabase) + 5 nouveaux cas.
- `src/application/services/admin-numbers-service.ts` — assignation/retrait (Partie 2).
- `src/application/services/subscription-service.ts` — export de `USAGE_GAUGES`/`FEATURE_FLAGS` (aucun changement de comportement).
- `src/application/services/subscription-payment-service.ts` — `listAllPaymentsForAdmin` (Partie 3).
- `src/app/admin/numbers/page.tsx` — UI d'assignation.
- `src/app/admin/organizations/page.tsx` — recherche/filtrage (Partie 4).
- `src/app/admin/layout.tsx` — nouveaux liens de nav + `flex-wrap`.
- Polish mobile (Partie 5, un seul changement de classe CSS par fichier) : `src/app/admin/addons/page.tsx`, `src/app/admin/channels/page.tsx`, `src/app/admin/domains/page.tsx`, `src/app/admin/numbers/page.tsx`, `src/app/dashboard/appointments/page.tsx`, `src/app/dashboard/finance/page.tsx`, `src/app/dashboard/leads/page.tsx`, `src/app/dashboard/orders/page.tsx`, `src/app/dashboard/products/page.tsx`, `src/app/dashboard/subscription/page.tsx`.

## 4. Migrations

- `0038_plan_whatsapp_groups_correction.sql` — UPDATE des 3 lignes `whatsapp_groups` existantes (2/5/10) + INSERT de la clé `whatsapp_groups_dedicated_bonus` (1/3/5). Additive, ne modifie pas 0012, aucune suppression de donnée.

## 5. Tests

- `entitlements-service.test.ts` : +5 cas (bonus appliqué avec numéro dédié ; jamais appliqué à une autre clé ; comportement inchangé sans numéro dédié ; jamais interrogé si le plan est déjà illimité ; -1 non configuré traité comme 0 et non comme illimité) + mock ajouté pour ne pas casser les cas `whatsapp_groups` déjà existants.
- `admin-numbers-service.test.ts` (nouveau, 8 cas) : assignation réussie + audit log, réassignation idempotente à la même organisation, refus si déjà assignée à une autre organisation, refus si suspendu, `NotFoundError` si le numéro n'existe pas, retrait réussi (l'audit log conserve l'organisation d'origine), refus de retirer un numéro déjà libre, `NotFoundError` au retrait.
- `admin-plans-service.test.ts` (nouveau, 12 cas) : valeurs par défaut de la grille (-1 pour une entitlement non configurée, 0 pour un bonus non configuré), valeurs réellement configurées reflétées fidèlement, toutes les gardes de validation de `updatePlanDetails`/`upsertPlanEntitlementLimit` (clé de plan invalide, nom vide, prix négatif, clé d'entitlement inconnue, valeur négative autre que -1, -1 accepté), écriture d'audit log avant/après pour les deux fonctions.

**Non exécutés** (voir avertissement en tête) — à faire tourner avant mise en production :
```
Typecheck: NON EXÉCUTÉ (pas de réseau/node_modules dans cette session)
Lint:      NON EXÉCUTÉ
Tests:     NON EXÉCUTÉS (25 nouveaux/modifiés dans ce lot, relus manuellement)
Build:     NON EXÉCUTÉ
```

## 6. Fonctionnalités restantes observées pendant l'audit (hors périmètre de ce lot)

**MVP, probablement à traiter dans un prochain lot :**
- Recherche/filtrage similaire sur `/admin/domains` et `/admin/channels` (même lacune que Partie 4, non traitée ailleurs que sur `/admin/organizations` faute de temps).
- `docs/GAP_ANALYSIS.md`/`docs/ROADMAP.md` toujours obsolètes (voir écart n°4) — periomètre déjà identifié comme celui du Lot O.

**Bloqué externe :**
- Rien identifié de nouveau dans le périmètre de ce lot — Domaines (OpenProvider) et Paiements (NotchPay) restent tels que documentés par les Lots G/N.

## 7. Risques production

1. **Suite de validation non exécutée dans cette session** (voir section 0) — risque principal, à lever avant tout déploiement.
2. **Migration 0038 modifie une limite déjà en usage** (`whatsapp_groups` : 3→2 pour Starter, 10→5 pour Business, illimité→10 pour Pro). Un tenant Business ayant déjà créé 8 groupes WhatsApp active un plan actuellement conforme, mais se retrouverait après cette migration au-dessus de sa nouvelle limite (8 > 5) — sans bonus numéro dédié. `canUseFeature()` bloque uniquement la CRÉATION d'un nouveau groupe au-delà de la limite (logique déjà existante, pas de suppression rétroactive de groupes) : aucune perte de données, mais un tel tenant ne pourra plus en créer de nouveaux tant qu'il n'aura pas un numéro dédié assigné ou un add-on. À vérifier contre la base réelle (nombre de tenants Business/Pro avec plus de 5/10 groupes actifs) avant d'appliquer 0038 en production.
3. **Assignation de numéro non réversible pour l'historique du bonus** — retirer un numéro (`unassignPhoneNumber`) retire immédiatement le bonus associé (recalcul dynamique par `canUseFeature()`, pas de valeur figée) ; un tenant en dépassement au moment du retrait ne peut plus créer de nouveau groupe tant qu'il n'a pas régularisé. Comportement jugé correct et conforme au cahier, mais à communiquer côté support si l'opérateur retire un numéro à une entreprise active.

## 8. Passe d'optimisation (suite à une demande explicite de relecture)

Trois changements, aucun de comportemental — uniquement latence et exactitude documentaire. Les 25 tests listés en section 5 couvrent déjà tous les chemins concernés et ont été retracés manuellement ligne par ligne contre le nouveau code (voir détail ci-dessous) ; aucun test n'a eu besoin d'être modifié.

1. **`entitlements-service.ts::canUseFeature()` — parallélisation des lectures indépendantes.** Avant cette passe, le chemin `whatsapp_groups` (plan non illimité + numéro dédié assigné) enchaînait jusqu'à 6 allers-retours DB strictement séquentiels : `planKey` → `planLimit` → bonus add-ons → (numéro dédié ? → bonus numéro dédié) → usage cumulatif. Or seules `planKey` puis `planLimit` ont une réelle dépendance d'ordre — les trois lectures suivantes (bonus add-ons, bonus numéro dédié, usage cumulatif) ne dépendent chacune que de `planLimit !== -1` (déjà connu), jamais du RÉSULTAT d'une autre. Regroupées dans un seul `Promise.all`, plus un retour anticipé explicite quand `planLimit === -1` (déjà le cas implicitement avant, rendu explicite). Pire cas : 6 → 4 allers-retours séquentiels. Fonction appelée à chaque vérification de droit (créer un groupe, lancer une diffusion...) — donc potentiellement très fréquente. Comportement, valeurs de retour et ordre d'appel de `getEntitlementLimit` (déterminant pour les assertions `toHaveBeenNthCalledWith` des tests Lot 4) strictement inchangés — retracé cas par cas contre les 19 tests de `canUseFeature` avant application.
2. **`admin/plans/page.tsx::updateEntitlementRowAction` — parallélisation des 3 écritures de la grille.** La boucle séquentielle (une ligne = 3 upserts, un par plan) est devenue un `Promise.all` : les 3 lignes `(plan_key, entitlement_key)` ciblées sont distinctes et indépendantes, sans raison de les sérialiser. Formulaire Super Admin à faible fréquence — gain marginal en absolu, mais gratuit et sans risque (pas d'écriture partagée entre les 3 appels).
3. **Commentaires obsolètes corrigés dans `admin-numbers-service.ts`.** Deux endroits affirmaient encore *"l'assignation à une entreprise n'est pas dans le périmètre de ce lot"* — vrai avant la Partie 2 de ce lot, faux depuis. Laissés en l'état, ils auraient activement induit en erreur un futur lecteur (y compris une future session de travail sur ce fichier). Corrigés pour refléter l'état réel du code, sans changement fonctionnel.

**Non fait, par choix** : pas de passe d'optimisation sur le code pré-existant (hors périmètre de ce lot) en dehors des deux fichiers ci-dessus déjà touchés par le lot — un balayage large du reste du projet (non écrit par ce lot, non ré-audité ligne à ligne) aurait un rapport risque/bénéfice défavorable dans un environnement où la suite de tests ne peut pas être exécutée pour confirmer l'absence de régression (voir section 0).

