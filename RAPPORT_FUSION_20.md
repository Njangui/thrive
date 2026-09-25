# Rapport de fusion #20 — fusion #19 + direction artistique des vitrines (V17 → V19)

Fait suite à `RAPPORT_FUSION_19.md`. Date : 21 septembre 2026.

## 1. Source reçue et sa base

`flexco -flexco -landing-art-direction-v19.zip` est un **projet complet** (664 fichiers, à la racine de l'archive) construit **sur la fusion #19** : il contient déjà `RAPPORT_FUSION_18.md`, `RAPPORT_FUSION_19.md` et `RAPPORT_MIGRATION_FAPSHI.md`. Comparaison fichier par fichier avec l'arbre #19 :

| Écart | Nombre |
|---|---|
| Fichiers présents dans #19 et absents de l'archive | **0** |
| Fichiers communs **différents** | **2** : `src/app/_components/sector-home.tsx`, `src/app/globals.css` |
| Fichiers **nouveaux** | 21 (3 notes, 6 SVG, 12 JPG) |
| `tsconfig.tsbuildinfo` (1,7 Mo, artefact de build) | ignoré, jamais versionné |

Les 640 autres fichiers sont identiques : **aucun conflit possible**, pas de fusion à trois voies. `package.json` et `package-lock.json` sont inchangés.

## 2. Ce qui est repris

- **`sector-home.tsx`** (68 lignes changées) et **`globals.css`** (480 lignes changées ; CSS produit 244 643 → 263 504 octets) : direction artistique des 5 secteurs + générique — hero éditorial, signature localisée d'après l'adresse réelle du tenant, suppression du faux « 5/5 » sans note réelle et des libellés fixes « SÉLECTION flexco  » / « YAOUNDÉ · CAMEROUN », `:focus-visible`, `prefers-reduced-motion`, garde-fous mobile.
- **`public/images/showcase/`** (≈ 1,2 Mo) : 6 SVG de secours pour les heroes (`{realestate,restaurant,retail,beauty,professional,default}-hero.svg`) et 12 photos JPG de démonstration (`demo/realestate-*`, `demo/restaurant-*`).
- **Notes** `LANDING_FINISH_PASS_V17.md`, `LANDING_ART_DIRECTION_V18.md`, `LANDING_ART_DIRECTION_V19.md`. Les marqueurs de citation parasites `citeturn…` de la note V18 sont retirés (comme pour l'audit en #18).

## 3. Vérification

Les trois notes n'annoncent qu'une **validation syntaxique** (accolades équilibrées, parsing TSX) : ni typecheck, ni lint, ni tests, ni build n'avaient pu tourner. C'est fait ici :

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` | 0 erreur |
| `npm run lint` | 0 erreur, 30 avertissements (identique à #19 : le nouveau code n'en ajoute aucun) |
| `npm test` | 857 réussis / 0 échoué (72 fichiers) |
| `npm run build` (Next 16.3.5) | OK, 82/82 pages ; `tsconfig.json` non réécrit |
| Références `/images/…` dans `src/` | toutes présentes dans `public/` |

Build : même méthode que #18 / #19 (copie jetable, polices stubées, identifiants Supabase factices).

## 4. ⚠ Les 12 photos de démonstration : à traiter avant la production

Vérifié sur une planche des 12 images : **ce sont des recadrages de captures d'écran**, pas des photos propres. La note V17 le confirme (« extraits photographiques dérivés des références fournies dans la conversation »). Constats :

| Image | Utilisée ? | Problème |
|---|---|---|
| `realestate-hero.jpg` | **Non** (le hero de secours est `realestate-hero.svg`, `sector-home.tsx` l. 58) | Interface incrustée dans l'image : pastille « +400 biens disponibles » et barre de recherche (Ville / Budget / Rechercher) |
| `restaurant-hero.jpg` | **Non** (hero de secours = SVG, l. 588) | Slogan incrusté et carte « **4,8/5 · +2 500 clients satisfaits** » avec avatars : preuve sociale inventée |
| `realestate-story.jpg` | **Oui** — image d'histoire par défaut (l. 59) | Slogan incrusté « Votre futur commence ici » |
| `restaurant-story.jpg` | **Oui** — image d'histoire par défaut (l. 589) | **Faux bouton lecture** ▶ + texte « Découvrez notre restaurant » incrustés : rien ne se lance au clic |
| `realestate-1…4.jpg`, `restaurant-1…4.jpg` | **Oui** — cartes de démonstration (l. 71–80, 592–595) | Défauts de recadrage visibles même en miniature : marges blanches et coins arrondis, reste de texte flouté en bas des images restaurant |

- **Preuve sociale inventée** : les deux images « hero » ne sont pas branchées aujourd'hui, mais elles sont servies publiquement. Une vitrine sans média propre affiche en revanche les deux images « story » avec leurs éléments incrustés.
- **Origine et licence non vérifiées** : des recadrages de visuels de référence tiers ne sont pas des images libres de droit. Je ne peux pas confirmer d'où viennent les visuels d'origine.
- **Recommandation** : remplacer les 12 JPG par des photos dont vous détenez les droits (ou des visuels générés propres, sans texte ni interface), et **supprimer au minimum** `realestate-hero.jpg` et `restaurant-hero.jpg`, inutilisées. Aucun code à changer si les noms de fichiers sont conservés. Je n'ai rien retiré : ce sont vos actifs et la décision de fond vous appartient.

Écart note / code : la note V19 parle d'états de démonstration marqués « APERÇU ». Le code utilise des libellés « Exemple d… » / « Aperçu » (`sector-home.tsx` l. 129, 166, 237, 249, 262…) ; aucune occurrence de « APERÇU » en capitales.

## 5. Non vérifié

- **Aucun rendu navigateur**, ni dans les notes ni ici : la direction artistique n'a été vue que par ses auteurs sur du code. Le contrôle recommandé par la note V17 reste à faire : captures E2E des 5 secteurs, desktop et mobile (`npm run test:e2e` non exécuté).
- Accessibilité (`:focus-visible`, `prefers-reduced-motion`) : présence dans le CSS constatée dans le build, comportement non testé.
- Les points de vigilance Tailwind 4 de #18 §5.4 (rendu visuel jamais comparé avant / après) s'appliquent aussi aux 480 nouvelles lignes de CSS.
- Les points à faire de `RAPPORT_FUSION_18.md` §8 et `RAPPORT_FUSION_19.md` §7 restent valables (Upstash, Node ≥ 20.9, `0065` et `0066`, variables Fapshi, `npm audit`…).

Livré en zip du projet complet (`node_modules`, `.next` et `tsconfig.tsbuildinfo` exclus), fichiers à la racine. Reproduire : `npm ci && npm run typecheck && npm run lint && npm test && npm run build`.

## Annexe — fichiers touchés par rapport à la fusion #19

### Ajoutés (22)

- `LANDING_ART_DIRECTION_V18.md`
- `LANDING_ART_DIRECTION_V19.md`
- `LANDING_FINISH_PASS_V17.md`
- `RAPPORT_FUSION_20.md`
- `public/images/showcase/beauty-hero.svg`
- `public/images/showcase/default-hero.svg`
- `public/images/showcase/demo/realestate-1.jpg`
- `public/images/showcase/demo/realestate-2.jpg`
- `public/images/showcase/demo/realestate-3.jpg`
- `public/images/showcase/demo/realestate-4.jpg`
- `public/images/showcase/demo/realestate-hero.jpg`
- `public/images/showcase/demo/realestate-story.jpg`
- `public/images/showcase/demo/restaurant-1.jpg`
- `public/images/showcase/demo/restaurant-2.jpg`
- `public/images/showcase/demo/restaurant-3.jpg`
- `public/images/showcase/demo/restaurant-4.jpg`
- `public/images/showcase/demo/restaurant-hero.jpg`
- `public/images/showcase/demo/restaurant-story.jpg`
- `public/images/showcase/professional-hero.svg`
- `public/images/showcase/realestate-hero.svg`
- `public/images/showcase/restaurant-hero.svg`
- `public/images/showcase/retail-hero.svg`

### Modifiés (2)

- `src/app/_components/sector-home.tsx`
- `src/app/globals.css`
