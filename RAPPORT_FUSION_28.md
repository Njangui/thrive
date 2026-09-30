# RAPPORT_FUSION_28 — Itération 2 + landings sectoriels restructurés

Base : projet actuel (fusion 27 : marque flexco, retail, restaurant, itération 1, essai Pro offert).
Les deux archives partent de l'ancienne base cresyva ; renommage `cresyva → flexco` appliqué aux fichiers importés, fusion à 3 voies fichier par fichier.

| Archive | Contenu réel | Traitement |
|---|---|---|
| `thrive-main-iteration2.zip` | itération 1 + **itération 2** (commentaires unifiés réservés Pro, heure de pointe, onglets par plateforme, CRM identité + export CSV) | delta vs itération 1 repris : 13 fichiers repris tels quels, 9 nouveaux, **0 conflit** |
| `files__5_.zip` (`thrive-main-sites-restructures.zip`) | restaurant remanié + **nouveau template prestataire de service** + `sector-shared/` | delta vs restaurant v1 repris |

## Conflits résolus
1. `tenant-landing.tsx` : `RetailHome` depuis `retail-home/`, `RestaurantHome` depuis `restaurant/`, `ProfessionalServicesHome` depuis `professional-services/` ; plus aucun des trois importé depuis `sector-home`.
2. `globals.css` : 6 conflits. Vérifié que le seul changement CSS du lot prestataire est la suppression des règles `.pro-*` / `.demo-pro-*` / `sector-professional` / `data-sector="professional_services"` (test : `strip(base) == fichier de l'archive`, identique). Même suppression appliquée au CSS actuel (qui a déjà perdu les règles retail/restaurant) → 0 règle pro/boutique/rest orpheline, accolades équilibrées. (Quelques lignes vides en plus, sans effet.)
3. Fichiers du restaurant v1 retirés (déplacés dans `sector-shared/` par l'archive) : `restaurant-hours.ts`, `restaurant-theme.ts`.

## Correctif dans l'archive (pas dans la fusion)
`professional-services/sections/visit.tsx` importait `HoursEntry` depuis `services-model.ts` qui ne l'exporte pas → erreur `tsc`. Import redirigé vers `sector-shared/business-hours` (où le type est défini).

## Vérifications
- `tsc --noEmit` : 0 erreur ; `eslint` : 0 erreur, 1 avertissement (`isBlank` inutilisé dans `services-model.ts`, vient de l'archive)
- `vitest` : **1186 / 1188 OK**, dont restaurant 46, prestataire 26, contact-identity 17, analytics landing 16
- Les 2 échecs sont les tests Fapshi déjà en échec avant (voir RAPPORT_FUSION_27.md)
- Compatibilité essai Pro : la page Commentaires (Pro uniquement) passe par `canUseFeature` → ouverte à tous pendant l'essai, refermée automatiquement à la fin.

## Non vérifié
`next build`, rendu visuel des 3 templates + hero générique avec le CSS fusionné, migrations non concernées (aucune nouvelle dans ce lot).
## Reste à faire (itération 3, cf. RAPPORT_ITERATION_2.md)
Diffusion : sélection manuelle des contacts, produits du catalogue, média de couverture — nécessite une migration.

## Ajout — lien « Service client »
- Menu du dashboard (groupe « Système », desktop + mobile : même liste) → `/dashboard/support`.
- Page présentant les deux numéros WhatsApp du service client : +237 656 10 62 25 et +237 657 38 09 54, avec bouton « Écrire sur WhatsApp » (lien `wa.me`, message pré-rempli avec le nom de l'entreprise).
- Numéros centralisés dans `src/application/config/customer-support.ts` (un seul endroit à modifier) ; 5 tests.
