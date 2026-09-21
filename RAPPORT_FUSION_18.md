# Rapport de fusion #18 — `thrive-main` (fusion #17) + patch SEO + branche « V9–V15 / dépendances / sécurité » (v16)

Fait suite à `RAPPORT_FUSION_17.md`. Date : 20 septembre 2026.

## 1. Sources reçues et leur relation

| Archive | Contenu | Relation |
|---|---|---|
| `thrive-main__13_.zip` (**T**) | Projet complet, 581 fichiers, migrations jusqu'à `0065`, `RAPPORT_FUSION_17` (B + C) | **Base** : la branche la plus avancée côté messagerie / Telegram / Zernio |
| `cresyva-fusionne_2_.zip` (**F**) | Projet complet, 578 fichiers, migrations jusqu'à `0065`, un *autre* `RAPPORT_FUSION_17` | Version parallèle et plus ancienne (12:30 contre 13:35) de la même fusion #17. **Aucun fichier absent de T** ; T en a 3 de plus. Sur 22 fichiers qui diffèrent, T est la version aboutie (décision « pas de bouton vers les groupes WhatsApp » de #17 §4.2, migration `0065` idempotente, boutons Telegram sur le chemin téléversement, tests de verrouillage). **Seuls 3 fichiers de tests** ne sont corrigés que dans F |
| `Cresyva-CRESYVA-dependency-security-upgrade-v16.zip` (**U**) | Projet complet, 615 fichiers, migrations jusqu'à `0063` | Branche « A » de #17 (multi-numéros v7 — déduit des dates, ancêtre non fourni) + polish V9→V15 (templates sectoriels, Site Builder) + migration de dépendances + 3 correctifs de sécurité. **N'a rien de** : Lot 5, `0064`, `0065`, `RAPPORT_FUSION_14b/17` |
| `files__21_.zip` → `seo-patch.diff` + `seo-patch.zip` (**S**) | Diff de 30 fichiers + image OG | Écrit contre T (mêmes dates 13:35). `patch -p1` s'applique **sans aucun rejet**, et le résultat est identique, fichier par fichier, au contenu de `seo-patch.zip` |
| `CRESYVA_SECURITY_DEPENDENCY_AUDIT_2026-09-20.docx` | Rapport d'audit | Identique (`cmp`) à celui déjà présent dans U : conservé **tel quel** (voir §5.8) |

## 2. Méthode

- **Base = T.** L'ancêtre commun de T et U n'est pas fourni : même technique que #17, les **dates de modification des fichiers de U**. Dans U, tout ce qui porte 02:35→03:37 est l'état de l'ancêtre ; les fichiers datés du 20/09 **à partir de 12:46** sont le travail propre de U (V9→V16).
- Croisement avec ce que T a changé depuis l'ancêtre (les 14 fichiers du Lot 5, `RAPPORT_LOT_5.md` §5, et les 20 modifiés / 6 ajoutés de #17 §9) : **un seul fichier est touché des deux côtés**, `resolve-request-tenant.ts` (T : +50 lignes `getTenantPublicOrigin` ; U : un commentaire ; S : +70 lignes). `next.config.mjs` et `robots.ts` sont identiques à l'ancêtre dans T : les changements de U (retrait de `eslint`, commentaires) et de S (en-têtes `X-Robots-Tag`, surfaces) sont indépendants et **cumulés**.
- Le reste de U est repris **fichier par fichier**, uniquement là où T = ancêtre. Jamais de `cp` en masse ailleurs.
- Chaque édition à la main utilise une ancre exacte qui **échoue** si elle n'est pas trouvée une seule fois.
- Ordre : T → patch S → delta de U → 3 tests de F → correctifs de compatibilité (§4) → `npm install` → typecheck / lint / tests / build (§6).

## 3. Repris de chaque source

### 3.1 De T (base)
Fusion #17 complète : Lot 5 (commentaires temps réel), multi-numéros WhatsApp, liens produit sur le domaine réel du tenant, boutons « Voir plus » Telegram, migrations `0064` et `0065`, `CHECK_MIGRATIONS_0062_0065.sql`.

### 3.2 De U
1. **Polish V9→V15** : `sector-home.tsx` (nouveau), `tenant-landing.tsx`, `storefront-shell.tsx`, `dashboard/site/page.tsx`, `storefront-blueprint.ts`, ~560 lignes de CSS sectoriel dans `globals.css`, 33 images SVG (`public/images/demo/*` ×24, `public/images/tenant-*` ×9), 8 notes (`BOUTIQUE_TEMPLATE_V9.md` … `V15_SECTOR_POLISH.md`, `SITE_BUILDER_V12.md`, `LANDING_*`). `storefront-header.tsx` était déjà identique dans T.
2. **Sécurité (3 failles d'isolation multi-tenant)** : `track-click-action.ts`, `track-product-click-action.ts`, `booking-actions.ts` résolvent le tenant depuis le hostname, plus jamais depuis le navigateur ; identifiant produit strictement UUID ; nouveau limiteur `public_analytics` (120 événements / minute / IP) dans `rate-limit.ts`.
3. **Dépendances / framework** : `package.json` (Next 16.3.5, React 19.3.0, Zod 4.6.5, Tailwind 4.3.3, Vitest 5.0.1…), `src/proxy.ts` (ex-`middleware.ts`) et `middleware.test.ts`, retrait de l'option `eslint` de `next.config.mjs`, ESLint « flat config », Tailwind 4 (`@import "tailwindcss"` + `@config` + `@tailwindcss/postcss`), `z.record(z.string(), z.unknown())` ×3.
4. Le renommage `middleware.ts` → `proxy.ts` dans les commentaires de `RAPPORT_FUSION_6/7` et `RAPPORT_LOT_H`.

**Non repris de U** : `DEPENDENCY_INSTALL_REQUIRED.md` (obsolète : le `package-lock.json` est maintenant fourni) et son `.env.example` (T garde `scholarmach.com`, voir §5.6).

### 3.3 De S
Les 30 fichiers du patch et `public/images/og-cresyva.png`. Seule retouche : `docs/SEO.md` et les commentaires de `robots.ts` / `resolve-request-tenant.ts` parlent désormais de `src/proxy.ts`.

### 3.4 De F
- Les 3 fichiers de tests corrigés : `admin-plans-service.test.ts`, `team-service.test.ts`, `marketing-service.test.ts` — exactement les fichiers des « 7 tests rouges » de #17 §5.
- Son `RAPPORT_FUSION_17.md`, qui documente pourquoi ces tests étaient périmés, est conservé sous `RAPPORT_FUSION_17b_LOT5_MULTINUMEROS_TESTS.md` (même précédent que `14b`).

## 4. Défauts de la branche U trouvés à l'exécution — tous corrigés

L'audit de U n'avait ni installé les dépendances ni lancé de build (« aucune affirmation de build vert »). Les lancer a révélé :

| # | Constat | Preuve | Correctif |
|---|---|---|---|
| 1 | `@tailwindcss/postcss` **absent** de `package.json` | `postcss.config.js` l'exige ; l'audit §7 le dit « ajouté » | Ajouté (`4.3.3`) |
| 2 | TypeScript 7 a **supprimé `baseUrl`** | `error TS5102` | Retiré de `tsconfig.json` (les `paths` `@/*` fonctionnent sans) |
| 3 | TypeScript 7 **n'expose plus d'API JavaScript** | `npm run lint` : « typescript-eslint does not support TS 7.0 » ; `no-redirect-in-try-catch.test.ts` (test AST) → 43 erreurs de typecheck, presque toutes dans ce fichier | Montage « side-by-side » officiel, voir §5.1 |
| 4 | **ESLint 10** incompatible avec `eslint-config-next@16.3.5` | `TypeError: context.getFilename is not a function` (`eslint-plugin-react@7.37.5`, dernière version, déclare `eslint ^9.7`) | ESLint **9.39.5**, voir §5.2 |
| 5 | Namespace global `JSX` supprimé des types React 19 | TS2503 ×4 (`brand-icons`, `storefront-icons`, `admin/_components/sidebar`, `dashboard-nav`) | `import type { JSX } from "react"` |
| 6 | `sector-home.tsx:352` — index possiblement `undefined` (`noUncheckedIndexedAccess`) | TS2532 | `demoServices[index % n].image` → `service.image` (même valeur dans le `map`) |
| 7 | `service-worker-register.tsx:90` — `Uint8Array<ArrayBufferLike>` refusé par `BufferSource` | TS2322 | `urlBase64ToUint8Array` renvoie un `Uint8Array<ArrayBuffer>` (même contenu) |
| 8 | Lint : 14 × `react/no-unescaped-entities` (`sector-home.tsx`) et 2 × `no-html-link-for-pages` | ESLint | `&apos;` ; `<Link>` dans `admin/countries/[code]/page.tsx` et `dashboard/channels/page.tsx` |
| 9 | 2 tests périmés par le polish V15 | `storefront-service.test.ts` : la promesse « Délais annoncés » est devenue « Prochaines étapes visibles » ; « Visite organisée » (icône `headset`) est devenue « Organiser une visite » (icône `calendar`) | Tests mis à jour ; **l'intention est conservée** (une promesse partageant une icône ne doit pas hériter de la dépendance d'une autre) |
| 10 | `tsconfig.json` réécrit par Next 16 à chaque build | Message du build : `jsx` → `react-jsx` (obligatoire), `include` + `.next/dev/types/**/*.ts` | Les deux changements sont commités : le build ne modifie plus le fichier |
| 11 | Commentaire de `proxy.ts` : « tourne en Edge Runtime » | Documentation livrée avec Next 16 : « Proxy defaults to using the Node.js runtime » | Commentaire réécrit (le rate limiting reste hors du proxy, pour une autre raison — §5.7) |

## 5. Décisions non triviales

### 5.1 TypeScript : `tsc` 7.0.2 **et** API TypeScript 6
TypeScript 7.0.2 est le compilateur natif (Go) : son paquet n'exporte que la version, aucune API de programmation (annoncée pour 7.1). `typescript-eslint`, Next (vérification de types du build) et le test AST du projet en ont besoin. Retenu, comme recommandé par Microsoft pour TS 7 :

```json
"typescript": "npm:@typescript/typescript6@6.0.2",
"@typescript/native": "npm:typescript@7.0.2"
```

`typescript` (importé par les outils) résout donc vers l'API TS 6 ; `tsc` (script `typecheck`) est le binaire natif TS 7. Le dépôt garde la cible de l'audit (TS 7.0.2) pour le typecheck. **Retirer l'alias** quand `typescript-eslint` supportera l'API de TS ≥ 7.1.

### 5.2 ESLint 9.39.5 au lieu de 10.11.0
Aucune version d'`eslint-plugin-react` (embarqué par `eslint-config-next`) ne supporte ESLint 10 aujourd'hui. `eslint-config-next@16.3.5` accepte `eslint >= 9`. ⚠ npm affiche « eslint@9.39.5: This version is no longer supported » : c'est un compromis assumé, à lever dès qu'`eslint-plugin-react` supporte ESLint 10.

### 5.3 Règles « React Compiler » en avertissement
`eslint-config-next@16` active les règles d'`eslint-plugin-react-hooks` v7. Elles signalent 16 endroits qui **fonctionnent** aujourd'hui ; les corriger = refactorer des composants sans pouvoir les exécuter ici. Laissées **visibles en avertissement** dans `eslint.config.mjs`, avec un commentaire :

- `set-state-in-effect` ×7 : `promotion-deadline-field.tsx:29`, `storefront-header.tsx:45`, `install-app-banner.tsx:73`, `notification-watcher.tsx` (×2), `push-toggle.tsx:40`, `domain-search-field.tsx:28`
- `purity` ×4 (`Date.now()` au rendu) : `dashboard/analytics/page.tsx:12`, `omnichannel-publication-composer.tsx` (×2), `telegram-publication-composer.tsx:89`
- `error-boundaries` ×4 : `invite/accept/page.tsx` (JSX dans un `try/catch` de Server Component)
- `immutability` ×1 : `app-charts.tsx:117`

Les paramètres préfixés `_` (convention du projet pour une signature imposée) sont exclus de `no-unused-vars`.

### 5.4 Tailwind 4 : apparence v3 conservée, pas de « grand nettoyage »
La migration de U est volontairement progressive (`@config` conservé). Ajouté en tête de `globals.css`, d'après le guide de migration officiel : `border-color: var(--color-gray-200)` par défaut (v4 passe à `currentColor`) et `cursor: pointer` sur les boutons. Vérifié dans le CSS produit (`--color-gray-200:#e5e7eb`). **Non traité** : `outline-none` (31 usages), `shadow-sm` (4) et `rounded` nu (7) ont changé de sens en v4 ; l'outil `npx @tailwindcss/upgrade` n'a pas été lancé.

### 5.5 Tests périmés : lesquels sont réécrits, et pourquoi
- **`storefront-service.test.ts` (2)** : périmés par un changement volontaire de U (textes du blueprint) — mis à jour (§4 #9).
- **`admin-plans`, `team-service`, `marketing-service` (7 tests)** : les tests de F reflètent le comportement *actuel et délibéré* du code (clé d'entitlement jamais configurée = fail-closed à `0` ; quota par plateforme ; garde-fou du quota à la connexion du compte) — argumentaire complet dans `RAPPORT_FUSION_17b_…md`. #17 avait préféré ne pas les toucher (« trancher des questions produit ») ; ils sont adoptés ici parce que F les avait déjà tranchés **de la même manière que le code**. Si le produit veut l'autre sémantique, on change code **et** tests ensemble. Le point de vigilance de #17 §5 reste ouvert : l'aperçu admin (0 pour une clé absente) et `getEntitlementLimit` (-1 = illimité) n'ont pas la même sémantique.

### 5.6 `scholarmach.com` conservé (héritage de #17 §4.5)
`.env.example` et `VAPID_SUBJECT` gardent `scholarmach.com` (celui de U disait `cresyva.app`). **Toujours à valider** : deux lignes à remettre si ce n'est pas le bon domaine.

### 5.7 Rate limiting toujours hors du proxy
Sous Next 16, `proxy.ts` s'exécute en Node.js : la contrainte technique d'Upstash en Edge a disparu. La raison de fond reste (une défaillance dans le proxy bloquerait toutes les requêtes) ; le limiteur reste dans les route handlers et Server Actions.

### 5.8 Audit `.docx` / `.md`
Le `.docx` est un instantané historique : **non modifié**, il dit encore TS 7.0.2 / ESLint 10.11.0 / « @tailwindcss/postcss ajouté ». Un erratum a été ajouté en tête de `SECURITY_DEPENDENCY_AUDIT_2026-09-20.md` (et les marqueurs de citation parasites `citeturn…` en ont été retirés) ; `package.json` fait foi.

### 5.9 Tests de non-régression des 3 failles
`src/app/_components/public-tenant-actions.test.ts` (11 tests) rejoue le scénario de l'audit : requête sur le tenant A, identifiant du tenant B fourni. Vérifié dans les deux sens : **10 échecs sur 11 contre le code de `thrive-main`**, 11 réussites contre le code fusionné (le onzième cas — identifiant identique au tenant résolu — est légitime dans les deux versions).

## 6. Vérification

Exécutée sur une **copie propre** de l'arbre livré (`npm ci`, comme la CI), Node 22.22.2 / npm 10.9.7.

| Contrôle | Résultat |
|---|---|
| `npm ci` | OK — 469 paquets (le `package-lock.json` est régénéré et fourni) |
| `npm run typecheck` (`tsc` 7.0.2) | **0 erreur** |
| `npm run lint` (ESLint 9.39.5) | **0 erreur**, 30 avertissements : 16 règles React Compiler (§5.3), 12 `no-unused-vars` réels, 1 `no-img-element` (préexistant, #17 §5), 1 directive `eslint-disable` inutilisée |
| `npm test` | **861 réussis / 0 échoué** (72 fichiers) |
| `npm run build` (Next 16.3.5, Turbopack) | **OK, 82/82 pages** ; `ƒ Proxy (Middleware)` reconnu |
| `npm audit` | **0 vulnérabilité** (603 dépendances) |
| Routes (`page.tsx` + `route.ts` + `robots` + `sitemap`) | 97 dans T, 97 ici — aucune perdue |

Repères : #17 avait 736 réussis / 7 échoués (B témoin) puis 758 / 7 (fusion). Ici 861 / 0 : les 7 rouges passent (§5.5), +11 tests d'isolation (§5.9), le reste vient essentiellement du patch SEO (et U n'a ajouté aucun fichier de test).

Le build a été fait dans une **copie jetable avec `next/font/google` stubbé** (réseau bloqué) et des identifiants Supabase factices — comme en #17, et comme le fait la CI (`ci-placeholder`). Les `fetch failed` des logs de prérendu sont attendus. `layout.tsx` et `fonts.ts` livrés sont intacts.

## 7. Non vérifié

- **Aucune exécution** contre un vrai Supabase, Telegram, Zernio ou WhatsApp ; aucune migration rejouée.
- `test:e2e` (Playwright) et `test:integration` (Supabase) **non exécutés**.
- **Rendu visuel Tailwind 4** non comparé avant/après (§5.4) — à faire sur les 5 vitrines sectorielles, la landing, le dashboard et l'admin.
- `next/font/google` réel non exécuté ; build testé en Node 22 (le minimum déclaré est 20.9).
- Comportement SEO en conditions réelles (robots.txt / sitemap par hôte, domaines custom) et **Zod 4** sur des données réelles (v4 durcit plusieurs validateurs, dont `uuid()`).
- Les Server Actions sont testées avec des mocks, pas avec un vrai hostname.

## 8. À faire avant mise en production

1. **Appliquer `0065`** ; exécuter `supabase/CHECK_MIGRATIONS_0062_0065.sql` (voir #17 §7).
2. **Configurer Upstash** (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) : sans elles, tous les rate limits — dont le nouveau `public_analytics` — laissent tout passer.
3. **Node.js ≥ 20.9** dans les réglages du projet Vercel ; vérifier le premier déploiement (vraies polices).
4. `npm run test:e2e`, puis le test manuel « tenant A / ID du tenant B » avec un vrai hostname.
5. Contrôle visuel Tailwind 4 (§5.4).
6. Confirmer `scholarmach.com` (§5.6). Ajouter au webhook Zernio les événements du Lot 5 (#17 §7).
7. Décider du sort des 16 avertissements React Compiler (§5.3) et de la sémantique 0 / -1 des entitlements (§5.5).
8. Rejouer `npm audit` avant chaque mise en production.

## 9. Points ouverts hérités (non traités ici)

- De #17 §8 : routage des messages reçus sur un numéro WhatsApp secondaire ; page `/tarifs` (« réponse automatique aux commentaires ») vs comportement réel ; entitlements `*_auto_comments` ; `switchToFreePlan`.
- De l'audit de U §5 (toujours ouverts) : CSP avec `'unsafe-inline'` (+ `dangerouslySetInnerHTML` JSON-LD), dépendance large à `service_role` (fonctions de haut niveau qui valident le tenant), `/api/health` public, `host` utilisé pour les URLs canoniques, token Telegram dans l'URL (journalisé en clair pour un token inconnu), validation par magic bytes des pièces jointes Telegram.
- Nettoyages non bloquants : Vitest signale que `vite-tsconfig-paths` est désormais natif (`resolve.tsconfigPaths`) et que `vitest.config.ts` est chargé en CJS ; un test journalise « No "getNotificationProvider" export … registry mock » (message, pas un échec ; non investigué).

## 10. Fichiers

Base : `thrive-main` (581 fichiers) → **638 fichiers**. **58 modifiés**, **27 ajoutés** (dont ce rapport et `RAPPORT_FUSION_17b`) + 33 images SVG, **3 supprimés** (`src/middleware.ts` → `src/proxy.ts`, `tailwind.config.ts` → `tailwind.config.js`, `.eslintrc.json` → `eslint.config.mjs`), `package-lock.json` régénéré. Aucun fichier de U, T ou F perdu hors de ces remplacements et de `DEPENDENCY_INSTALL_REQUIRED.md` (§3.2). Liste complète en annexe.

Livré en zip du projet complet (`node_modules`, `.next` et `tsconfig.tsbuildinfo` exclus), fichiers à la racine de l'archive comme `cresyva-fusionne_2_.zip`. Pour reproduire : `npm ci && npm run typecheck && npm run lint && npm test && npm run build`.

## Annexe — liste des fichiers

### Modifiés par rapport à `thrive-main` (58)

- `RAPPORT_FUSION_6.md`
- `RAPPORT_FUSION_7.md`
- `RAPPORT_LOT_H.md`
- `README.md`
- `docs/DEPLOYMENT.md`
- `docs/SECURITY.md`
- `next.config.mjs`
- `package-lock.json`
- `package.json`
- `postcss.config.js`
- `src/app/(site)/_lib/storefront-page.ts`
- `src/app/(site)/categories/[slug]/page.tsx`
- `src/app/(site)/contact/page.tsx`
- `src/app/(site)/faq/page.tsx`
- `src/app/(site)/produits/[slug]/page.tsx`
- `src/app/(site)/produits/page.tsx`
- `src/app/(site)/promotions/page.tsx`
- `src/app/(site)/services/[slug]/page.tsx`
- `src/app/_components/app-icons.tsx`
- `src/app/_components/brand-icons.tsx`
- `src/app/_components/landing-sections/booking-actions.ts`
- `src/app/_components/service-worker-register.tsx`
- `src/app/_components/storefront/storefront-icons.tsx`
- `src/app/_components/storefront/storefront-shell.tsx`
- `src/app/_components/tenant-landing.tsx`
- `src/app/_components/track-click-action.ts`
- `src/app/_components/track-product-click-action.ts`
- `src/app/admin/_components/sidebar.tsx`
- `src/app/admin/countries/[code]/page.tsx`
- `src/app/api/webhooks/notchpay/route.ts`
- `src/app/cgu/page.tsx`
- `src/app/confidentialite/page.tsx`
- `src/app/dashboard/_components/dashboard-nav.tsx`
- `src/app/dashboard/channels/page.tsx`
- `src/app/dashboard/site/page.tsx`
- `src/app/devenir-affilie/page.tsx`
- `src/app/fonts.ts`
- `src/app/globals.css`
- `src/app/mentions-legales/page.tsx`
- `src/app/page.tsx`
- `src/app/robots.ts`
- `src/app/sitemap.ts`
- `src/app/tarifs/page.tsx`
- `src/application/config/storefront-blueprint.ts`
- `src/application/services/admin-plans-service.test.ts`
- `src/application/services/marketing-service.test.ts`
- `src/application/services/storefront-service.test.ts`
- `src/application/services/team-service.test.ts`
- `src/domain/entities/contact.ts`
- `src/domain/entities/conversation.ts`
- `src/domain/entities/landing.ts`
- `src/infrastructure/tenant/resolve-request-tenant.ts`
- `src/lib/rate-limit.ts`
- `src/lib/seo.test.ts`
- `src/lib/seo.ts`
- `src/lib/tenant-branding.ts`
- `src/middleware.test.ts`
- `tsconfig.json`

### Ajoutés (hors images SVG) (27)

- `BEAUTY_TEMPLATE_V10.md`
- `BOUTIQUE_TEMPLATE_V9.md`
- `CRESYVA_SECURITY_DEPENDENCY_AUDIT_2026-09-20.docx`
- `LANDING_AUDIT_V13.md`
- `LANDING_REFERENCE_REWORK_V14.md`
- `PROFESSIONAL_SERVICES_TEMPLATE_V11.md`
- `RAPPORT_FUSION_17b_LOT5_MULTINUMEROS_TESTS.md`
- `RAPPORT_FUSION_18.md`
- `SECURITY_DEPENDENCY_AUDIT_2026-09-20.md`
- `SITE_BUILDER_V12.md`
- `V15_SECTOR_POLISH.md`
- `docs/SEO.md`
- `eslint.config.mjs`
- `public/images/og-cresyva.png`
- `src/app/_components/json-ld.tsx`
- `src/app/_components/public-tenant-actions.test.ts`
- `src/app/_components/sector-home.tsx`
- `src/app/_lib/marketing-page.ts`
- `src/app/signup/layout.tsx`
- `src/application/config/legal-entity.test.ts`
- `src/application/config/legal-entity.ts`
- `src/application/services/sitemap-service.ts`
- `src/lib/no-raw-json-ld.test.ts`
- `src/lib/request-surface.test.ts`
- `src/lib/request-surface.ts`
- `src/proxy.ts`
- `tailwind.config.js`

### Images SVG ajoutées

`public/images/demo/*.svg` (24) et `public/images/tenant-*.svg` (9), reprises de U.

### Supprimés (3)

- `.eslintrc.json`
- `src/middleware.ts`
- `tailwind.config.ts`
