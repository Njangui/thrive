# CRESYVA — Landing finish pass V17

## Objectif

Cette passe part de la version fournie le 21 septembre 2026 et des trois captures de tenants envoyées avec le projet. L'objectif n'est plus d'ajouter des sections : il est d'améliorer les derniers détails qui font qu'une vitrine paraît réellement produite et non simplement « template ».

## Références observées

- Immobilier : hiérarchie hero sombre + photographie immobilière + recherche flottante + cartes de biens + services + chiffres + témoignages.
- Restaurant : hero vert profond + orange d'action + photographie alimentaire forte + menu + histoire + avis + footer sombre.
- Boutique : hero éditorial sombre + typographie serif + photographie/visuel dominant + catégories + sélection + storytelling.

## Changements V17

### 1. Fallbacks visuels premium

Les anciens visuels de secours très schématiques ont été remplacés pour les heroes par des compositions SVG éditoriales plus riches :

- `public/images/showcase/realestate-hero.svg`
- `public/images/showcase/restaurant-hero.svg`
- `public/images/showcase/retail-hero.svg`
- `public/images/showcase/beauty-hero.svg`
- `public/images/showcase/professional-hero.svg`
- `public/images/showcase/default-hero.svg`

Les cartes de démonstration Immobilier et Restaurant utilisent également des extraits photographiques dérivés des références fournies dans la conversation. Ils servent uniquement de contenu de démonstration lorsque le tenant n'a pas encore publié ses propres médias.

### 2. Immobilier

- accent visuel ajouté sur la partie forte du titre par défaut ;
- contraste du hero renforcé sans masquer la photographie ;
- recherche flottante plus lisible et plus stable ;
- interactions clavier/focus ;
- cartes plus nettes et plus aérées ;
- fallback hero réellement visuel au lieu d'un simple diagramme.

### 3. Restaurant

- accent orange du titre par défaut ;
- contraste du hero renforcé ;
- cartes de menu plus lisibles ;
- fallback visuel du hero remplacé par une illustration culinaire dédiée ;
- fallback story et catégories enrichis avec les médias de référence.

### 4. Boutique

- fallback hero remplacé par une composition éditoriale plus travaillée ;
- overlay plus progressif pour conserver la lisibilité du texte ;
- interactions clavier et tactile améliorées ;
- hiérarchie image → produit → prix conservée.

### 5. Beauté / bien-être

- hero plus doux et plus contrasté ;
- fallback visuel dédié ;
- états de focus et interactions harmonisés avec le reste des templates.

### 6. Services professionnels

- hero plus éditorial et moins « dashboard » ;
- overlay renforcé ;
- fallback visuel dédié ;
- méthode / preuve / équipe conservent une hiérarchie sobre.

### 7. Responsive et accessibilité

- corrections de contraste sur petits écrans ;
- `:focus-visible` ajouté sur les principaux éléments interactifs ;
- `prefers-reduced-motion` respecté ;
- aucun changement du contenu métier réel du tenant.

## Règle de contenu

Le contenu réel reste toujours prioritaire. Les contenus de démonstration ne sont utilisés que lorsqu'il manque réellement les données correspondantes. Ils restent identifiables comme exemples lorsque le composant les affiche comme tels.

## Validation effectuée

- Toutes les références `/images/showcase/*` utilisées dans `src/app` existent.
- Équilibrage syntaxique des accolades/parenthèses sur les fichiers TSX/CSS modifiés.
- Analyse TypeScript ciblée : aucune erreur de parsing/syntaxe détectée ; les erreurs restantes dans cet environnement proviennent de l'absence de `node_modules`/résolution des modules et de bibliothèques standard non chargées dans cette vérification isolée.
- Le `package-lock.json` présent dans la version fournie reste aligné avec Next 16 / React 19 / Tailwind 4.

## Limite de validation

Le rendu navigateur final n'a pas été exécuté dans cet environnement faute de dépendances installées. La passe a donc été faite sur le code, les assets et les références visuelles fournies. Le prochain contrôle à faire dans un environnement avec `npm ci` est un screenshot E2E des 5 secteurs en desktop et mobile.
