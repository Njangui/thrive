# RAPPORT — Chantier « Catalogue V2 »

> **Note de fusion #14** — ce rapport est conservé tel qu'il a été écrit, pour
> l'historique. Une seule chose a changé à l'intégration dans ce dépôt : les
> migrations citées ci-dessous sous les numéros `0055` et `0056` sont devenues
> **`0056_service_images_and_specifications.sql`** et
> **`0057_promotion_deadline.sql`** (le numéro `0055` était déjà pris par
> `0055_telegram_publications.sql`). Voir `RAPPORT_FUSION_14.md`.

Suite à la demande du 19/09/2026 : préconfiguration de la landing par
secteur, catalogue produits/services enrichi (galerie multi-photos,
informations complémentaires), image de fond, et compte à rebours des
promotions géré depuis le dashboard.

**Avertissement méthodologique** : cet environnement de travail n'a pas
d'accès réseau, donc pas de `npm install`/`node_modules`. Impossible de
faire tourner `npm ci`, `tsc --noEmit`, `next lint`, `vitest` ou `next
build` en conditions réelles, contrairement à certaines sessions
précédentes qui disposaient d'un environnement réseau. La vérification
s'est donc appuyée sur : (1) un contrôle syntaxique automatisé de chaque
fichier modifié via le compilateur TypeScript en mode analyse seule
(détecte les erreurs de syntaxe — accolades, JSX malformé — mais pas les
erreurs de typage inter-modules), (2) une relecture manuelle systématique
de chaque signature de fonction et de chaque appelant, (3) une recherche
exhaustive de toute référence aux exports supprimés ou renommés. Aucune
de ces méthodes ne remplace un vrai `npm run build` — **avant mise en
production, faites tourner `npm ci && npm run typecheck && npm run lint
&& npm run test && npm run build` dans un environnement avec réseau**,
comme pour toute fusion précédente.

---

## Avant de commencer : audit de l'existant

Trois des quatre demandes initiales existaient déjà, en grande partie,
dans le code — confirmé en lisant les fichiers, pas seulement leur nom :

- **Landing préconfigurée par secteur** : déjà largement construite.
  `storefront-blueprint.ts` définit un blueprint complet par secteur
  (retail/restaurant/beauté/services pro/immobilier/autre) — vocabulaire,
  titres de section, CTA, couleurs, badges. `landing-config-service.ts` +
  `storefront-service.ts` alimentent la vitrine en temps réel avec les
  vraies données de l'organisation. L'onboarding (`onboarding-wizard.tsx`)
  fixe déjà le secteur à l'étape 1 et ce choix détermine le blueprint
  utilisé partout ensuite. **Rien reconstruit ici** — c'était déjà fait.
- **Image de fond** : `dashboard/site/page.tsx` expose déjà un champ
  `heroMediaUrl` (visuel de l'en-tête de la landing), en plus du logo, de
  la bannière et de l'image OG. **Rien reconstruit ici** non plus.
- **Galerie multi-photos produits** : déjà complète côté produits (table
  `product_images`, écran d'édition avec ajout/suppression/
  réordonnancement/photo principale). C'était **uniquement les services**
  qui n'avaient rien.
- **Compte à rebours des promotions** : n'existait PAS. Une session
  précédente l'avait délibérément écarté — commentaire encore présent (et
  maintenant mis à jour) dans `landing-sections/promotions.tsx` : le
  modèle de données n'avait qu'un prix barré, jamais de date de fin, et un
  compte à rebours sans échéance réelle aurait menti au client du
  commerçant. C'est le vrai chantier de l'itération 2.

## Itération 1 — Parité images produits/services + informations complémentaires

**Migration** `0055_service_images_and_specifications.sql` :
- `service_images` (nouvelle table, miroir exact de `product_images` :
  mêmes colonnes, même politique de position, même RLS).
- `products.specifications` et `services.specifications` (JSONB, liste
  ordonnée de paires libellé/valeur — matière, garantie, zone desservie,
  durée de validité... jamais des colonnes figées par secteur).

**Backend** :
- `service-service.ts` : galerie complète ajoutée (`listServiceImages`,
  `appendServiceImage`, `removeServiceImage`, `moveServiceImage`,
  `setPrimaryServiceImage`) + informations complémentaires
  (`addServiceSpecification`/`removeServiceSpecification`). `createService`
  accepte désormais une photo initiale.
- `catalog-service.ts` : informations complémentaires ajoutées côté
  produits (même paire de fonctions), exposées dans `getProductBySlug` et
  `getProductForEdit`.

**Correctif d'architecture découvert en cours de route** :
`/dashboard/services` (page liste) écrivait via un second chemin
(`service-catalog-service.ts` : `priceFcfa`, **suppression définitive**)
totalement indépendant de `/dashboard/services/new` et `/dashboard/
services/[id]/edit` (`service-service.ts` : `price`, jamais de
suppression dure — même convention que les produits). Un commerçant créant
une prestation depuis la page principale n'avait donc aucun moyen
d'atteindre la galerie qu'il venait de configurer, et pouvait supprimer
définitivement une prestation dont le lien était déjà partagé sur
WhatsApp. Corrigé : `/dashboard/services` repointée sur `service-service.ts`
(liste pure façon `/dashboard/products`, avec vignette photo et lien
« Modifier », suppression dure retirée) ; les fonctions d'écriture
devenues orphelines de `service-catalog-service.ts` ont été retirées (le
fichier ne garde que la lecture pour le routeur IA WhatsApp).

**Interface** :
- `dashboard/services/new` et `/[id]/edit` : upload photo, galerie
  complète, éditeur d'informations complémentaires (nouveau pour les
  services).
- `dashboard/products/[id]/edit` : éditeur d'informations complémentaires
  ajouté (la galerie existait déjà).
- Fiches publiques `produits/[slug]` et `services/[slug]` : nouveau
  tableau « Informations complémentaires » (composant partagé
  `SpecificationsTable`) ; la fiche service affiche maintenant une
  galerie photo (avant : aucune image, nulle part).
- `ServiceCard` (accueil + page `/services`) : vignette photo ajoutée,
  comme les produits.

**Tests** : ajoutés/mis à jour en miroir pour toutes les nouvelles
fonctions et pour le fichier `service-catalog-service.test.ts` réduit à
son périmètre restant.

## Itération 2 — Promotions à échéance + compte à rebours

**Migration** `0056_promotion_deadline.sql` : `products.promotion_ends_at`
(nullable, sans impact sur les promotions existantes — un prix barré sans
échéance reste actif indéfiniment, comme avant).

**Règle centrale** (`catalog-service.ts::isPromotionCurrentlyOn`) : une
promotion sans échéance reste active indéfiniment (comportement
historique) ; avec échéance, seulement tant qu'elle n'est pas dépassée —
calculé à la lecture, sans tâche planifiée. Appliquée uniformément à
`getProductBySlug`, `listStorefrontProducts` et `countStorefrontProducts`
: passé l'échéance, le prix barré, le badge « promo » et la présence dans
« Promotions » disparaissent tous ensemble, automatiquement. Le dashboard
(`getProductForEdit`), lui, garde toujours la valeur **brute** — le
commerçant doit pouvoir voir et relancer une promotion expirée.

**Interface** :
- `dashboard/products/new` et `/[id]/edit` : champ « Fin de la
  promotion » (optionnel). Un composant dédié (`PromotionDeadlineField`)
  gère la conversion de fuseau horaire côté navigateur du commerçant (une
  conversion faite côté serveur afficherait la mauvaise heure pour un
  commerçant hors du fuseau du serveur).
- `CountdownTimer` (nouveau, `"use client"`) : le seul compte à rebours du
  projet, branché sur une vraie échéance, jamais une durée inventée.
  Variante compacte (pastille sur la carte produit) et complète (fiche
  produit, bannière « Promotions »).
- `ProductCard`, fiche produit, page `/promotions` (bannière « échéance
  la plus proche ») et section promotions de la page d'accueil : tous
  câblés.

**Décision de périmètre** : le compte à rebours reste **produits
uniquement** dans cette itération — les services n'ont pas de
`compare_at_price` du tout, en ajouter un serait un chantier à part.

---

## Vérifications faites

- Contrôle syntaxique automatisé (compilateur TypeScript, mode analyse) :
  24 fichiers modifiés/créés, aucune erreur.
- Recherche exhaustive de toute référence aux exports supprimés
  (`listServices`/`createService`/`updateService`/`deleteService` de
  `service-catalog-service.ts`) : aucune référence orpheline.
- Relecture de chaque nouvel appel de fonction contre la signature réelle
  de la fonction appelée (noms de champs, ordre des paramètres).
- Vérification que toutes les classes CSS réutilisées (`adm-*`,
  `cresyva-*`) existent bien dans `globals.css`.

## Non vérifié — à faire avant mise en production

- **Aucun `npm run build` réel** (pas de réseau ici). Le typage
  inter-modules complet (React, Next.js, Supabase, Zod) n'a pas pu être
  validé par le compilateur lui-même.
- **Aucun test réellement exécuté** (`vitest` non lancé) — seuls les
  nouveaux tests ont été relus attentivement pour cohérence avec le code
  qu'ils couvrent.
- La migration SQL n'a pas été appliquée à une vraie base Postgres.

## Pistes pour la suite

- Étendre le compte à rebours aux services, si un jour ils ont un prix
  barré.
- Import CSV : `compare_at_price`/`promotion_ends_at`/`specifications` ne
  sont pas importables en masse (création manuelle uniquement) — choix
  délibéré, à revoir si le besoin se présente.
- Réordonnancement des informations complémentaires (actuellement ajout
  en fin de liste uniquement, comme pour la galerie) — pas demandé, mais
  simple à ajouter sur le même modèle que `moveProductImage`.
