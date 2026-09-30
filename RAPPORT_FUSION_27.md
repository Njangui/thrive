# RAPPORT_FUSION_27 — Fusion de 3 lots dans la base flexco (fusion 26)

**Date : 29/09/2026**

## 1. Ce qui a été fusionné

Base retenue : `thrive-main__8_` (dépôt actuel, marque **flexco**, fusion 26, commit f164ec1).

Les 4 autres archives partent toutes de l'ancienne base **cresyva** (avant renommage) :

| Archive | Contenu réel | Traitement |
|---|---|---|
| `thrive-main__7_` | ancienne base + template **retail-home** (`sector-home.tsx`, `tenant-landing.tsx`, `globals.css`, dossier `retail-home/`) | delta repris |
| `thrive-main-corrige` | ancienne base + **itération 1** (31 fichiers : photos catalogue, Zernio masqué du front, blocs dashboard selon modules, déconnexion canaux, correctifs de tests) | delta repris |
| `files__3_` = `files__4_` (octet pour octet identiques) | ancienne base + **landing restaurant** (`restaurant/`, `cta-target.ts`, `hero.tsx`, `sector-home.tsx`, `tenant-landing.tsx`, `globals.css`) | delta repris (une seule fois) |

Méthode : fusion à 3 voies fichier par fichier (base commune = ancienne base reconstituée), en appliquant le renommage `CRESYVA/Cresyva → Flexco`, `cresyva → flexco` aux fichiers importés pour ne pas créer de faux conflits.

## 2. Bilan

- 5 fichiers nouveaux : `restaurant/`, `retail-home/`, `landing-sections/cta-target.ts`, `new-catalog-media-field.tsx`, `RAPPORT_ITERATION_1.md`
- 26 fichiers modifiés par rapport à `__8_`
- 23 fichiers de l'itération 1 repris tels quels (la base n'y avait pas touché)
- 4 fichiers de l'itération 1 déjà identiques dans la base (finance dashboard/admin payments)

## 3. Conflits résolus à la main

1. **`src/app/admin/finance/page.tsx`** — la base a déjà le palier « > 2 000 · custom » (`customAccounts`), l'itération 1 avait encore l'ancien « 1 $ » (`over2000Accounts`, qui n'existe plus). Gardé : grille de la base + paragraphe enrichi de l'itération 1 (proratisation quotidienne).
2. **`tenant-landing.tsx`** — retail et restaurant modifiaient les mêmes lignes. Résultat : `RetailHome` depuis `./retail-home/retail-home`, `RestaurantHome` depuis `./restaurant/restaurant-home`, plus aucun des deux importé depuis `sector-home`. Données chargées : retail = produits, catégories, avis, promotions, galerie, FAQ ; restaurant = produits, catégories, avis, galerie.
3. **`globals.css`** (20 conflits) — les deux lots avaient supprimé des blocs voisins (règles `.boutique-*` / `.sector-retail-home` d'un côté, `.rest-*` / `.sector-restaurant-home` de l'autre). Résultat = suppression cumulée des deux ; il ne reste que la mention `.rest-*` en commentaire (identique au lot restaurant), 0 règle orpheline, accolades équilibrées, aucune liste de sélecteurs laissée avec virgule finale.

## 4. Vérifications faites (sur l'arbre fusionné)

- `npm ci` : OK, `package.json` et `package-lock.json` identiques à la base
- `tsc --noEmit` : **0 erreur**
- `eslint .` : **0 erreur**
- `vitest run` : **1121 / 1123 tests OK** (97 fichiers). Dont `retail-home.test.ts` (63) et `restaurant-model.test.ts` (46) avec le vrai vitest, ce que le lot restaurant n'avait pas pu faire.

## 5. Points ouverts

1. **2 tests en échec, déjà présents dans la base `__8_`** (pas introduits par la fusion) : `fapshi/client.test.ts` attend `"Fapshi paymentStatus a échoué (502): "`, mais `client.ts` écrit maintenant `... (502) pour l'URL <url>: ...`. `client.ts` et son test sont identiques à `__8_`. À corriger d'un côté ou de l'autre selon le message voulu.
2. **`next build` non lancé** (Google Fonts injoignable depuis l'environnement de fusion). À faire avant déploiement.
3. **Vérif visuelle non faite** : rendu réel desktop/mobile des deux templates (retail + restaurant) et du hero générique, maintenant qu'ils coexistent avec le CSS fusionné.
4. `SHOW_DEMO_CONTENT` (contenu d'exemple restaurant) : décision produit toujours en attente (voir `RAPPORT_LANDING_RESTAURANT.md`).
5. `src/app/_components/cresyva-brand.tsx` existe encore à côté de `flexco-brand.tsx` (déjà le cas dans `__8_`), non touché.
6. « Reste à faire » de l'itération 1 (commentaires, heure de pointe, onglets par plateforme, CRM, diffusion) : non traité ici.
