# CRESYVA — Audit dépendances, migration et sécurité

> **Mise à jour — fusion #18 (20 septembre 2026).** Ce rapport a été rédigé sans accès au registre npm
> (voir §6). La fusion #18 a exécuté pour de vrai `npm install`, `npm audit`, typecheck, lint, tests et
> build ; trois points de ce rapport se sont révélés inexacts ou incomplets :
>
> - `@tailwindcss/postcss` est annoncé « ajouté » (§1, §7) mais **manquait dans `package.json`** → ajouté (4.3.3).
> - **TypeScript 7.0.2** n'a pas d'API JavaScript : `typescript-eslint` plante (« does not support TS 7.0 »),
>   ainsi que le test AST `no-redirect-in-try-catch.test.ts`. `baseUrl` y est aussi supprimé. Retenu :
>   `typescript` = `npm:@typescript/typescript6@6.0.2` (API JS) + `@typescript/native` = `typescript@7.0.2`
>   (binaire `tsc` natif), montage « side-by-side » recommandé par Microsoft ; `baseUrl` retiré de `tsconfig.json`.
> - **ESLint 10.11.0** est incompatible avec `eslint-config-next@16.3.5` (`eslint-plugin-react@7.37.5`, dernière
>   version, plante : `context.getFilename is not a function`) → **ESLint 9.39.5**.
>
> `npm audit` : 0 vulnérabilité. Détail et autres correctifs (JSX React 19, `Uint8Array`, règles de lint, compat
> Tailwind 4, tests de non-régression des 3 failles) : `RAPPORT_FUSION_18.md`. Les lignes « Cible stable » de ce
> document décrivent l'intention de l'audit ; `package.json` fait foi.

**Date : 20 septembre 2026**  
**Base auditée : CRESYVA Sector Polish V15**  
**Objectif :** mettre les dépendances stables à jour, migrer les changements nécessaires et documenter les erreurs/failles détectées.

## 1. Résumé exécutif

La base était sur **Next.js 14.2.35 + React 18.3.1 + Tailwind 3.4.7 + TypeScript 5.4.5 + Zod 3.23.8**.

La cible stable actuelle retenue est :

- Next.js **16.3.5**
- React / React DOM **19.3.0**
- Supabase JS **2.116.0**
- Supabase SSR **0.12.7**
- Tailwind CSS **4.3.3** + `@tailwindcss/postcss` **4.3.3**
- Zod **4.6.5**
- TypeScript **7.0.2**
- ESLint **10.11.0** + `eslint-config-next` **16.3.5**
- Vitest **5.0.1**
- Playwright **1.63.0**
- tsx **4.23.13**
- Autoprefixer supprimé car Tailwind v4 gère désormais le préfixage via son pipeline CSS.

Les versions stables des paquets qui n'ont pas de nouvelle version pertinente ont été conservées : `d3-geo 3.1.1`, `topojson-client 3.1.0`, `react-simple-maps 5.0.5`, `papaparse 5.7.0`, `web-push 3.6.7`, etc.

## 2. Sources de versionnement

Les versions ont été vérifiées sur les sources officielles / npm :

- Next.js 16.3.5 est la version `latest` publiée sur npm. Next.js 16 impose Node.js 20.9+ et retire `next lint`.
- React 19.3.0 et React DOM 19.3.0 sont les versions stables actuelles.
- Supabase JS 2.116.0 et SSR 0.12.7 sont les versions stables publiées.
- Tailwind CSS 4.3.3 est `latest`; le plugin PostCSS dédié est `@tailwindcss/postcss` 4.3.3.
- Zod 4.6.5 est `latest`.
- TypeScript 7.0.2 est `latest`.
- ESLint 10.11.0 est `latest`; Next recommande désormais la configuration flat ESLint.
- Vitest 5.0.1 est `latest`; Playwright Test 1.63.0 est `latest`.
- Autoprefixer 10.6.1 est `latest`, mais il a été retiré du projet car Tailwind v4 indique que le préfixage fournisseur est désormais géré automatiquement.

## 3. Changements de code effectués

### Next.js 16

- `src/middleware.ts` → `src/proxy.ts`
- `middleware()` → `proxy()`
- tests du middleware adaptés.
- suppression de l'option `eslint` obsolète dans `next.config.mjs`.
- script `lint` migré vers `eslint .`.
- ajout de `eslint.config.mjs` en flat config avec Next Core Web Vitals + règles TypeScript.
- moteur Node minimum passé à `>=20.9.0`.

Next.js 16 documente explicitement le passage à Node 20.9+, la suppression de `next lint`, Turbopack par défaut et la migration de `middleware` vers `proxy`.

### Tailwind CSS 4

- remplacement des directives `@tailwind base/components/utilities` par `@import "tailwindcss"`.
- passage du plugin PostCSS `tailwindcss` vers `@tailwindcss/postcss`.
- conservation temporaire de la configuration JavaScript existante via `@config`, afin de ne pas casser brutalement les milliers de classes existantes.
- conversion de `tailwind.config.ts` en `tailwind.config.js` explicite.
- suppression d'Autoprefixer devenu inutile dans cette chaîne.

Cette migration est volontairement progressive : Tailwind recommande son outil `@tailwindcss/upgrade` pour les migrations complexes et précise que les JavaScript configs peuvent encore être chargées explicitement avec `@config`.

### Zod 4

Les usages `z.record(z.unknown())` ont été convertis en `z.record(z.string(), z.unknown())` afin d'être explicites avec l'API moderne de Zod 4.

## 4. Failles de sécurité corrigées

### [CRITIQUE / CORRIGÉ] Confiance dans `organizationId` fourni par le navigateur — analytics publiques

**Fichiers concernés :**
- `src/app/_components/track-click-action.ts`
- `src/app/_components/track-product-click-action.ts`
- `src/application/services/analytics-service.ts`

**Problème :** les Server Actions publiques recevaient `organizationId` depuis le client et le transmettaient à une fonction utilisant le client Supabase `service_role`, qui contourne RLS.

Un visiteur pouvait donc appeler directement la Server Action avec l'ID d'une autre organisation et injecter des événements `cta_click` / `product_click` dans ses statistiques.

**Impact :** intégrité des analytics multi-tenant compromise et possibilité de pollution des métriques d'un autre tenant.

**Correction :** l'organisation est maintenant toujours résolue depuis le hostname côté serveur via `resolveRequestTenant()`. Le `organizationId` client est ignoré pour l'écriture. Les IDs produits doivent également respecter le format UUID.

### [CRITIQUE / CORRIGÉ] Confiance dans `organizationId` fourni par le navigateur — prise de rendez-vous publique

**Fichiers concernés :**
- `src/app/_components/landing-sections/booking-actions.ts`
- `src/application/services/appointment-service.ts`

**Problème :** `requestAppointmentAction()` utilisait directement le `organizationId` présent dans le formulaire. `createAppointment()` utilise le client `service_role` et écrit les contacts/rendez-vous pour cet ID sans seconde résolution du tenant.

Un attaquant pouvait donc tenter d'envoyer le formulaire d'une vitrine publique avec l'ID d'une autre organisation et créer des contacts/rendez-vous dans ce tenant.

**Correction :** le tenant courant est maintenant résolu depuis la requête. L'ID fourni par le navigateur n'est accepté que s'il correspond au tenant résolu; sinon la demande est rejetée.

### [HAUTE / CORRIGÉE] Flood des Server Actions analytics publiques

Les clics publics pouvaient être envoyés sans rate limit dédié.

**Correction :** ajout d'un limiteur `public_analytics` à 120 événements/minute/IP lorsqu'Upstash est configuré.

**Limitation importante :** comme pour les autres rate limits du projet, si les variables Upstash ne sont pas configurées, le système laisse passer les requêtes. En production, il faut donc configurer `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN`.

## 5. Risques de sécurité restant à traiter

### [HAUTE — À FAIRE] CSP avec `'unsafe-inline'`

`next.config.mjs` utilise actuellement :

`script-src 'self' 'unsafe-inline'`

Cela réduit l'efficacité d'une CSP contre certaines classes XSS. Le projet contient aussi plusieurs JSON-LD rendus avec `dangerouslySetInnerHTML`.

**Contexte :** le JSON-LD actuel vient de `JSON.stringify()` côté serveur et n'est pas une injection HTML arbitraire identifiée pendant cet audit. Il reste néanmoins préférable de migrer vers une CSP à nonce si l'architecture de déploiement le permet.

### [HAUTE — À FAIRE] Dépendance à `service_role` dans une grande partie du backend

Le client `getSupabaseServiceClient()` contourne RLS. Le code documente correctement cette règle, mais une erreur future consistant à transmettre un `organizationId` non fiable à un service `service_role` peut créer une nouvelle faille d'isolation multi-tenant.

**Action recommandée :** créer des fonctions serveur de haut niveau qui résolvent/valident systématiquement le tenant avant toute mutation sensible, au lieu de laisser chaque Server Action transmettre directement un ID.

### [MOYENNE — À FAIRE] Health endpoint public

`/api/health` utilise le client `service_role` pour tester Supabase. Il ne renvoie pas de secret, mais le endpoint peut être sollicité sans authentification et force une requête DB.

**Action recommandée :** ajouter un rate limit très léger ou réserver le endpoint à un secret de monitoring si l'infrastructure de supervision le permet.

### [MOYENNE — À FAIRE] Host utilisé pour les URLs canoniques

`resolveRequestOrigin()` utilise le header `host` pour construire canonical/OG/sitemap.

Le middleware nettoie les headers tenant forgés, ce qui corrige un problème d'isolation de routage, mais l'utilisation directe de `host` doit rester surveillée derrière un reverse proxy/CDN.

**Action recommandée :** utiliser l'host validé par l'infrastructure de déploiement ou une allow-list des domaines tenant connus lors de la génération d'URLs absolues.

### [MOYENNE — À FAIRE] Token Telegram dans l'URL

Le webhook tenant Telegram utilise un token dans le chemin `/api/webhooks/telegram/tenant/[token]`.

Il est correctement complété par un secret Telegram dans le header, mais un token d'URL peut apparaître dans certains logs/proxy traces.

**Action recommandée :** continuer à traiter le token comme un secret et éviter de le journaliser en clair. Le code actuel journalise encore le token inconnu dans un message de diagnostic.

### [MOYENNE — À FAIRE] Validation publique des pièces jointes Telegram

La taille maximale de 20 Mo est contrôlée avant stockage, mais le contenu téléchargé est accepté à partir du `contentType` retourné par le provider.

**Action recommandée :** ajouter une validation de type réel/magic bytes pour les formats sensibles et une politique de stockage qui empêche toute exécution directe de fichiers uploadés.

## 6. Points de robustesse / erreurs techniques à surveiller

### Migration Tailwind v4 non encore validée par build

Le projet utilise plusieurs milliers de classes Tailwind et un gros `globals.css` avec `@apply`, configuration custom et tokens historiques. La migration utilise volontairement la compatibilité `@config` pour limiter le risque, mais elle doit être validée avec un vrai build après installation des dépendances.

### Lockfile

L'environnement d'audit n'a pas pu joindre `registry.npmjs.org` et n'a donc pas pu régénérer automatiquement `package-lock.json`. Le `package.json` a été mis à jour, mais le lockfile doit être régénéré avec `npm install` dans un environnement ayant accès au registre.

**Ne pas lancer `npm ci` sur cette archive avant régénération du lockfile.**

### Build / lint / tests

La validation complète nécessite l'installation des dépendances mises à jour. L'environnement actuel n'a pas pu les télécharger. Par conséquent :

- aucune affirmation de build vert n'est faite ;
- aucune affirmation de lint vert n'est faite ;
- aucune affirmation de test E2E vert n'est faite ;
- l'audit statique et les migrations de configuration ont été effectués.

## 7. Matrice des dépendances

| Package | Avant | Cible stable | Action |
|---|---:|---:|---|
| next | 14.2.35 | 16.3.5 | MAJOR |
| react | 18.3.1 | 19.3.0 | MAJOR |
| react-dom | 18.3.1 | 19.3.0 | MAJOR |
| @supabase/supabase-js | 2.115.0 | 2.116.0 | MINOR |
| @supabase/ssr | 0.12.6 | 0.12.7 | PATCH |
| @upstash/ratelimit | 2.0.8 | 2.1.0 | MINOR |
| @upstash/redis | 1.38.4 | 1.38.4 | inchangé |
| zod | 3.23.8 | 4.6.5 | MAJOR |
| tailwindcss | 3.4.7 | 4.3.3 | MAJOR |
| @tailwindcss/postcss | absent | 4.3.3 | ajouté |
| postcss | 8.5.28 | 8.5.28 | inchangé |
| autoprefixer | 10.5.5 | supprimé | inutile avec Tailwind v4 |
| typescript | 5.4.5 | 7.0.2 | MAJOR |
| eslint | 8.57.0 | 10.11.0 | MAJOR |
| eslint-config-next | 14.2.35 | 16.3.5 | MAJOR |
| vitest | 1.6.1 | 5.0.1 | MAJOR |
| @playwright/test | 1.63.0 | 1.63.0 | inchangé |
| tsx | 4.16.2 | 4.23.13 | MINOR |
| vite-tsconfig-paths | 4.3.2 | 6.1.1 | MAJOR |
| dotenv | 16.4.5 | 17.4.2 | MAJOR |
| d3-geo | 3.1.1 | 3.1.1 | inchangé |
| react-simple-maps | 5.0.5 | 5.0.5 | inchangé |
| topojson-client | 3.1.0 | 3.1.0 | inchangé |
| papaparse | 5.7.0 | 5.7.0 | inchangé |
| web-push | 3.6.7 | 3.6.7 | inchangé |

## 8. Priorité de mise en production

1. Régénérer `package-lock.json` avec Node.js 20.9+ / npm récent.
2. `npm install` puis `npm audit`.
3. `npm run typecheck`.
4. `npm run lint`.
5. `npm test`.
6. `npm run build`.
7. Tests E2E des 5 vitrines et du Site Builder.
8. Tester les Server Actions publiques avec un tenant A et tenter de soumettre l'ID du tenant B.
9. Configurer Upstash en production.
10. Remplacer progressivement la CSP `'unsafe-inline'` par une CSP à nonce.

## 9. Pourquoi l'upgrade Next.js était prioritaire

Le projet était encore sur Next.js 14.2.35. Les avis de sécurité Next.js de décembre 2025 ont indiqué des vulnérabilités RSC affectant les branches Next.js 13.x, 14.x, 15.x et 16.x et demandaient une mise à niveau. La branche 16 a depuis reçu des correctifs de sécurité mensuels; la version stable actuelle retenue ici est 16.3.5.

## 10. Conclusion technique

La migration apporte une base beaucoup plus actuelle, mais **elle ne doit pas être considérée comme certifiée production tant que `npm install`, `npm audit`, TypeScript, ESLint, les tests et le build n'ont pas été exécutés dans un environnement disposant du registre npm**.

Les trois problèmes d'isolation les plus importants identifiés dans les Server Actions publiques — analytics CTA, analytics produit et prise de rendez-vous — ont été corrigés en faisant du hostname/tenant serveur la source d'autorité et en ajoutant un rate limit pour les analytics publiques.
