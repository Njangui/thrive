# Rapport de fusion #11 — Correctif tiroirs mobiles (portail) + icônes de marque réseaux sociaux + refonte landing marketing

Fait suite à `RAPPORT_FUSION_10.md`. Contrairement aux quatre lots
précédents (livrés comme des exports de session ciblés), `thrive-main_1_.zip`
est un **snapshot complet du dépôt** (475 fichiers, mêmes migrations
jusqu'à `0051` que le tronc de départ). Le delta réel a donc été obtenu
par comparaison d'arborescence (`diff -rq`) contre le tronc reçu dans la
fusion #10, plutôt qu'à partir d'un manifeste fourni :

**3 fichiers nouveaux, purement additifs :**
- `public/images/landing-dashboard-reference.png`,
  `public/images/landing-mobile-reference.png` — captures réelles utilisées
  par le hero de la landing marketing
- `src/app/_components/brand-icons.tsx` — `SOCIAL_BRAND`, source unique des
  vraies icônes/couleurs de marque (Instagram, Facebook, LinkedIn, TikTok,
  X, YouTube), partagée entre écrans

**6 fichiers modifiés :**
- `src/app/admin/_components/mobile-nav.tsx`,
  `src/app/dashboard/_components/mobile-nav.tsx`,
  `src/app/dashboard/_components/topbar-actions.tsx` — correctif d'un bug
  de rendu mobile réel : ces tiroirs/modales `fixed inset-0` sont rendus à
  l'intérieur d'un `<header backdrop-blur>`, qui crée un nouveau
  "containing block" CSS pour tout descendant `position: fixed`
  (`backdrop-filter` a le même effet que `filter`/`transform`/`will-change`
  à cet égard) — le tiroir se retrouvait confiné à la hauteur du bandeau
  du haut au lieu de couvrir l'écran. Corrigé par un portail React
  (`createPortal`) direct vers `document.body`, plus blocage du scroll de
  la page pendant l'ouverture (absent avant).
- `src/app/dashboard/channels/page.tsx` — badges texte/emoji remplacés par
  les vraies icônes de marque via `SOCIAL_BRAND` (`brand-icons.tsx`)
- `src/app/_components/marketing-landing.tsx` — section tarifs (DB-driven
  via `plans-repository.ts`) retirée de la landing : les offres vivent
  désormais uniquement sur `/tarifs` (page dédiée déjà existante dans le
  tronc), pour éviter deux sources de vérité sur le même prix. Ajout d'un
  aperçu tableau de bord (`next/image`) utilisant les deux nouvelles
  images de référence.
- `src/app/globals.css` — **seul vrai conflit** : déjà modifié par la
  session Vitrine V2 (fusion #10, remplacement du bloc `.tenant-*` par
  `.sf-*`, après la ligne 420 du tronc). Ce patch-ci ajoute un bloc
  `.mkt-dashboard-frame` totalement indépendant, dans la section `mkt-*`
  (après la ligne 88 du tronc, inchangée par la fusion #10). Les deux
  ajouts ne partagent ni ligne ni namespace de classe (`mkt-` vs `sf-`) —
  fusionnés à la main sans perte, chacun à son emplacement d'origine.

Aucun de ces 6 fichiers ne recoupe les sessions promo-code/country-engine
(vérifié par recherche croisée) : intégration purement additive une fois
le conflit `globals.css` résolu.

## Vérifications passées sur l'ensemble du dépôt fusionné

- `npm ci` : 517 paquets, aucune erreur
- `tsc --noEmit` : propre
- `next lint` : aucun avertissement/erreur
- `vitest run` : **619/619 tests passent (56 fichiers)** — inchangé, ce
  lot n'ajoute aucun test (corrections UI + assets)
- `next build` : succès complet, 80 routes générées. Mêmes stubs
  **temporaires** que la fusion #10 sur `src/app/fonts.ts` et les deux
  appels `next/font/google` de `src/app/layout.tsx` (sandbox sans accès à
  `fonts.googleapis.com`) + variables Supabase factices — **les deux
  fichiers restaurés à l'identique de l'original avant livraison** (diff
  vérifié), aucun changement de code réel.
