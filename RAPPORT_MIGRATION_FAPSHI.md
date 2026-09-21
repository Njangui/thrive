# RAPPORT_MIGRATION_FAPSHI.md

**Date :** 20 septembre 2026
**Portée :** remplacement du PaymentProvider NotchPay par Fapshi + refonte de l'abstraction pour qu'un futur changement de provider ne touche plus les services applicatifs.

## Ce qui a changé

### 1. Nouveau provider : Fapshi
- Module complet `src/infrastructure/providers/payment/fapshi/` (types, client, adapter, webhook-handler + tests), basé sur une recherche web de la doc officielle (docs.fapshi.com) — **jamais testé contre l'API réelle** (pas de réseau dans cet environnement). À valider en sandbox (`sandbox.fapshi.com`) avant mise en production.
- Ancien module `payment/notchpay/` et sa route webhook **supprimés**.

### 2. Abstraction provider (le vrai objet de cette migration)
Trois angles morts trouvés dans l'implémentation NotchPay, corrigés pour de bon :

- **`provider`/`provider_reference` en dur.** `subscription-payment-service.ts`, `addons-service.ts` et `phone-number-rental-service.ts` écrivaient `provider: "notchpay"` en littéral, trois fois. Ils lisent désormais `provider.providerName` dynamiquement — plus aucune chaîne de provider dans ces fichiers.
- **Référence provider connue après coup, pas avant.** NotchPay acceptait une référence fournie par nous et la renvoyait telle quelle ; Fapshi génère la sienne (`transId`) côté serveur. Les trois services créent maintenant la ligne locale *après* l'appel `provider.createPayment()`, avec la vraie référence renvoyée — plus de dépendance à un comportement d'écho qui n'était vrai que pour NotchPay.
- **Fuite de type dans la couche applicative.** `handlePaymentWebhook()` prenait un `NotchPayWebhookEvent` complet. Il ne prend plus qu'une `string` (la référence provider) — c'est tout ce dont il a besoin, puisque le statut annoncé par un webhook n'est de toute façon jamais utilisé tel quel (toujours revérifié via l'API, principe déjà en place).
- **Pipeline webhook dupliqué.** Rate limiting, idempotence (`webhook_events`), gestion d'erreurs sont désormais dans `payment/webhook-pipeline.ts`, partagés par tous les providers. La route `/api/webhooks/fapshi/route.ts` ne contient plus que la vérification du secret + le parsing — une vingtaine de lignes.
- **Contrainte SQL figée.** `subscription_payments.provider` avait un `CHECK (provider in ('notchpay'))`. Supprimé (migration `0066`) — la colonne est texte libre, comme `webhook_events.provider` l'a toujours été.

Concrètement : un prochain changement de provider touchera uniquement un nouveau dossier `payment/<provider>/`, un `case` dans `registry.ts`, des variables d'env, et une route webhook de quelques lignes. Le détail (checklist) est dans `docs/PAYMENT_INTEGRATION.md`, section "Ajouter un nouveau provider".

## Différences Fapshi vs NotchPay à connaître

| | NotchPay | Fapshi |
|---|---|---|
| Couverture | Revendiquait multi-pays | **Cameroun uniquement (XAF)** |
| Auth API | 1 clé | 2 valeurs (`apiuser` + `apikey`) |
| Référence transaction | Fournie par nous | Générée par le provider |
| Signature webhook | HMAC-SHA256 | Secret statique (`x-wh-secret`) |
| API de payout | Aucune | Existe (`/payout`), non branchée ici |

## Points laissés ouverts (volontairement, décisions produit)

1. **Country Engine (`countries.notchpay_supported`, NG/GH/CI/SN/GA/KE/UG).** Fapshi ne traite que le XAF — cette roadmap "coming soon" n'a plus de prestataire technique réel derrière elle. Pas touché : c'est une décision produit ("quel provider pour les autres pays ?"), pas un renommage de code. `FapshiAdapter` refuse déjà toute devise ≠ XAF pour éviter un échec silencieux.
2. **Payout affilié automatisé.** Fapshi expose `/payout` (contrairement à NotchPay), mais l'activer exige un second compte de service Fapshi dédié (collecte et payout ne peuvent pas cohabiter sur un même compte). Le virement de commission reste manuel comme avant. Commentaire corrigé dans `affiliate-payout-service.ts` pour ne plus affirmer que c'est structurellement impossible.
3. **Redirection post-paiement.** Ni l'ancien adapter NotchPay ni le nouveau `FapshiAdapter` ne configurent `redirectUrl`/`callback` — comportement préservé à l'identique, pas une régression introduite ici.
4. **Résilience réseau à l'initiation.** Avec NotchPay, si l'appel `createPayment()` échouait après création réelle côté provider (timeout réseau), le webhook pouvait quand même retrouver la ligne locale (référence connue à l'avance). Avec Fapshi, ce n'est plus possible par construction (référence connue seulement dans la réponse) — dans ce cas précis, `reconcileStalePayments()` ne rattrapera pas non plus le paiement (la ligne locale n'existe simplement pas). Cas rare, mais réel : à surveiller si des paiements "fantômes" apparaissent côté Fapshi sans ligne locale correspondante.

## Actions à faire côté vous avant déploiement

1. **Variables d'environnement** (Vercel + `.env.local`) : remplacer `NOTCHPAY_API_KEY`/`NOTCHPAY_WEBHOOK_SECRET` par `FAPSHI_API_USER`, `FAPSHI_API_KEY`, `FAPSHI_WEBHOOK_SECRET` (dashboard Fapshi > Developers), et `PAYMENT_PROVIDER_DEFAULT=fapshi`. Si l'ancienne valeur `notchpay` traîne encore quelque part, le démarrage échouera au boot (voulu — fail fast plutôt qu'un crash plus tard en plein checkout).
2. **Migration SQL** : exécuter `0066_fapshi_payment_provider.sql`.
3. **Webhook Fapshi** : configurer l'URL `https://<votre-domaine>/api/webhooks/fapshi` côté dashboard Fapshi, noter le secret au moment de sa création (non relisible ensuite).
4. **Tester en sandbox** (`sandbox.fapshi.com`, numéros de test documentés par Fapshi) avant de pointer vers `live.fapshi.com` — rien de tout ce code n'a pu être exécuté contre l'API réelle dans cet environnement.
5. Vérifier réellement `npm run typecheck` / `npm test` (non exécutables ici, pas de réseau/`node_modules` — seule une vérification syntaxique via le compilateur TypeScript en mode parse-only a pu être faite sur tous les fichiers créés/modifiés, sans erreur).

## Fichiers touchés (résumé)

Créés : `payment/fapshi/{types,client,adapter,webhook-handler,webhook-handler.test}.ts`, `payment/webhook-pipeline.ts`, `api/webhooks/fapshi/route.ts`, `supabase/migrations/0066_fapshi_payment_provider.sql`, ce rapport.
Supprimés : `payment/notchpay/*`, `api/webhooks/notchpay/route.ts`.
Modifiés : `registry.ts`, `secrets-resolver.ts`, `env.ts`, `.env.example`, `domain/ports/payment-provider.ts`, `subscription-payment-service.ts` (+ test), `addons-service.ts` (+ test), `phone-number-rental-service.ts`, `affiliate-payout-service.ts`, `docs/PAYMENT_INTEGRATION.md`, `middleware.ts`, `rate-limit.ts`, `auth-service.ts`, `cgu/page.tsx`, `confidentialite/page.tsx`, `dashboard/{addons,channels,subscription}/page.tsx`, `cron/process-payment-reconciliation/route.ts`, `scripts/seed-demo.ts`.
Non touchés (hors périmètre, voir point 1 ci-dessus) : `notchpay-resources-service.ts`, `admin-countries-service.ts`, `country-service.ts`, `docs/notchpay-resources.md`, et tout le Country Engine.
