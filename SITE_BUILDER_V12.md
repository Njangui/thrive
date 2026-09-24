# tokoo  — Site Builder V12

## Objectif

Renforcement du builder de vitrine après la création des templates sectoriels : le dashboard identifie désormais explicitement le template correspondant au secteur du tenant et expose sa composition recommandée.

## Changements

- Carte d'identité du template actif dans `/dashboard/site`.
- Affichage de la palette par défaut du secteur.
- Preset actif clairement marqué.
- Descriptions métier des structures proposées.
- Liste des sections recommandées calculée directement depuis le blueprint sectoriel.
- Ancre directe vers l'éditeur des sections.
- Les champs de couleurs affichent maintenant les couleurs natives du secteur lorsqu'aucune personnalisation n'a encore été enregistrée.
- Suppression d'un doublon d'alerte d'erreur présent dans la page du builder.
- Les identifiants HTML de navigation des sections ne sont plus réutilisés dans les listes de témoignages/domaines.

## Données

Aucune donnée métier n'est créée. Le builder lit le `StorefrontBlueprint` existant et la configuration persistée du tenant.

## Validation

L'archive ne contient pas `node_modules`. Un `tsc --noEmit` global reste donc limité par l'absence des types Next.js/React ; aucune nouvelle erreur de syntaxe ou erreur spécifique aux changements V12 n'a été détectée dans la sortie ciblée.
