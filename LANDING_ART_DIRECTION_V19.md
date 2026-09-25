# flexco  — Landing Art Direction V19

## Objectif
Dernier passage de finition sur les vitrines sectorielles, avec priorité à la perception premium, à la cohérence de marque et à l'honnêteté des états sans données.

## Changements

### Immobilier
- Suppression de toute référence fixe à flexco  dans le contenu du site client.
- Localisation de la signature verticale à partir de l'adresse réelle du tenant.
- Accent éditorial renforcé sur le hero et les cartes de biens.
- Rendu des statistiques corrigé : les données d'exemple sont explicitement présentées comme exemples.

### Restaurant
- Localisation dynamique à partir de l'adresse réelle du restaurant.
- Suppression du faux `5/5` lorsqu'aucune note réelle n'est configurée.
- État vide de la note remplacé par une indication neutre.
- Renforcement de la direction hospitality : signature orange, séparation éditoriale, cartes plus sobres.

### Retail
- Hero de fallback plus éditorial : « Votre univers. Votre sélection. ».
- Accent typographique camel sur le second niveau du titre.
- Trait éditorial et détails de collection renforcés.

### Beauté
- Direction « quiet luxury » renforcée.
- Aucun faux score ajouté si la note réelle n'existe pas.
- Meilleure séparation visuelle des cartes et de la galerie.

### Services professionnels
- Direction plus institutionnelle/editorial et moins « dashboard ».
- Accent de hero plus net.
- Cartes de services/domaines plus structurées.

### Générique
- Hero neutre mais plus affirmé.
- Signature de marque plus forte.
- CTA final et cartes plus éditorialisés.

### Tous les secteurs
- Micro-texture photographique légère sur les grands heroes.
- Coins plus sobres pour une perception premium.
- États de démonstration clairement marqués `APERÇU` afin de ne jamais faire passer des données fictives pour des données client.
- Meilleure hiérarchie responsive sur mobile.
- Respect de `prefers-reduced-motion` conservé.

## Validation
- `sector-home.tsx`: accolades 598/598, parenthèses 261/261.
- `globals.css`: accolades 1522/1522, parenthèses 781/781.
- Recherche des anciennes chaînes hardcodées `SÉLECTION flexco ` et `YAOUNDÉ · CAMEROUN`: aucune occurrence.
- `unzip -t` effectué sur l'archive finale.
- Le TypeScript complet n'est pas exécutable dans cet environnement sans `node_modules`; les erreurs globales observées sont principalement des modules/types manquants. Aucun problème de parsing TSX/CSS n'a été détecté sur les fichiers modifiés par les validations statiques.
