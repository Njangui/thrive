# CRESYVA — Audit profond des vitrines tenant V13

## Résultat

L'audit du V12 a confirmé que les cinq templates sectoriels sont bien présents et routés, mais a révélé un point fonctionnel important : lorsque le tenant modifiait l'activation ou l'ordre des sections depuis le Site Builder, les templates sectoriels continuaient auparavant à imposer leur composition fixe. Les réglages de structure pouvaient donc être enregistrés sans être reflétés sur la home.

## Correctifs V13

### 1. Respect réel du Site Builder

Les templates sectoriels (immobilier, restaurant, boutique, beauté, services professionnels) sont maintenant utilisés lorsque la composition active correspond au blueprint par défaut du secteur.

Dès que le commerçant modifie réellement la structure de la page — activation/désactivation ou ordre des sections — le rendu passe au compositeur générique de `TenantLanding`, qui respecte `enabledSections` et leur ordre.

Les personnalisations de couleurs, titres, sous-titres, images et identité continuent à fonctionner avec le template sectoriel tant que la composition structurelle reste celle du blueprint.

### 2. Suppression des identités hardcodées dans les vitrines tenant

Suppression des références de marque CRESYVA dans le contenu éditorial des tenants :
- `CRESYVA SHOP` -> nom réel du tenant + `BOUTIQUE`
- `L'EXPÉRIENCE CRESYVA` -> nom réel du tenant
- `CRESYVA PRO` -> nom réel du tenant + `PRO`

### 3. Suppression de la localisation hardcodée

Le fallback restaurant ne force plus `Yaoundé`. Le contenu est maintenant neutre et adapté au tenant.

### 4. Réduction des promesses commerciales non vérifiables

Les highlights par défaut ont été reformulés pour éviter d'affirmer automatiquement des éléments comme « produits vérifiés », « biens visités », « produits frais », « délais tenus », etc. lorsqu'aucune donnée du tenant ne permet de les vérifier.

### 5. Données réelles conservées

L'audit confirme que les éléments suivants utilisent des données tenant lorsqu'elles existent :
- produits / services / catégories ;
- images ;
- témoignages ;
- équipe ;
- notes ;
- statistiques calculées ;
- description ;
- logo / bannière ;
- couleurs ;
- hero personnalisé ;
- WhatsApp et informations de contact.

## Contrôles effectués

- inspection du routage sectoriel ;
- inspection de `TenantLanding` ;
- inspection de `storefront-blueprint.ts` ;
- inspection de `storefront-service.ts` et des capacités tenant ;
- inspection des routes publiques ;
- recherche de villes / marques hardcodées dans les templates ;
- recherche des données et fallbacks ;
- vérification des sections activables ;
- vérification statique TypeScript.

## Limitation de validation

Le ZIP ne contient pas `node_modules`. Une installation `npm ci` a été tentée mais a dépassé le délai de l'environnement d'exécution. Le `tsc` global a pu analyser les fichiers mais l'environnement ne disposait pas des définitions React/Next complètes ; les diagnostics restants sont donc liés aux dépendances manquantes, pas à une erreur de syntaxe détectée dans les modifications V13.
