# Refonte design SME-OS — landing marketing + console Super Admin

## Comment appliquer

Ce zip contient uniquement les fichiers modifiés ou ajoutés (25 fichiers),
avec les mêmes chemins relatifs que ton dépôt. Copie le contenu de `src/`
et `tailwind.config.ts` par-dessus ton projet (écrase les fichiers
existants aux mêmes chemins). Rien d'autre n'a été touché.

Après copie :
```
npm install   # si tu n'as pas déjà les deps (aucune nouvelle ajoutée)
npm run typecheck
npm run lint
npm run test
npm run build
```
J'ai fait tourner les 4 chez moi (420 tests, build complet 47/47 pages) —
seul `next/font/google` ne peut pas être vérifié dans mon environnement
(pas d'accès à fonts.googleapis.com), ça se chargera normalement chez toi
au build.

## Palette (extraite par échantillonnage de pixels sur ta capture)

| Rôle | Hex |
|---|---|
| Violet primaire (CTA, liens, boutons) | `#5B21E5` |
| Sidebar navy | `#0E1130` |
| Item sidebar actif | `#5027B9` |
| Dégradé magenta ("Populaire") | `#9A1FD8` → `#B026DE` |
| Succès (fond / texte) | `#E4F8EE` / `#16A34A` |
| Attente (fond / texte) | `#FEF4E3` / `#D97706` |
| Erreur (fond / texte) | `#FEEBEA` / `#DC2626` |
| Fond page admin | `#F7F6FD` |

Tokens ajoutés dans `tailwind.config.ts` : `violet-*`, `magenta-*`,
`navy-*`, `success-*`, `warning-*`, `danger-*`, `font-jakarta` (Plus
Jakarta Sans, titres), `font-inter` (Inter, texte courant). Namespace
séparé de `ink/paper/leaf/clay/muted` (thème de la vitrine tenant, non
touché) et de `brand-*` (personnalisation par tenant, non touché).

## Ce qui a changé

**Landing marketing** (`_components/marketing-landing.tsx` +
`marketing-mobile-menu.tsx` + nouveau `marketing-icons.tsx`) : refonte
visuelle complète au style violet/indigo. Contenu, structure, ancres de
nav (#fonctionnalites/#comment-ca-marche/#tarifs/#faq) et tarifs
DB-driven strictement identiques à avant — seul l'habillage change.

**Console Super Admin** (`/admin/*`) : sidebar navy avec les vraies
sections du projet (pas les items boutique de ta capture), topbar avec
recherche réellement câblée sur `/admin/organizations?q=`. La page Vue
globale a un vrai graphique de revenus (7j) et un vrai donut de
répartition des entreprises — j'ai étendu `admin-overview-service.ts`
pour calculer ces deux séries à partir de données réelles, rien n'est
inventé. Les 8 autres pages admin ont été restylées (mêmes couleurs,
mêmes composants de carte/tableau/badge) sans toucher à leur logique.

## Décisions à connaître

- **Pas de cloche de notifications** dans la topbar : ta référence en a
  une, mais aucun système de notifications admin n'existe dans le
  projet — j'ai préféré l'omettre plutôt que simuler un badge avec un
  chiffre inventé.
- **Pas de sélecteur de période** ("7 derniers jours" dans ta
  référence) : aucune plage n'est réellement câblée derrière, donc pas
  de faux contrôle — la fenêtre réelle utilisée (30j / 7j) est juste
  indiquée en texte.
- **Donut de la Vue globale** : j'ai utilisé des couleurs sémantiques
  (vert/ambre/rouge/gris) plutôt que 4 nuances de violet comme dans ta
  référence, parce que ce donut représente des statuts (actif/essai/
  suspendu), pas des catégories de produits — 4 violets auraient rendu
  actif et suspendu indiscernables.
- **Badge "Populaire"** sur les tarifs : posé sur le plan `business`
  (correspond au plan du milieu). Si un jour un 4ᵉ plan est ajouté ou
  que l'ordre change, ajuste `popularPlanKey` dans
  `marketing-landing.tsx`.
- **Aperçu décoratif** dans le hero de la landing (chiffres à blanc,
  mini graphique) : illustration pure, comme sur toute landing SaaS —
  aucune donnée réelle affichée, jamais présentée comme un vrai relevé.
- J'ai ajouté un champ `email` à `PlatformAdmin`
  (`platform-admin-service.ts`) pour alimenter l'identité dans la
  topbar (aucune requête supplémentaire, `user.email` était déjà
  disponible). Le test associé a été mis à jour en conséquence.

## Pour Habynex (le projet "sans entreprises tenant")

Cette palette/ces tokens sont prêts à être réappliqués tels quels — le
bloc `violet/magenta/navy/success/warning/danger` +
`font-jakarta`/`font-inter` de `tailwind.config.ts` et les classes
`mkt-*`/`adm-*` de `globals.css` peuvent être copiés directement dans
le projet Habynex. Il faudra juste adapter la structure de la sidebar
`admin-main` aux vraies sections de ce projet (pas de service SME-OS à
réutiliser, Habynex étant un dépôt séparé) — dis-moi quand tu es prêt à
me passer ce code et je fais la même passe là-bas.
