# C4 — Import de catalogue « intelligent » (étape 2, première partie)

## Fait
- `catalog-import-analysis.ts` (pur, sans base) : mapping de colonnes deviné (synonymes FR/EN, « prix d'achat » distinct de « prix »), lecture tolérante des montants (`35 000 FCFA`, `35.000`, `1,500`, `12,5`), détection de doublons (nom normalisé sans accents, SKU) dans le fichier ET dans le catalogue.
- `catalog-smart-import-service.ts` : `importCatalogSmart` (mode aperçu `dryRun` sans écriture, ou import) et `validateDraftProducts` (activation en bloc).
- Route `POST /api/catalog/import` : champ optionnel `mode` = `smart_preview` | `smart` ; absent = comportement historique inchangé. Nouvelle route `POST /api/catalog/import/validate`.
- Les parseurs `parseImageUrls` / `parseSpecifications` ont été déplacés dans `catalog-import-service-parsers.ts` (réexportés par l'ancien module : API et tests existants inchangés).

## Règles
- **Jamais inventer prix ni stock** : prix absent/illisible ou stock illisible → la ligne n'est pas créée, elle est rapportée dans `needsClarification` avec la raison. Stock vide → 0 en base (colonne non nulle) mais compté dans `stockUnknown`.
- Tout est créé en **brouillon** (`draft`) ; `validateDraftProducts` active seulement les brouillons du tenant au prix > 0 (`out_of_stock` si stock 0).
- **Quotas** : `canUseFeature("catalog_products")` appliqué comme avant, aucune règle nouvelle (politique renvoyée au modèle de prix v2).
- Aucune donnée n'est envoyée à une API externe dans cette partie (règles seulement).

## Interface (dashboard, livrée)
- `SmartImportForm` sur `/dashboard/products` (au-dessus de l'import CSV classique, conservé) : **analyser** (aperçu sans écriture : colonnes reconnues, produits importables, lignes à préciser, doublons, avertissements) → **importer en brouillon** (après accord) → **valider les brouillons** d'un geste.
- Un avertissement explicite précède la validation quand des stocks ne sont pas renseignés : ces produits passeront en **rupture de stock** (rien n'est inventé), jusqu'à ce que le commerçant indique le stock.
- Encodage : la route décode en UTF-8 strict puis, à défaut, en Windows-1252 (CSV exportés d'Excel en français) ; taille limitée à 5 Mo en mode smart. Séparateur `,` ou `;` détecté par PapaParse.
- Non vérifié : la page n'a pas été rendue ni testée dans un navigateur.

## Excel (.xlsx) — livré, **dépendance à installer**
- **Avant d'intégrer ce code : `npm install exceljs@4.4.0 --save-exact`** (met à jour `package.json` ET le lockfile ; je n'ai pas pu le faire ici, sans réseau). Sans cela, `next build` échoue sur `import("exceljs")`. Version et `npm audit` **à revérifier** au moment de l'installation ; `exceljs` traîne des dépendances anciennes (avertissements de dépréciation attendus).
- Le classeur est converti en CSV puis suit le même chemin que l'import CSV (`catalog-xlsx.ts` → `importCatalogSmart`) : une seule logique métier. Formules : dernier résultat enregistré, jamais évaluées ; erreurs Excel (`#N/A`…) = valeur absente ; liens hypertexte = l'adresse ; feuilles masquées jamais lues ; ligne d'en-tête détectée sous les titres éventuels ; 20 000 lignes et 5 Mo maximum.
- Garde de base contre les bombes de décompression (taille décompressée déclarée ≤ 100 Mo, ≤ 1 000 entrées) : **barrière partielle** (les tailles déclarées peuvent être falsifiées) ; la limite de 5 Mo en amont reste la protection principale. `.xls` et `.ods` : refusés avec un message clair.
- Le rapport indique la feuille lue, les AUTRES feuilles contenant des données non lues, et les lignes d'en-tête sautées.
- `next.config.mjs` : `serverExternalPackages: ["exceljs"]`.
- Non vérifié : la lecture réelle d'un `.xlsx` (exceljs absent ici). Les 10 tests purs de `catalog-xlsx.test.ts` passent ; **ajouter un test d'intégration avec un vrai classeur** (fichier réel de commerçant, avec formules et titres) après installation.

## Pas encore fait
- Photos par lot (vision), PDF/scans (OCR Mistral), dictée (SpeechPort de C3), texte libre : parties IA, à brancher sur le registre d'outils de C1.
- Événement `ProductChanged` : dépend de l'outbox `domain_events` de C1 (absente du dépôt). À émettre à la création et à la validation en bloc.
- Aucune migration SQL (`sku` et `cost_price` existent déjà dans `products`).

## Tester
`npx vitest run src/application/services/catalog-import` (non exécuté ici : pas de `node_modules` ; l'analyse pure a été vérifiée avec un harnais Node local, 29 cas OK).
