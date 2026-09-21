# Rapport du lot 21 — corrections, qualité et optimisation (fusion #21)

Fait suite à `RAPPORT_FUSION_20.md`. Date : 21 septembre 2026.

**Demande** : « corriger tout ceci, améliorer et optimiser le code ». Périmètre retenu : tous les points laissés ouverts par les rapports #18 → #20 qui pouvaient être **corrigés et mesurés depuis ce bac à sable**. Ce qui exige une décision de votre part, un vrai environnement ou une revue visuelle est listé au §7 — je ne l'ai pas maquillé.

## 1. Résultats mesurés

| Mesure | Avant (#20) | Après (#21) |
|---|---|---|
| Avertissements ESLint | 30 | **0** |
| Tests | 857 (72 fichiers) | **890** (76 fichiers, +33) |
| JS des composants client déclarés pour la page d'accueil `/` | 203 Ko bruts / 71 Ko gzip | **72 Ko / 24 Ko gzip** (≈ −65 %) |
| Images de démonstration (`public/images/showcase`) | 1 184 Ko | **504 Ko** (−57 %) |
| Requêtes COUNT de la page Produits (dashboard) | 4 | **3** |
| Bruit dans la sortie des tests | 4 erreurs journalisées | 0 |
| Alertes de démarrage de Vitest | 2 | 0 |
| `npm audit` | 0 | 0 |
| `typecheck` / `build` Next 16.3.5 | OK / OK (82 pages) | OK / OK (82 pages) |

Méthode de la ligne « JS » : liste `entryJSFiles` du manifeste client de la route `/` (`page_client-reference-manifest.js`), même méthode sur les deux builds. Le chunk de la carte (137 Ko bruts) n'y figure plus.

## 2. Corrections de code

### 2.1 Lint : 30 → 0, en traitant les causes

| Catégorie | Nb | Traitement |
|---|---|---|
| Variables / imports inutilisés | 12 | Supprimés (`auth-shell`, `mobile-nav`, `reset-password`, `affiliate-service`, `landing-config-service`, `youtube-channel-service`, `dashboard/page`, `dashboard/products/page`, `sector-home`, test `admin-countries`…). `AIStructuredRequest<TSchema>` → `<_TSchema>` (paramètre phantom, convention `_` du projet) |
| Directive `eslint-disable` inutile | 1 | Retirée (`tests/integration/tenant-isolation.test.ts`) |
| Règles React Compiler **corrigées à la source** | 7 | `storefront-header` (menu mobile fermé au changement de page **pendant le rendu**, sans effet) · `invite/accept/page` (plus de JSX dans un `try/catch` : le résultat est calculé d'abord, le rendu ensuite — comportement identique) · `app-charts` (décalages des arcs calculés sans mutation) · `domain-search-field` (résultat effacé dans le gestionnaire d'événement, pas dans l'effet) |
| Règles React Compiler **exemptées avec raison** | 9 | 5 × `set-state-in-effect` (lecture de `localStorage` / API navigateur / fuseau horaire / polling après montage : le seul moyen d'éviter un écart d'hydratation) et 4 × `purity` (`Date.now()` voulu à chaque rendu : « maintenant », `min` d'un `datetime-local`, fenêtre de 30 jours d'un Server Component). Exemptions **fichier par fichier** dans `eslint.config.mjs`, la raison écrite ; les règles restent en `warn` pour le code futur |
| `no-img-element` | 1 | Exemption documentée (vignette 64 px d'une URL produit arbitraire : `next/image` casserait sur un hôte inconnu) |

Les 7 corrections à la source (4 fichiers) touchent des composants que **je n'ai pas pu exécuter dans un navigateur** (le harnais de test est en environnement Node) : à parcourir à la main (menu mobile de la vitrine, page d'invitation, donut du dashboard, recherche de nom de domaine).

### 2.2 Tailwind 4 : apparence v3 rétablie, et accessibilité
Quatre utilitaires ont changé de sens en v4 (`outline-none`, `rounded`, `shadow-sm`, `backdrop-blur`…). Renommés par analyse syntaxique (AST), pas par regex aveugle : **50 classes dans 20 fichiers** + **5 jetons `@apply`** dans `globals.css` — `outline-none → outline-hidden` (33 dans les composants, ce qui rétablit aussi le contour de focus en mode contraste élevé), `rounded → rounded-sm` (7), `rounded-sm → rounded-xs` (2), `shadow-sm → shadow-xs` (4), `backdrop-blur → backdrop-blur-sm` (4) ; les 5 jetons `@apply` concernent `outline-none`, `rounded` et `shadow-sm`. Les nouvelles classes existent bien dans le CSS produit. **Rendu non comparé visuellement.**

### 2.3 Fapshi : 33 tests là où il n'y en avait presque pas (`#19 §6`)
`client` (8), `adapter` (12), `webhook-pipeline` (9), route `/api/webhooks/fapshi` (4). Ils verrouillent les hypothèses de conception : le `transId` est la clé d'idempotence, l'événement est **réservé avant** le traitement, les doublons (`23505`) ne retraitent pas le paiement, toute défaillance renvoie 200, un secret invalide 401, un corps illisible 400, devise ≠ XAF et montant < 100 refusés sans appel réseau. **Ils ne valident rien contre la vraie API Fapshi.**

### 2.4 Hygiène des tests
- `subscription-payment-service.test.ts` : le mock du registre n'exportait pas `getNotificationProvider` → 4 erreurs journalisées à chaque run. Corrigé.
- Vitest : plugin `vite-tsconfig-paths` remplacé par la résolution native (`resolve.tsconfigPaths`), configs passées en `.mts` (ESM), dépendance retirée du lockfile, script `test:integration` et `playwright.config.ts` mis à jour.

### 2.5 Vérifié, rien à corriger
- **Zod 4 et `uuid()`** : `z.string().uuid()` rejette les UUID « fabriqués » (`11111111-…`). Ils n'apparaissent que dans un fichier de test ; les identifiants de la base (`gen_random_uuid`, v4) passent. Aucun changement.
- **Polices** : déjà optimisées (`preload` limité aux paires par défaut, les 4 autres à la demande). Aucun changement.

## 3. Optimisations

1. **Carte « Disponible en Afrique » chargée à la demande** (`africa-availability-map-lazy.tsx`) : d3-geo + topojson + react-simple-maps + la topologie (~137 Ko bruts) étaient chargés et évalués sur la page d'accueil alors que la carte est bien plus bas. Elle est maintenant demandée quand la section approche de l'écran (marge 400 px), avec un cadre de même ratio (640 × 700) pour éviter tout décalage de mise en page. La liste des pays reste rendue côté serveur, hors du composant (rien de perdu pour le référencement). **Effet mesuré : §1. Non mesuré en navigateur (LCP / CLS).**
2. **Une requête de moins** à chaque affichage de la page Produits : le 4ᵉ COUNT (brouillons) alimentait une variable jamais lue.
3. **Images de démonstration : −680 Ko** (§4).

## 4. Images de démonstration (suite de `#20 §4`)

| Image | Traitement |
|---|---|
| `realestate-hero.jpg`, `restaurant-hero.jpg` | **Supprimées** : inutilisées et porteuses d'éléments incrustés (dont « 4,8/5 · +2 500 clients satisfaits ») |
| `realestate-story.jpg` | Slogan « Votre futur commence ici » **effacé** (retouche), marges retirées. Traces discrètes possibles dans le ciel |
| `restaurant-story.jpg` | Le bouton lecture incrusté ne s'effaçait pas proprement (bavure visible après trois méthodes). **Remplacée** par un recadrage propre de la même photo (haut droit, 372 × 298 px source, agrandi en 900 × 720 avec un léger renforcement) : plus douce, ambiance sans tables |
| 8 photos de cartes | Marges blanches, coins arrondis et restes de texte flouté **recadrés** ; JPEG recompressés (qualité 82, progressif) : ≈ −50 % chacune |
| **Code** `sector-home.tsx` + `globals.css` | Le composant dessinait **lui-même** un faux bouton ▶ + la légende « Découvrez notre restaurant » (un `<span>` sans aucune action) par-dessus l'image, en plus de celui de l'image. **Retirés**, ainsi que leurs 3 règles CSS. Décision de fond, à inverser si vous prévoyez une vraie vidéo |

⚠ **Origine et licence toujours non résolues** : ce sont des recadrages de visuels de référence tiers (note V17). La retouche n'y change rien. **Remplacez ces images par des photos dont vous détenez les droits avant la production** (mêmes noms de fichiers : aucun code à changer). Les originaux restent dans l'archive V19.

## 5. Vérification

Exécutée sur une **copie propre** (`npm ci`, Node 22.22.2) : typecheck 0 erreur · lint **0 alerte** · **890 tests réussis / 0 échoué** · `npm audit` 0 · build OK (82/82). La toute dernière retouche — retrait d'une règle CSS résiduelle du faux bouton — a été vérifiée par un nouveau build ; les tests n'ont pas été relancés pour cette seule ligne de CSS. Build : même méthode que #18 → #20 (copie jetable, polices stubées, identifiants Supabase factices). Reproduire : `npm ci && npm run typecheck && npm run lint && npm test && npm run build`.

## 6. Nouveaux fichiers

`src/app/_components/africa-availability-map-lazy.tsx` ; 4 fichiers de tests Fapshi (`fapshi/client.test.ts`, `fapshi/adapter.test.ts`, `webhook-pipeline.test.ts`, `api/webhooks/fapshi/route.test.ts`) ; `vitest.config.mts` et `vitest.integration.config.mts` (remplacent les `.ts`). Liste complète en annexe.

## 7. Ce qui n'est pas fait — et pourquoi

- **Licence des images** (§4) : décision et fichiers de votre côté.
- **Code Fapshi contre la vraie API**, hypothèse « un seul webhook par `transId` » (les suivants seraient ignorés ; le cron de réconciliation reste le filet), paiement « fantôme » si la réponse d'`initiate-pay` est perdue : nécessite un test en sandbox Fapshi.
- **Revue visuelle** : direction artistique V17 → V19, Tailwind 4, carte différée (LCP / CLS), les 4 fichiers modifiés au §2.1. Rien n'a été vu dans un navigateur ; `npm run test:e2e` et `test:integration` non exécutés.
- **Décisions produit ouvertes** : Country Engine (Fapshi = XAF seul), validation des CGU / confidentialité (`#19 §6`).
- **Outillage** : ESLint reste en 9.39.5 (npm le signale comme non supporté ; passer en 10 dès que `eslint-plugin-react` le supporte) et l'alias TypeScript 6 / 7 reste nécessaire tant que `typescript-eslint` ne supporte pas l'API de TS 7.
- **Sécurité, audit du 20/09 §5** : CSP `'unsafe-inline'`, `/api/health` public, jeton Telegram dans l'URL, validation des pièces jointes par octets magiques — des changements de conception, pas des corrections.
- **Performance côté serveur** (index SQL, requêtes N+1, temps de réponse) : impossible à auditer sans base ni trafic réels ; mesurer avec Lighthouse / Vercel Analytics sur un déploiement.
- Les points à faire de `#18 §8` et `#19 §7` restent valables (Upstash, Node ≥ 20.9, migrations `0065` / `0066`, variables Fapshi).

## Annexe — fichiers touchés par rapport à la fusion #20

### Ajoutés (8)

- `RAPPORT_FUSION_21.md`
- `src/app/_components/africa-availability-map-lazy.tsx`
- `src/app/api/webhooks/fapshi/route.test.ts`
- `src/infrastructure/providers/payment/fapshi/adapter.test.ts`
- `src/infrastructure/providers/payment/fapshi/client.test.ts`
- `src/infrastructure/providers/payment/webhook-pipeline.test.ts`
- `vitest.config.mts`
- `vitest.integration.config.mts`

### Modifiés (50)

- `eslint.config.mjs`
- `package-lock.json`
- `package.json`
- `playwright.config.ts`
- `public/images/showcase/demo/realestate-1.jpg`
- `public/images/showcase/demo/realestate-2.jpg`
- `public/images/showcase/demo/realestate-3.jpg`
- `public/images/showcase/demo/realestate-4.jpg`
- `public/images/showcase/demo/realestate-story.jpg`
- `public/images/showcase/demo/restaurant-1.jpg`
- `public/images/showcase/demo/restaurant-2.jpg`
- `public/images/showcase/demo/restaurant-3.jpg`
- `public/images/showcase/demo/restaurant-4.jpg`
- `public/images/showcase/demo/restaurant-story.jpg`
- `src/app/(site)/produits/page.tsx`
- `src/app/_components/app-charts.tsx`
- `src/app/_components/auth-shell.tsx`
- `src/app/_components/image-upload-field.tsx`
- `src/app/_components/landing-sections/booking-form.tsx`
- `src/app/_components/marketing-landing.tsx`
- `src/app/_components/sector-home.tsx`
- `src/app/_components/storefront/storefront-header.tsx`
- `src/app/admin/_components/mobile-nav.tsx`
- `src/app/admin/_components/topbar.tsx`
- `src/app/dashboard/_components/category-select.tsx`
- `src/app/dashboard/_components/topbar-actions.tsx`
- `src/app/dashboard/_components/topbar.tsx`
- `src/app/dashboard/analytics/landing/page.tsx`
- `src/app/dashboard/appointments/page.tsx`
- `src/app/dashboard/channels/page.tsx`
- `src/app/dashboard/marketing/omnichannel-publication-composer.tsx`
- `src/app/dashboard/marketing/page.tsx`
- `src/app/dashboard/marketing/telegram-publication-composer.tsx`
- `src/app/dashboard/page.tsx`
- `src/app/dashboard/products/[id]/edit/page.tsx`
- `src/app/dashboard/products/categories/page.tsx`
- `src/app/dashboard/products/csv-import-form.tsx`
- `src/app/dashboard/products/page.tsx`
- `src/app/dashboard/site/domain-search-field.tsx`
- `src/app/dashboard/site/page.tsx`
- `src/app/globals.css`
- `src/app/invite/accept/page.tsx`
- `src/app/reset-password/page.tsx`
- `src/application/services/admin-countries-service.test.ts`
- `src/application/services/affiliate-service.ts`
- `src/application/services/landing-config-service.ts`
- `src/application/services/subscription-payment-service.test.ts`
- `src/application/services/youtube-channel-service.ts`
- `src/domain/ports/ai-provider.ts`
- `tests/integration/tenant-isolation.test.ts`

### Supprimés (4)

- `public/images/showcase/demo/realestate-hero.jpg`
- `public/images/showcase/demo/restaurant-hero.jpg`
- `vitest.config.ts`
- `vitest.integration.config.ts`
