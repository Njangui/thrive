# Rapport — Lot G : Domaines, Add-ons & Paiement d'abonnement

Contrairement aux lots précédents (B-E), ce lot a été développé avec un accès réseau réel (registre npm + web) et directement intégré dans le dépôt fusionné plutôt qu'en isolation. Chaque étape ci-dessous a donc été vérifiée pour de vrai (`npm run typecheck`, `npm test`, `npm run lint`, `npm run build`) contre l'ensemble du projet — Lots B à G confondus — et pas seulement en lecture statique du code.

## 1. Ce qui a été fait

### Partie 1 — Paiement d'abonnement (NotchPay)

Vérification préalable de l'API réelle (voir `docs/PAYMENT_INTEGRATION.md` pour le détail complet, verdicts SUPPORTED/PARTIAL/NOT_SUPPORTED). En bref : paiement + webhook signés = SUPPORTED ; Mobile Money Cameroun (MTN/Orange) = SUPPORTED ; carte bancaire = PARTIAL (existe côté NotchPay, activation par compte non vérifiable depuis la doc seule) ; paiement récurrent réel et remboursement via API = NOT_SUPPORTED (aucune ressource "subscription" ni "refund" dans l'API — voir le doc pour le raisonnement complet).

Implémenté : adapter NotchPay complet (`createPayment`, `verifyPayment`, `getPaymentStatus`, `cancelPayment`) branché sur le port `PaymentProvider` existant ; webhook vérifié par signature HMAC puis toujours re-vérifié via l'API avant tout crédit (jamais de confiance aveugle au corps du webhook) ; flow complet initiation → checkout NotchPay → webhook → activation, avec annulation d'un paiement encore `pending` et historique de facturation côté tenant (`/dashboard/subscription`).

### Partie 2 — Add-ons

Catalogue plateforme géré par le Super Admin (`/admin/addons`), achat tenant (`/dashboard/addons`) qui réutilise **exactement le même flow de paiement** que la Partie 1 (même table `subscription_payments`, discriminée par `payment_type`). `entitlements-service.ts::canUseFeature` additionne désormais la limite du plan et le bonus cumulé des add-ons actifs de l'organisation pour toute clé générique ; le cas `ai_credits` reste délégué à `getCreditStatus()` mais un add-on qui cible cette clé top-up directement `ai_credit_balances` via `grantCredits()` au moment de la confirmation de paiement (voir section 3, "Hypothèses").

Durée d'essai à l'onboarding rendue configurable (`platform_settings.trial_days`, réglable depuis `/admin/addons`) au lieu de la constante `14` en dur.

### Partie 3 — Domaines (achat)

Aucun registrar avec API publique en self-service couvrant le `.cm` n'a été trouvé dans le temps imparti (le `.cm` est géré régionalement par Netcom.cm/ANTIC, sans API documentée). Candidats évalués pour une future intégration :

- **OpenProvider** (recommandé en premier) — API REST self-service documentée, sandbox, OpenAPI spec, ~1900 TLD. Couverture spécifique du `.cm` non confirmée (à vérifier dans leur catalogue TLD au moment de l'intégration), mais c'est le registrar le plus proche d'une intégration autonome sans négociation commerciale préalable.
- **EuroDNS** (second choix) — couvre le `.cm` mais leur API nécessite un contrat commercial signé avant tout accès, donc pas intégrable de façon autonome dans un délai court.

En conséquence : port `DomainProvider` créé, implémenté par un seul adapter (`ManualDomainAdapter`) qui transforme une demande d'achat en ligne `domain_requests` à traiter manuellement — jamais un faux achat automatique. `search`, `checkAvailability`, `configureDns` et `renew` lèvent une erreur explicite plutôt que de simuler une capacité inexistante.

## 2. Écarts assumés vs le cahier (07_LOT_G_domaines_addons_paiement.md)

1. **`subscription_payments` généralisée** (`payment_type` + `addon_key`/`addon_quantity`, `plan_key` devenu nullable) — le cahier décrit cette table comme spécifique à un plan, mais son propre schéma pour la Partie 2 (`organization_addons.subscription_payment_id`) suppose qu'elle sert aussi à payer un add-on. Sans cet ajout, l'un des deux flows de paiement aurait dû dupliquer une table quasi identique. Documenté en tête de `0019_subscription_payments.sql`.
2. **Point d'entrée tenant pour les domaines** (`/dashboard/site`, section "Domaine personnalisé") — le cahier ne liste que `/admin/domains` dans sa section UI Partie 3. Sans point d'entrée tenant, aucune ligne `domain_requests` n'aurait jamais pu être créée en pratique. Ajout délibéré et documenté dans `domain-service.ts`.
3. **`PaymentProvider` étendu** — `cancelPayment?` (optionnel) et `customerEmail?` ajoutés au port existant. Le premier reflète une capacité NotchPay confirmée (`DELETE /payments/{reference}` sur un paiement `pending`) ; le second était un angle mort du port original (seul `customerPhone` existait, or NotchPay accepte email OU phone, et l'email de session est toujours disponible contrairement à un numéro de téléphone). Les deux sont additifs, sans rupture pour un éventuel autre implémenteur du port.
4. **`writeAdminAuditLog` généralisée et exportée** — signature étendue (`organizationId` nullable, `entityId` optionnel) pour couvrir les actions Super Admin sans organisation cible (add-ons, tarification domaine, réglages plateforme). Les 3 call sites historiques de `admin-organizations-service.ts` restent inchangés en comportement.
5. **`PAYMENT_PROVIDER_DEFAULT` corrigé** de `"cinetpay"` (jamais implémenté, aucun adapter CinetPay n'existe dans ce dépôt) vers `"notchpay"` — l'ancienne valeur par défaut aurait fait échouer `getPaymentProvider()` silencieusement en production.

## 3. Hypothèses et décisions prises

- **`increment_value` d'un add-on n'est pas snapshoté** dans `organization_addons` au moment de l'achat — si le Super Admin le modifie après coup, la capacité déjà accordée est recalculée avec la nouvelle valeur (relu à chaque `canUseFeature`). Cohérent avec le choix "ne pas sur-engineer pour V1" déjà présent ailleurs dans le projet, mais à corriger si des add-ons à incrément variable dans le temps sont introduits.
- **Un add-on ciblant `ai_credits` ne passe pas par le mécanisme générique de bonus** (celui-ci ne s'applique qu'aux clés lues via `plan_entitlements`) : `canUseFeature("ai_credits", ...)` délègue entièrement à `getCreditStatus()`, qui ignore `organization_addons`. La confirmation de paiement (`confirmAddonPurchase`) appelle donc `grantCredits()` en plus de l'incrément générique — les deux mécanismes coexistent, chacun couvrant un type d'entitlement différent.
- **`initiatePayment`/`purchaseAddon` exigent l'email de session de l'acteur**, jamais un numéro de téléphone — c'est la seule donnée de contact garantie disponible (Supabase Auth), contrairement à un téléphone métier qui n'est pas systématiquement celui de la personne qui règle la facture.
- **Renouvellement d'abonnement = +1 mois calendaire** à chaque paiement confirmé (`current_period_end` recalculé depuis `now()`, pas depuis l'ancienne date d'échéance) — un paiement en avance ne cumule donc pas les mois. Choix simple, cohérent avec l'absence de facturation récurrente réelle côté NotchPay (voir Partie 1).
- **Rôles autorisés à payer/acheter** (abonnement, add-on, demande de domaine) : `owner` et `admin` uniquement — pas `manager`/`accountant`, la finance de la plateforme (par opposition à la finance du commerce, gérée plus largement) reste un geste réservé aux rôles de direction.

## 4. Fichiers créés

**Migrations**
- `supabase/migrations/0019_subscription_payments.sql`
- `supabase/migrations/0020_addons.sql`
- `supabase/migrations/0021_domain_pricing.sql`

**Domaine / Infrastructure**
- `src/domain/ports/domain-provider.ts`
- `src/infrastructure/providers/payment/notchpay/{types,client,adapter,webhook-handler}.ts` (+ `webhook-handler.test.ts`)
- `src/infrastructure/providers/domain/manual/adapter.ts`

**Services applicatifs**
- `src/application/services/subscription-payment-service.ts` (+ `.test.ts`)
- `src/application/services/addons-service.ts` (+ `.test.ts`)
- `src/application/services/admin-addons-service.ts`
- `src/application/services/domain-service.ts`
- `src/application/services/platform-settings-service.ts`

**UI**
- `src/app/api/webhooks/notchpay/route.ts`
- `src/app/dashboard/addons/page.tsx`
- `src/app/admin/addons/page.tsx`

**Documentation**
- `docs/PAYMENT_INTEGRATION.md`
- Ce fichier

## 5. Fichiers modifiés

- `src/domain/ports/payment-provider.ts` — `cancelPayment?`, `customerEmail?` (additifs, voir section 2.3)
- `src/infrastructure/providers/registry.ts` — `getPaymentProvider()` (branché sur `PAYMENT_PROVIDER_DEFAULT`), `getDomainProvider()`
- `src/application/services/admin-organizations-service.ts` — `writeAdminAuditLog` exportée et généralisée (voir section 2.4)
- `src/application/services/plans-repository.ts` — `createTrialSubscription()` lit `platform_settings.trial_days` quand `trialDays` est omis
- `src/application/services/onboarding-service.ts` — call site mis à jour en conséquence
- `src/application/services/entitlements-service.ts` — `canUseFeature()` additionne le bonus add-ons (+ tests étendus)
- `src/application/services/admin-domains-service.ts` — sections Tarification + Demandes ajoutées
- `src/application/services/auth-service.ts` — `getCurrentUserEmail()` ajoutée
- `src/app/dashboard/subscription/page.tsx` — paiement, annulation, historique
- `src/app/dashboard/site/page.tsx` — section "Domaine personnalisé" (voir section 2.2)
- `src/app/admin/domains/page.tsx` — sections Tarification + Demandes
- `src/app/dashboard/layout.tsx`, `src/app/admin/layout.tsx` — liens de navigation "Add-ons"
- `src/lib/env.ts`, `.env.example` — `NOTCHPAY_WEBHOOK_SECRET`, `PAYMENT_PROVIDER_DEFAULT` corrigé

## 6. Ce qui a été vérifié (contre le projet entier, pas seulement ce lot)

- `npm run typecheck` → **0 erreur**
- `npm test` → **140/140** (108 pré-existants + 32 ajoutés par ce lot : 15 sur `entitlements-service.ts` dont 5 nouveaux pour le bonus add-ons, 10 sur `webhook-handler.ts` NotchPay, 9 sur `subscription-payment-service.ts` dont l'idempotence webhook rejoué, 8 sur `addons-service.ts`)
- `npm run lint` → **0 warning**
- `npm run build` → **27 routes compilées avec succès**, y compris toutes les routes ajoutées (`/admin/addons`, `/dashboard/addons`, `/api/webhooks/notchpay`, sections étendues de `/admin/domains`, `/dashboard/subscription`, `/dashboard/site`). Vérifié en substituant temporairement les polices Google (le sandbox n'a pas accès à `fonts.googleapis.com`, contrainte déjà documentée dans `RAPPORT_FUSION.md`) puis en restaurant `src/app/layout.tsx` à l'identique (diff vérifié) immédiatement après — rien de cette substitution n'est présent dans le code livré.
- Critères d'acceptation du cahier vérifiés explicitement par test : idempotence webhook rejoué (`subscription-payment-service.test.ts`), aucun incrément d'entitlement avant paiement confirmé (`addons-service.test.ts`), calcul limite plan + add-ons (`entitlements-service.test.ts`).

## 7. Limitations connues / TODO explicite

- **Carte bancaire NotchPay** : à confirmer directement dans le dashboard du compte marchand de production — la documentation seule ne suffit pas à trancher l'activation par pays.
- **Rappel avant échéance d'abonnement** : non implémenté (candidat naturel pour Lot H, notifications/observabilité) — sans paiement récurrent réel côté NotchPay, un tenant qui oublie de renouveler voit simplement son statut repasser à échu, sans relance automatique.
- **`.cm` réel** : reste un processus 100% manuel (`domain_requests` + équipe Marc-well) tant qu'aucun registrar avec API n'est sous contrat — voir section 1, Partie 3, pour les deux candidats évalués.
- **Add-ons à incrément variable dans le temps** : non supporté (voir hypothèse en section 3) — un changement d'`increment_value` s'applique rétroactivement à tous les achats déjà faits.
