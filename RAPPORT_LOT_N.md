# Rapport — Lot N : Facturation récurrente réelle, domaines automatisés, credentials par tenant

Conforme au mandat de la vague K-O (`00_CONVENTIONS_COMMUNES_V3.md`) : les trois parties sont construites de bout en bout, jamais arrêtées à un constat de limitation fournisseur. Développé et vérifié directement contre le projet fusionné B-I (accès réseau réel, comme pour le Lot G) — `typecheck`/`test`/`lint`/`build` passent sur le projet entier, pas seulement sur ce lot en isolation.

## 1. Ce qui a été fait

### Partie 1 — Facturation récurrente réelle

Contrainte confirmée par le Lot G (`docs/PAYMENT_INTEGRATION.md`) : NotchPay n'a aucune ressource de prélèvement récurrent. Construit côté application, comme demandé : `subscription-payment-service.ts::processSubscriptionRenewals()`, appelée par `/api/cron/process-subscription-renewals` (même pattern exact que `/api/cron/process-broadcasts` du Lot F — protection `CRON_SECRET`).

Pour chaque abonnement `trialing`/`active` :
- échéance dans J-3 et jamais relancée pour CETTE échéance → génère un lien de paiement (`generateRenewalPaymentLink`, réutilise `initiatePayment` en trouvant l'owner le plus ancien de l'organisation et son email via l'API Admin Supabase) + notifie + marque `last_renewal_reminder_sent_at`.
- échéance dépassée → passe `past_due` + notifie (transition d'état elle-même idempotente : une fois `past_due`, la requête du cron l'exclut naturellement des exécutions suivantes).

Corrigé en même temps : `RAPPORT_LOT_G.md` documentait explicitement que le bonus add-ons était recalculé à la volée depuis `addons.increment_value` (valeur courante), donc rétroactif. `organization_addons.total_increment_granted` accumule maintenant le bonus déjà calculé à CHAQUE achat (quantité × increment_value au moment précis de cet achat) — un changement de tarif après coup n'affecte plus jamais un achat déjà confirmé.

### Partie 2 — Domaines : intégration réelle (OpenProvider)

OpenProvider était le candidat recommandé par `RAPPORT_LOT_G.md` (API REST self-service documentée, sandbox — contrairement à EuroDNS qui exige un contrat commercial avant tout accès). Vérifié via `support.openprovider.eu` (consulté 31 août 2026) : `POST /auth/login` (`{username, password, ip}` → `{data: {token, reseller_id}}`), `POST /domains/check` (`{domains: [{name, extension}], with_price, with_whois}` → `{data: {results: [{domain, status, price?}]}}`, `status: "free"` = disponible).

`OpenProviderAdapter` implémente réellement `search`/`checkAvailability` (recherche + prix en direct) et **délègue** `register`/`configureDns`/`renew` à `ManualDomainAdapter` (composition, jamais dupliqué) — conforme au mandat V3 qui autorise explicitement l'enregistrement effectif à rester une étape confirmée manuellement par le Super Admin, tant que la recherche/disponibilité, elles, sont réelles. `registry.ts::getDomainProvider()` bascule automatiquement sur OpenProvider dès que `OPENPROVIDER_USERNAME`/`PASSWORD` sont configurés, repli sur Manual sinon.

`/dashboard/site` : le champ "Nom de domaine souhaité" est devenu un Client Component (`domain-search-field.tsx`) avec debounce 500ms, appelant une Server Action (`domain-search-actions.ts`, même pattern que `push-actions.ts` du Lot I) qui interroge toutes les extensions actives d'un coup et affiche disponibilité + prix réel (grille tarifaire + marge, jamais le prix brut OpenProvider).

### Partie 3 — Credentials par tenant

**Découverte déterminante avant tout code** : `provider_connections` (0005_providers_and_ai.sql, présente depuis la toute première fusion) a *déjà* exactement la forme que le cahier demande de créer sous un nouveau nom (`organization_provider_credentials`) — `organization_id`, `provider_type`, `provider_name`, `credential_reference`, `unique(organization_id, provider_type, provider_name)`. Le commentaire de tête historique de `secrets-resolver.ts` anticipait même littéralement cette table pour la résolution per-tenant. Créer une seconde table identique aurait dupliqué la source de vérité sans raison — voir section 2.

Supabase Vault vérifié (`supabase.com/docs/guides/database/vault`) : `vault.create_secret`/`update_secret`/`decrypted_secrets` existent, mais le schéma `vault` n'est PAS exposé par PostgREST (confirmé par un cas réel documenté d'échec d'appel RPC direct). `0037_tenant_credentials.sql` crée donc 4 fonctions wrapper `public.vault_*`, `security definer`, exécution strictement réservée `service_role` (jamais `authenticated`/`anon`).

`secrets-resolver.ts::resolveCredential(organizationId, providerType, providerName)` : cherche un `credential_reference` dans `provider_connections`, sinon retombe sur la clé plateforme mono-tenant existante (comportement inchangé pour tout tenant n'ayant jamais configuré son propre compte). Câblé dans `registry.ts` pour `getMessagingProvider`, `getSocialPublishingProvider` et `getAIProvider`/`buildAIAdapter` — les trois seuls providers où un compte par tenant a un sens métier (storage et payment restent plateforme-only, décision déjà actée en Lot G).

`/admin/organizations` (Super Admin, jamais le commerçant) : formulaire "Configurer un compte dédié" par entreprise + option de retrait, réutilisant `writeAdminAuditLog` (jamais le secret dans l'audit log, uniquement le fait qu'un compte dédié existe).

## 2. Écarts assumés vs le cahier

1. **`provider_connections` réutilisée, pas de nouvelle table `organization_provider_credentials`** — voir section 1, Partie 3. Migration `0037` ne crée donc aucune table, seulement les fonctions Vault. Documenté en tête du fichier de migration lui-même, pas seulement ici.
2. **`total_increment_granted` plutôt que le nom suggéré par le cahier** — en concevant la migration, il est apparu qu'une simple colonne "increment_value au moment de l'achat" ne suffit pas : `organization_addons` accumule les achats répétés d'un même add-on dans UNE seule ligne (quantité incrémentée), donc un second achat après un changement de tarif écraserait la valeur figée du premier avec une colonne "taux". La colonne accumule directement le bonus déjà calculé (additif à chaque achat), pas un taux à réappliquer. Testé explicitement (voir critère d'acceptation, section 6).
3. **OpenProvider, pas les deux registrars** — le cahier autorise explicitement à n'en choisir qu'un.

## 3. Hypothèses et décisions prises

- **Porteur du paiement de relance automatique** : l'owner le plus ancien de l'organisation (`memberships.role='owner'`, `created_at` croissant), son email récupéré via l'API Admin Supabase (`auth.admin.getUserById`, service-role uniquement). Aucune préférence de contact explicite n'existe ailleurs dans le schéma pour ce cas précis (déclenchement système, pas de session).
- **`resolveCredential` : repli silencieux uniquement si AUCUN compte dédié n'a jamais été configuré.** Si un `credential_reference` existe mais que sa lecture Vault échoue, la fonction **lève** plutôt que de retomber sur la clé plateforme — un repli silencieux dans ce cas précis risquerait de faire transiter les données d'un tenant par le mauvais compte (risque d'isolation, pas un simple inconvénient d'UX). Testé explicitement.
- **Cible des credentials dédiés limitée à `messaging:zernio`, `social:zernio`, `ai:{mistral,claude,openai}`** — liste fermée (`TENANT_CREDENTIAL_PROVIDERS`) plutôt qu'un champ texte libre, pour ne jamais créer une ligne `provider_connections` incohérente avec ce que `registry.ts` sait réellement résoudre.
- **Token OpenProvider non mis en cache** — aucune durée de validité n'est précisée dans la documentation consultée ; deviner un TTL aurait été contraire à la discipline de vérification du projet. Chaque recherche ré-authentifie (un aller-retour réseau de plus, pas un risque de correction). Point d'optimisation explicite une fois le comportement réel observable avec un compte de production (voir section 7).
- **Backfill de `total_increment_granted`** pour les lignes `organization_addons` antérieures à ce lot : calculé depuis la valeur COURANTE de `addons.increment_value`, faute d'historique réel des achats successifs. N'affecte que les organisations ayant acheté un add-on AVANT ce lot ET dont l'add-on a changé de tarif depuis — un cas de bord assumé, documenté dans la migration elle-même.

## 4. Fichiers créés

**Migrations**
- `supabase/migrations/0036_recurring_billing.sql`
- `supabase/migrations/0037_tenant_credentials.sql`

**Infrastructure**
- `src/infrastructure/providers/domain/openprovider/{types,client,adapter}.ts`

**Routes**
- `src/app/api/cron/process-subscription-renewals/route.ts`
- `src/app/dashboard/site/domain-search-actions.ts`
- `src/app/dashboard/site/domain-search-field.tsx`

**Tests**
- `src/application/services/domain-service.test.ts`
- `src/infrastructure/providers/secrets-resolver.test.ts`

**Documentation**
- Ce fichier

## 5. Fichiers modifiés

- `src/application/services/addons-service.ts` (+ `.test.ts`) — bonus figé à l'achat (`total_increment_granted`)
- `src/application/services/subscription-payment-service.ts` (+ `.test.ts`) — `generateRenewalPaymentLink`, `processSubscriptionRenewals`
- `src/application/services/domain-service.ts` — `checkDomainAvailability`
- `src/application/services/admin-organizations-service.ts` — `dedicatedCredentials` (liste), `configureTenantProviderCredential`, `removeTenantProviderCredential`
- `src/infrastructure/providers/registry.ts` — `getDomainProvider()` (bascule OpenProvider/Manual), `resolveCredential` câblé dans messaging/social/AI
- `src/infrastructure/providers/secrets-resolver.ts` — `resolveCredential` (nouveau, `resolveProviderCredential` inchangée)
- `src/lib/env.ts`, `.env.example` — `OPENPROVIDER_USERNAME`/`PASSWORD`
- `src/app/dashboard/site/page.tsx` — `DomainSearchField` remplace le champ statique
- `src/app/admin/organizations/page.tsx` — section "Comptes dédiés"

## 6. Ce qui a été vérifié (contre le projet entier)

- `npm run typecheck` → **0 erreur**
- `npm test` → **243/243** (227 pré-existants + 16 ajoutés : 5 sur la facturation récurrente/bonus figé, 7 sur `resolveCredential`, 4 sur `checkDomainAvailability`)
- `npm run lint` → **0 warning**
- `npm run build` → **34 routes compilées avec succès**, y compris toutes les routes ajoutées. Vérifié avec la même substitution temporaire des polices Google que documentée dans `RAPPORT_LOT_G.md` (sandbox sans accès `fonts.googleapis.com`), `src/app/layout.tsx` restauré à l'identique juste après (diff vérifié).
- Critères d'acceptation du cahier vérifiés explicitement par test :
  - relance J-3 unique par échéance (`subscription-payment-service.test.ts`)
  - changement d'`increment_value` sans effet rétroactif sur un achat déjà confirmé (`addons-service.test.ts`)
  - `resolveCredential` : repli plateforme correct, et absence de repli silencieux si un compte dédié configuré est illisible (`secrets-resolver.test.ts`)
- Aucune clé API tenant ne transite en clair : vérifiable par lecture du code — `credential_reference` n'est jamais construit à partir d'une variable contenant directement un secret (uniquement des `uuid` renvoyés par `vault_create_secret`/lus par `vault_read_secret`), et `configureTenantProviderCredential`/`removeTenantProviderCredential` n'écrivent jamais `secretValue` dans `audit_logs`.

## 7. Limitations connues / TODO explicite

Conformément au mandat V3, les points ci-dessous sont des vérifications nécessitant un accès réel à un compte fournisseur de production — pas des fonctionnalités non construites :

- **Durée de validité réelle du token OpenProvider** : à observer une fois un compte de production configuré, pour éventuellement mettre en cache le token entre deux recherches rapprochées (optimisation réseau, pas une question de correction).
- **Couverture `.cm` chez OpenProvider** : leur catalogue exact de TLD supportés n'a pas pu être vérifié sans compte — à confirmer au premier `OPENPROVIDER_USERNAME`/`PASSWORD` réel configurés.
- **`admin-organizations-service.ts` n'a pas de fichier de test dédié** — pré-existant à ce lot (aucune des fonctions historiques du fichier n'en a), non comblé pour les 2 nouvelles fonctions faute de proportion (créer un fichier de test pour 300+ lignes existantes jamais testées, pour seulement 2 nouvelles fonctions, aurait débordé largement le périmètre de ce lot). Signalé explicitement plutôt que passé sous silence.
