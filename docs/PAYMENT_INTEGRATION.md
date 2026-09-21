# Intégration paiement — Fapshi (migré depuis NotchPay le 2026-09-20)

**Statut :** SUPPORTED (paiement + webhook + annulation), PARTIAL (remboursement, payout), NOT_SUPPORTED (paiement récurrent réel, multi-pays).
**Consulté :** 20 septembre 2026, [docs.fapshi.com](https://docs.fapshi.com) — `en/api-reference/endpoint/*`, `en/api-reference/preliminary-knowledge/environment`. Recherche web uniquement : cet environnement n'a pas d'accès réseau pour taper l'API réellement — **à revalider en sandbox (sandbox.fapshi.com) avant toute mise en production.**
**Adapter :** `src/infrastructure/providers/payment/fapshi/` (types, client, adapter, webhook-handler).
**Pipeline webhook générique (partagé par tous les providers) :** `src/infrastructure/providers/payment/webhook-pipeline.ts`.

Ce document tranche, capacité par capacité, ce que l'intégration fait réellement — pour que personne (un futur agent inclus) n'ait à re-deviner ce qui a été vérifié vs supposé.

## Résumé

| Capacité | Verdict | Détail |
|---|---|---|
| Créer un paiement + obtenir une URL de checkout | **SUPPORTED** | `POST /initiate-pay` → `link` (page hébergée, valide 24h) |
| Vérifier le statut d'un paiement | **SUPPORTED** | `GET /payment-status/{transId}` |
| Recevoir une confirmation par webhook | **SUPPORTED** | Secret statique vérifiable (`x-wh-secret`, comparaison directe — PAS de HMAC) |
| Annuler un paiement | **PARTIAL** | `POST /expire-pay` — uniquement si encore `PENDING`/`CREATED`, et seulement pour un paiement créé via `initiate-pay` (jamais `direct-pay`, non utilisé dans ce projet) |
| Mobile Money (MTN/Orange Cameroun) | **SUPPORTED** | Seuls canaux Fapshi, confirmés `mobile money` / `orange money` |
| Autres pays / autres devises | **NOT_SUPPORTED** | Fapshi ne traite QUE le XAF (Cameroun) — voir "Contrainte multi-pays" ci-dessous |
| Paiement récurrent réel (abonnement automatique) | **NOT_SUPPORTED** | Aucune ressource "subscription"/"recurring" documentée — chaque renouvellement reste un nouveau `POST /initiate-pay` initié manuellement (comportement hérité de NotchPay, inchangé par cette migration) |
| Remboursement via API | **NOT_SUPPORTED** | Aucun endpoint de remboursement dans la documentation consultée |
| Virement sortant (payout) | **PARTIAL, non activé** | `POST /payout` existe (contrairement à NotchPay) mais nécessite un second compte de service Fapshi dédié (collecte et payout ne peuvent pas partager un compte) — décision produit non tranchée, voir `affiliate-payout-service.ts` |

## Ce qui est réellement branché

- **Créer un paiement** — `POST https://live.fapshi.com/initiate-pay` (ou `sandbox.fapshi.com` — voir `FAPSHI_BASE_URL`), en-têtes `apiuser`/`apikey` (DEUX valeurs, contrairement à NotchPay qui n'en exigeait qu'une). Body : `amount` (min 100 XAF), `email`, `externalId` (notre `paymentId` local, pour réconciliation manuelle côté dashboard Fapshi — **jamais** la référence provider elle-même), `userId` (notre `organizationId`), `message`. Réponse : `transId` (référence provider, **générée par Fapshi**, jamais par nous) + `link` (URL de checkout).
- **Vérifier un paiement** — `GET /payment-status/{transId}`. Utilisé **systématiquement dans le webhook** avant de créditer quoi que ce soit (voir plus bas), et par la réconciliation programmée (`reconcileStalePayments`).
- **Annuler un paiement** — `POST /expire-pay` avec `{ transId }`. Utilisé par "Annuler" sur un paiement en attente (`/dashboard/subscription`), best-effort (un échec ne bloque jamais l'annulation locale — voir `cancelPendingPayment`).
- **Webhook** — POST vers l'URL configurée côté dashboard Fapshi (Developers > Webhooks). Corps : directement l'objet Transaction (**pas d'enveloppe `{id, event, data}` comme NotchPay**) — `{ transId, status, amount, externalId, userId, email, ... }`. Un seul événement par delivery, confirmé "Fapshi sends only one webhook request per event, regardless of whether your server responds or not". Statuts : `CREATED`, `PENDING`, `SUCCESSFUL`, `FAILED`, `EXPIRED`. Authentification : en-tête `x-wh-secret`, comparaison directe en temps constant (`crypto.timingSafeEqual`) — **pas de signature HMAC** (différence structurelle avec NotchPay, à ne pas rater si vous portez du code écrit pour NotchPay).

## Différence structurelle majeure avec NotchPay : qui génère la référence ?

NotchPay acceptait une `reference` fournie par l'appelant et la renvoyait telle quelle — ce projet en profitait pour utiliser `paymentId` (notre UUID local) directement comme `provider_reference`, généré et stocké *avant* même l'appel API. **Fapshi génère son propre `transId` côté serveur** : impossible de le connaître avant la réponse à `initiate-pay`.

Conséquence sur le code (pas seulement un renommage) : `initiatePayment()` (et `purchaseAddon()`, `initiateDedicatedNumberPayment()`) appellent désormais `provider.createPayment()` **avant** d'insérer la ligne locale, et stockent `result.providerReference` (jamais `paymentId`) comme `provider_reference`. Voir le commentaire "ABSTRACTION PROVIDER" en tête de `subscription-payment-service.ts`.

## Contrainte multi-pays (à lire avant d'activer un pays hors Cameroun)

Le Country Engine (`countries.notchpay_supported`, `payment_channels` — noms de colonnes hérités de l'époque NotchPay, voir `docs/notchpay-resources.md`) avait pré-rempli NG/GH/CI/SN/GA/KE/UG comme `coming_soon`, sur la base des revendications publiques de NotchPay. **Fapshi ne traite que le XAF/Cameroun** — cette roadmap n'a plus de prestataire technique réel derrière elle tant qu'aucune décision n'est prise. `FapshiAdapter.createPayment()` refuse déjà explicitement toute devise ≠ XAF (échec net et loggé plutôt qu'un appel API voué à échouer côté Fapshi), mais ça ne résout que la sécurité technique — pas la question produit ("quel provider pour les autres pays ?"). Cette migration n'a pas touché au Country Engine lui-même : décision volontairement laissée ouverte.

## Ajouter un nouveau provider (objectif de l'abstraction mise en place le 2026-09-20)

Le port `PaymentProvider` (`src/domain/ports/payment-provider.ts`) existait déjà avant cette migration ; ce qui a changé, c'est que plus aucun code en dehors de `payment/<provider>/` et `registry.ts` ne connaît le nom d'un provider concret. Pour brancher un provider `X` :

1. Créer `src/infrastructure/providers/payment/x/{types,client,adapter,webhook-handler}.ts`. L'adapter implémente `PaymentProvider` (`providerName`, `createPayment`, `verifyPayment`, `getPaymentStatus`, `cancelPayment?`) ; le webhook-handler expose une fonction de vérification (signature/secret) et une fonction de parsing — pures, testables isolément (voir `fapshi/webhook-handler.test.ts`).
2. Ajouter un `case "x":` dans `registry.ts::getPaymentProvider()` + les variables d'env correspondantes dans `env.ts`/`.env.example`.
3. Créer `src/app/api/webhooks/x/route.ts` — quelques lignes, appelle `handlePaymentWebhookRequest()` (`payment/webhook-pipeline.ts`) avec la config `{ providerName, verify, parse }` du provider. Rate limiting, idempotence (`webhook_events`), gestion d'erreurs : déjà faits, une seule fois, pour tous les providers.
4. **Rien d'autre.** `subscription-payment-service.ts`, `addons-service.ts`, `phone-number-rental-service.ts` lisent `provider.providerName`/`result.providerReference` dynamiquement — aucune chaîne de provider en dur. `subscription_payments.provider` est une colonne texte libre depuis la migration `0066_fapshi_payment_provider.sql` (plus de `CHECK` figé) : changer `PAYMENT_PROVIDER_DEFAULT` ne demande plus de migration SQL.

## Bonnes pratiques appliquées (héritées de NotchPay, valables pour tout provider)

- **Ne jamais faire confiance au seul corps du webhook** — `handlePaymentWebhook()` revérifie systématiquement via `provider.verifyPayment()` avant de créditer un abonnement ou un add-on, même si le webhook annonce déjà `SUCCESSFUL`.
- **Gérer les retries** — la route webhook répond toujours `200` (même sur événement dupliqué ou déjà traité), pour ne jamais provoquer un retry infini côté provider sur une erreur qui nous est propre.
- **Idempotence** — `webhook_events` impose `unique (provider, external_event_id)`. Pour Fapshi, `external_event_id = transId` : un `transId` n'atteint un statut terminal qu'une seule fois (confirmé : "No payments can be made after status is SUCCESSFUL or EXPIRED"), donc `transId` seul suffit comme clé — pas besoin d'un identifiant d'événement séparé comme NotchPay en fournissait un (`event.id`).

## Domaines — verdict (voir aussi RAPPORT_LOT_G.md)

Hors périmètre de ce document (spécifique au paiement), mais même discipline : aucun registrar avec API publique en self-service couvrant le `.cm` n'a été trouvé dans le temps imparti. Détail complet et candidats évalués (OpenProvider, EuroDNS) dans `RAPPORT_LOT_G.md`, section "Domaines".
