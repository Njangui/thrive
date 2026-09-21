# Rapport de fusion #19 — fusion #18 + migration NotchPay → Fapshi

Fait suite à `RAPPORT_FUSION_18.md`. Date : 21 septembre 2026.

## 1. Source reçue et sa base

`fapshi-migration-fichiers.zip` n'est **pas un projet complet** : c'est un *changeset* de fichiers entiers (pas des diffs) — 30 fichiers de code / config / docs, `RAPPORT_MIGRATION_FAPSHI.md` (conservé tel quel à la racine) et `SUPPRIMES.txt` (les deux dossiers NotchPay à supprimer).

**Sa base est `thrive-main`, pas la fusion #18** (il embarque `src/middleware.ts`, que #18 a remplacé par `proxy.ts`). Preuve par comparaison de chaque fichier existant aux arbres connus :

| Fichier | Écart changeset ↔ `thrive-main` | Écart changeset ↔ fusion #18 | Cause de l'écart avec #18 |
|---|---|---|---|
| `src/app/cgu/page.tsx` | 4 lignes | 62 lignes | patch SEO |
| `src/app/confidentialite/page.tsx` | 4 | 29 | patch SEO |
| `src/lib/rate-limit.ts` | 6 | 23 | upgrade v16 (limiteur `public_analytics`, commentaires) |
| `src/app/dashboard/channels/page.tsx` | 2 | 5 | correctif lint de #18 (`<Link>`) |
| `src/middleware.ts` | 5 | n'existe plus | renommé `proxy.ts` (Next 16) |
| 17 autres fichiers | — | — | identiques à `thrive-main` dans #18 |

Un remplacement à l'aveugle aurait donc **écrasé** le travail SEO, le limiteur de #18 et le passage à `proxy.ts`.

## 2. Méthode

- **Base = fusion #18** ; le changeset est rejoué par-dessus.
- **17 fichiers** où #18 = `thrive-main` : remplacés par la version du changeset (aucun conflit possible).
- **5 fichiers** où #18 a divergé : le diff `thrive-main → changeset` est appliqué sur #18 avec `patch -F0` (aucun flou). Trois passent ; **deux hunks sont refusés** (`cgu/page.tsx` : le contexte a bougé avec le patch SEO ; `rate-limit.ts` : l'upgrade avait déjà réécrit ce commentaire). Ils sont repris **à la main avec le même remplacement**, ancre exacte qui échoue si absente. Le changement de `middleware.ts` (un commentaire) est porté sur `proxy.ts`.
- **8 fichiers nouveaux** copiés ; `src/infrastructure/providers/payment/notchpay/` et `src/app/api/webhooks/notchpay/` supprimés (`SUPPRIMES.txt`).
- Aucun `.rej` / `.orig` ne subsiste.

## 3. Ce qui est repris (détail : `RAPPORT_MIGRATION_FAPSHI.md`)

- **Provider Fapshi** : `payment/fapshi/{types,client,adapter,webhook-handler}.ts` + test ; route `/api/webhooks/fapshi` (vérification du secret `x-wh-secret` en temps constant).
- **Abstraction** : `payment/webhook-pipeline.ts` (rate limit, idempotence `webhook_events`, erreurs — partagés par tout futur provider) ; plus aucun nom de provider en dur dans `subscription-payment-service`, `addons-service`, `phone-number-rental-service` ; ligne locale créée **après** `createPayment()` avec la vraie référence (Fapshi génère la sienne) ; `handlePaymentWebhook()` ne prend plus qu'une `string`.
- **Migration `0066`** : supprime le `CHECK (provider in ('notchpay'))` de `subscription_payments` (idempotente : `drop constraint if exists` ; le nom `subscription_payments_provider_check` correspond bien à la contrainte de `0019`), défaut `'fapshi'`.
- `env.ts` / `.env.example` (`FAPSHI_API_USER`, `FAPSHI_API_KEY`, `FAPSHI_WEBHOOK_SECRET`, `FAPSHI_BASE_URL`, `PAYMENT_PROVIDER_DEFAULT=fapshi`), `registry.ts`, `secrets-resolver.ts`, `docs/PAYMENT_INTEGRATION.md`, CGU et politique de confidentialité (le prestataire de paiement nommé est maintenant Fapshi), pages dashboard abonnement / add-ons / canaux, cron de réconciliation, `seed-demo.ts`.

## 4. Retouches faites ici, en plus du changeset

| Fichier | Pourquoi |
|---|---|
| `src/lib/rate-limit.ts` | Le paragraphe réécrit cite `/api/webhooks/fapshi` et `zernio`, et ne dit plus que le proxy tourne en Edge (faux depuis Next 16 — voir #18 §4 n°11) |
| `src/proxy.ts` | Port du commentaire du changeset (`/api/webhooks/fapshi/route.ts` via `webhook-pipeline.ts`) |
| `docs/DEPLOYMENT.md` (§3bis, §4ter, checklist) | Le changeset ne le couvrait pas et il donnait encore `NOTCHPAY_WEBHOOK_SECRET` et l'URL `/api/webhooks/notchpay` : instructions de déploiement fausses. Réécrit pour Fapshi |
| `country-waitlist-actions.ts`, `addons-service.ts` | Commentaires pointant vers un fichier supprimé / un prestataire remplacé |

## 5. Vérification

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` | 0 erreur |
| `npm run lint` | 0 erreur, 30 avertissements (identique à #18) |
| `npm test` | **857 réussis / 0 échoué** (72 fichiers) |
| `npm run build` (Next 16.3.5) | OK, 82/82 pages ; `/api/webhooks/fapshi` présent, `/api/webhooks/notchpay` absent |
| `package.json` / `package-lock.json` | inchangés par rapport à #18 (aucune dépendance ajoutée) |

Écart de tests 861 → 857, expliqué **exactement** : le `webhook-handler.test.ts` de NotchPay (10 tests) est supprimé avec son module, celui de Fapshi (6 tests) est ajouté ; les tests de `subscription-payment-service` et `addons-service` (réécrits par le changeset) gardent le même nombre. Le changeset annonçait n'avoir pu lancer ni typecheck ni tests — c'est fait ici. Build : même méthode que #18 (copie jetable, polices stubées, identifiants Supabase factices).

## 6. Non vérifié / risques

- **Le code Fapshi n'a jamais tourné contre l'API réelle** (ni chez l'auteur, ni ici). Endpoints, en-têtes (`apiuser`, `apikey`), `x-wh-secret` et statuts viennent de la documentation consultée par l'auteur ; je ne les ai pas revérifiés.
- Aucun test unitaire sur `webhook-pipeline.ts`, la route, le client ou l'adapter (seul `webhook-handler.test.ts` existe, 6 tests).
- **Idempotence par `transId` seul** : si Fapshi envoie plusieurs webhooks pour une même transaction avec des statuts différents, les suivants sont ignorés comme doublons ; le cron de réconciliation reste le filet de sécurité.
- **Paiement « fantôme »** (déjà noté par l'auteur) : si l'appel `initiate-pay` aboutit chez Fapshi mais que la réponse est perdue, aucune ligne locale n'existe et la réconciliation ne peut pas le rattraper.
- **Contenu juridique** : les CGU et la politique de confidentialité désignent désormais Fapshi ; à faire valider avant déploiement (les CGU contiennent encore des `[À COMPLÉTER]` hérités).
- **Country Engine inchangé** (décision produit laissée ouverte par l'auteur, `RAPPORT_MIGRATION_FAPSHI.md` §« Points ouverts » n°1) : la colonne `countries.notchpay_supported`, `notchpay-resources-service`, les écrans `/admin/countries` et 42 autres fichiers hors rapports (Country Engine, docs, migrations SQL historiques, tests) mentionnent encore NotchPay. Fapshi ne traite que le XAF : NG / GH / CI / SN / GA / KE / UG n'ont plus de prestataire réel.
- `docs/DATABASE.md`, `AFFILIATE_SYSTEM.md`, `PRICING_MODEL.md`, `MVP_SCOPE.md`, `GAP_ANALYSIS.md`, `internationalization.md` : mentions descriptives de NotchPay non mises à jour.

## 7. À faire avant déploiement

1. **Variables Vercel et `.env.local`** : retirer `NOTCHPAY_API_KEY` / `NOTCHPAY_WEBHOOK_SECRET`, ajouter `FAPSHI_API_USER`, `FAPSHI_API_KEY`, `FAPSHI_WEBHOOK_SECRET` et **`PAYMENT_PROVIDER_DEFAULT=fapshi`**. Si `notchpay` y reste, `env.ts` fait échouer le démarrage (voulu, fail fast).
2. **Exécuter `0066`**, puis vérifier que la contrainte a disparu :
   `select conname from pg_constraint where conrelid = 'subscription_payments'::regclass and contype = 'c';` (aucune ligne `..._provider_check`).
3. **Webhook** : dans le dashboard Fapshi, URL `https://<domaine>/api/webhooks/fapshi` ; le secret n'est affiché qu'à la création.
4. **Sandbox d'abord** (`FAPSHI_BASE_URL=https://sandbox.fapshi.com`) : un paiement complet abonnement, un add-on, un numéro dédié, un échec, une expiration ; puis `https://live.fapshi.com`.
5. Faire valider CGU / confidentialité, et trancher le sort du Country Engine.
6. Les points à faire de `RAPPORT_FUSION_18.md` §8 restent valables (Upstash, Node ≥ 20.9, `0065`, `npm audit`…).

Livré en zip du projet complet (`node_modules`, `.next` et `tsconfig.tsbuildinfo` exclus), fichiers à la racine de l'archive. Reproduire : `npm ci && npm run typecheck && npm run lint && npm test && npm run build`.

## Annexe — fichiers touchés par rapport à la fusion #18

### Ajoutés (10)

- `RAPPORT_FUSION_19.md`
- `RAPPORT_MIGRATION_FAPSHI.md`
- `src/app/api/webhooks/fapshi/route.ts`
- `src/infrastructure/providers/payment/fapshi/adapter.ts`
- `src/infrastructure/providers/payment/fapshi/client.ts`
- `src/infrastructure/providers/payment/fapshi/types.ts`
- `src/infrastructure/providers/payment/fapshi/webhook-handler.test.ts`
- `src/infrastructure/providers/payment/fapshi/webhook-handler.ts`
- `src/infrastructure/providers/payment/webhook-pipeline.ts`
- `supabase/migrations/0066_fapshi_payment_provider.sql`

### Modifiés (24)

- `.env.example`
- `docs/DEPLOYMENT.md`
- `docs/PAYMENT_INTEGRATION.md`
- `scripts/seed-demo.ts`
- `src/app/_components/country-waitlist-actions.ts`
- `src/app/api/cron/process-payment-reconciliation/route.ts`
- `src/app/cgu/page.tsx`
- `src/app/confidentialite/page.tsx`
- `src/app/dashboard/addons/page.tsx`
- `src/app/dashboard/channels/page.tsx`
- `src/app/dashboard/subscription/page.tsx`
- `src/application/services/addons-service.test.ts`
- `src/application/services/addons-service.ts`
- `src/application/services/affiliate-payout-service.ts`
- `src/application/services/auth-service.ts`
- `src/application/services/phone-number-rental-service.ts`
- `src/application/services/subscription-payment-service.test.ts`
- `src/application/services/subscription-payment-service.ts`
- `src/domain/ports/payment-provider.ts`
- `src/infrastructure/providers/registry.ts`
- `src/infrastructure/providers/secrets-resolver.ts`
- `src/lib/env.ts`
- `src/lib/rate-limit.ts`
- `src/proxy.ts`

### Supprimés (6)

- `src/app/api/webhooks/notchpay/route.ts`
- `src/infrastructure/providers/payment/notchpay/adapter.ts`
- `src/infrastructure/providers/payment/notchpay/client.ts`
- `src/infrastructure/providers/payment/notchpay/types.ts`
- `src/infrastructure/providers/payment/notchpay/webhook-handler.test.ts`
- `src/infrastructure/providers/payment/notchpay/webhook-handler.ts`
