# Rapport — Lot 2 : Dashboard + Catalogue + Services + Landing entreprise + SaaS landing

Base : `sme-os-fusionne-lot-K-L-M-N.zip` (Lots B→N fusionnés, 319 tests,
0 erreur avant ce lot).

## A. Résumé

### Corrigé
- **Nav dashboard inutilisable sur mobile** : 15 liens plats dans le
  header, aucune adaptation d'écran. Remplacée par une sidebar groupée
  (desktop) + un tiroir (mobile), même contenu de navigation partagé
  entre les deux (`dashboard-nav.tsx`).
- **`compare_at_price` alimentait déjà la section "Promotions" de la
  landing publique sans qu'aucune UI ne permette jamais de le
  renseigner** — champ toujours vide en pratique. Exposé dans les
  formulaires de création/édition produit, avec validation (ignoré si
  ≤ prix courant, jamais une promo à l'envers).
- **Root `/` sans tenant affichait une page de statut de développement
  interne** en production. Remplacée par une vraie landing commerciale
  (§6 du master prompt), supprimée (`internal-status.tsx`).
- `docs/MVP_SCOPE.md` était obsolète (listait comme "hors MVP" des
  fonctionnalités déjà construites par des lots précédents : groupes
  WhatsApp, rendez-vous, paiement NotchPay...). Réaligné sur le code réel.

### Ajouté
- **CRUD Services complet** (`service-service.ts` +
  `/dashboard/services`, `/new`, `/[id]/edit`) — la table existait
  depuis longtemps, lue uniquement par la landing publique ; aucun
  commerçant ne pouvait jamais créer un service.
- **Landing marketing SME-OS** (`marketing-landing.tsx`) — Hero,
  Problème, Solution, Comment ça marche, Fonctionnalités, Tarifs (lus
  depuis `plans`/`plan_entitlements`, jamais codés en dur), Témoignages
  (placeholders explicitement signalés comme tels), FAQ, CTA, Footer.
  Responsive, menu mobile dédié.
- **Galerie multi-photos produit** (§15) — le schéma
  (`product_images.position`) le permettait déjà, l'écran ne gérait
  qu'une seule photo. Ajout : `listProductImages`, `appendProductImage`,
  `removeProductImage`, `moveProductImage` (monter/descendre, pas de
  drag-and-drop — cohérent avec le réordonnancement des sections de
  landing existant), `setPrimaryProductImage` (échange de position,
  jamais un delete+recréation qui perdrait l'id).

### Refactoré
- `catalog-service.ts::updateProduct` ne gère plus la photo (séparé en
  actions dédiées à la galerie) — deux responsabilités, deux mécanismes,
  jamais l'un qui écrase l'autre par effet de bord.
- `addProductImage`/`replacePrimaryProductImage` (mécanisme
  single-image) remplacés par `appendProductImage`/
  `setPrimaryProductImage` (mécanisme galerie) — pas de doublon de
  logique (§100).

## B. Fichiers modifiés/créés

**Créés**
1. `src/application/services/service-service.ts` — CRUD services
2. `src/application/services/service-service.test.ts` — 9 tests
3. `src/app/dashboard/services/page.tsx` — liste + activer/désactiver
4. `src/app/dashboard/services/new/page.tsx`
5. `src/app/dashboard/services/[id]/edit/page.tsx`
6. `src/app/dashboard/_components/dashboard-nav.tsx` — sidebar + drawer
7. `src/app/_components/marketing-landing.tsx` — landing SME-OS
8. `src/app/_components/marketing-mobile-menu.tsx`

**Modifiés**
1. `src/application/services/catalog-service.ts` — `compareAtPrice`
   (Create/UpdateProductInput, ProductForEdit) + galerie multi-photos
2. `src/application/services/catalog-service.test.ts` — +7 tests (14 au total)
3. `src/app/dashboard/products/new/page.tsx` — champ prix barré
4. `src/app/dashboard/products/[id]/edit/page.tsx` — champ prix barré + galerie photos
5. `src/app/dashboard/layout.tsx` — utilise la nouvelle nav responsive
6. `src/app/page.tsx` — sert `MarketingLanding` sans tenant, métadonnées SEO dédiées
7. `docs/MVP_SCOPE.md` — réaligné sur le code réel

**Supprimés**
1. `src/app/_components/internal-status.tsx` — plus jamais rendu par aucune route

## C. Migrations

**Aucune.** Vérifié avant de coder (§99/§68) : `services` avait déjà
tous les champs nécessaires (name/slug/description/category_id/price/
duration_minutes/status), `product_images.position` supportait déjà une
galerie. Aucune raison de créer une migration pour ce lot.

## D. Tests

```
Typecheck : 0 erreur (npx tsc --noEmit)
Lint      : 0 warning/erreur (npx next lint)
Tests     : 340/340 passants (35 fichiers) — 319 avant ce lot + 21 nouveaux
            (9 service-service.test.ts, 7 nouveaux dans catalog-service.test.ts
             pour compareAtPrice + galerie, 5 pour la promotion déjà comptés)
Build     : échoue dans cet environnement (sandbox réseau bloque
            fonts.googleapis.com dès next/font, avant toute compilation
            applicative) — même constat déjà documenté pour les lots
            précédents, sans lien avec le code de ce lot. À vérifier avec
            un accès réseau complet avant déploiement.
```

## E. Fonctionnalités restantes

### MVP (identifié, non construit dans ce lot — budget de temps)
- **Recherche/filtre sur la liste de produits du dashboard** (§14).
- **CTA "Promouvoir ce produit ?" après création** (§42) — dépend d'un
  vrai écran de création de publication, qui n'existe pas encore :
  `/dashboard/marketing` est en LECTURE SEULE (`createCampaignFromProducts`
  existe côté service depuis un lot précédent, jamais appelé par aucune
  UI — déjà noté dans le commentaire de ce fichier avant ce lot). Ce CTA
  n'aurait aucune destination fonctionnelle tant que cet écran n'existe
  pas ; je n'ai pas voulu construire les deux à la hâte dans le temps
  restant plutôt que bien faire l'un des deux.
- Catégories produits/services : saisie libre (texte), pas de sélection
  parmi les catégories existantes — fonctionnel mais pourrait créer des
  doublons proches ("Chaussures" / "chaussure") si un commerçant ne fait
  pas attention à l'orthographe utilisée précédemment.

### V2 (hors scope, volontairement)
- Achat automatisé de domaine/numéro auprès d'un vrai fournisseur
  (abstraction déjà prête, aucun registrar/opérateur branché).
- Constructeur de site libre (le système à sections activables/
  réordonnables existant reste la bonne réponse pour ce MVP, §11).

### Bloqué externe
- Aucun dans ce lot.

## F. Risques production

- **`getEmailProvider`/`getAIProvider`/paiement** : non touchés par ce
  lot, risques déjà documentés dans les rapports précédents (Lot L/N).
- **Galerie photos** : `renumberProductImages` fait un `Promise.all` de
  plusieurs updates — pas de transaction SQL explicite. Pour une galerie
  de quelques photos (cas réel), le risque d'état incohérent en cas
  d'échec partiel est faible mais non nul ; à surveiller si des galeries
  de grande taille apparaissent en usage réel.
- **Landing marketing** : témoignages actuellement des placeholders
  explicitement signalés comme tels dans le code — à remplacer par de
  vrais témoignages clients avant un vrai lancement commercial (aucune
  personne/entreprise réelle n'est représentée).
- **`next build`** non vérifié de bout en bout dans cet environnement
  (sandbox réseau) — void section D.
