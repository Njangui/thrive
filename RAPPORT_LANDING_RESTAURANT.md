# Restructuration du landing restaurant — rapport

## Ce qui a été livré

Un zip complet du projet (`thrive-main-restaurant-landing.zip`) avec le nouveau
template restaurant branché, l'ancien retiré, et le CSS mort nettoyé.

## Où regarder

```
src/app/_components/restaurant/
├── restaurant-model.ts        toute la logique de décision (fonctions pures, testées)
├── restaurant-model.test.ts   46 tests
├── restaurant-hours.ts        horaires : fonctions pures
├── restaurant-theme.ts        contraste texte/accent (calcul WCAG)
├── restaurant-ui.tsx          briques partagées : bouton, titre, prix, ligne de carte, étoiles
├── restaurant-home.css        toute la feuille de style (préfixe rl-)
├── restaurant-home.tsx        assemblage de la page
├── hours-client.tsx           2 composants clients (jour courant)
└── sections/
    ├── hero.tsx, dishes.tsx, menu.tsx, story.tsx,
    └── gallery.tsx, testimonials.tsx, visit.tsx
```

Fichiers existants modifiés (diffs courts, ci-dessous) :
- `src/app/_components/tenant-landing.tsx` — branche `RestaurantHome`, charge produits+galerie
- `src/app/_components/sector-home.tsx` — ancien `RestaurantHome` supprimé
- `src/app/_components/landing-sections/hero.tsx` — `resolveCtaTarget` extrait vers `cta-target.ts`
- `src/app/globals.css` — 129 règles `.rest-*` supprimées, 29 allégées, en-tête restaurant retiré (déplacé dans `restaurant-home.css`)

## Problèmes corrigés (par rapport à l'ancien template)

| Avant | Après |
|---|---|
| Texte jusqu'à 8 px | 16 px minimum partout |
| Couleurs `#06221d` / `#ef8c35` en dur | `--brand-primary` / `--brand-secondary` du commerçant |
| Bouton personnalisé du commerçant ignoré | Respecté (`ctaUrl`/`ctaLabel`, avec repli WhatsApp puis téléphone) |
| « CUISINE LOCALE & INTERNATIONALE », promesses inventées | Rien d'affirmé que le commerçant n'a pas dit |
| `Number("4,8")` → `NaN`, note jamais affichée | Moyenne réelle calculée sur les avis notés uniquement |
| Flèches `‹ ›` des avis qui ne font rien | Défilement natif au doigt/à la molette (mobile), grille figée (desktop) |
| Même photo au hero et à l'histoire | Chaque photo n'apparaît qu'une fois sur la page |
| En-tête défini à 4 endroits dans `globals.css`, recouvre la barre d'annonce | Un seul endroit, l'en-tête reste dans le flux |
| Plats phares, adresse, horaires absents malgré la promesse du preset | Tous présents |
| Sous-titre générique répétant le nom | Décrit ce qu'on peut faire ici (réserver / voir la carte), ou rien si aucun des deux |
| Accent clair (jaune) → texte illisible | Contraste calculé automatiquement (WCAG), texte foncé ou blanc selon la couleur réelle |

## Comportement du nouveau template

- **Hero** : nom réel du restaurant, 1-2 boutons résolus dynamiquement, note moyenne si des avis existent, barre adresse/horaires-du-jour/téléphone.
- **Plats phares** : 4 mises en page selon les photos réellement disponibles (vedette seule / vedette+liste / grille de cartes / liste texte) — jamais de carré gris « photo à venir ».
- **La carte** (fond sombre) : catégories en lignes pointillées, n'apparaît que si au moins une catégorie contient des plats.
- **Notre maison** : uniquement si le commerçant a écrit une description longue — pas de texte d'ambiance générique.
- **Galerie** : mosaïque (5+ photos) ou rangée de 3, jamais de photo déjà utilisée plus haut.
- **Avis** : jusqu'à 6, défilement horizontal natif au-delà de 3.
- **Réserver** : canal réel annoncé (en ligne / WhatsApp / téléphone), tableau des horaires avec le jour courant en gras.
- **Contenu d'exemple** : pour un commerce tout juste créé (aucun plat, aucune catégorie), une carte et des avis fictifs s'affichent, toujours signalés « Exemple ». Un seul interrupteur (`SHOW_DEMO_CONTENT` dans `restaurant-model.ts`) les retire complètement — à activer/désactiver selon votre préférence produit.

## Tests

`restaurant-model.test.ts` — 46 tests sur toute la logique pure : résolution des
boutons, horaires, note moyenne, disposition des plats, unicité des photos,
canal de réservation, contraste de l'accent. Exécutés avec un petit
succédané de `vitest` (pas de réseau disponible ici pour `npm install`) — **à
relancer avec le vrai `vitest` avant de merger**.

## Vérifications faites / limites

Fait, via rendu React statique + Chromium headless (captures desktop 1440px
et mobile 390px) :
- 10 scénarios : commerce rempli, vierge, minimal (sans photo), un seul plat,
  3 plats, 4 avis, nom très long + police serif + palette sombre, accent
  jaune clair, accent gris moyen, barre d'annonce active.
- Contrôle de types strict sur tous les fichiers `.ts`/`.tsx` écrits : 0 erreur.
- Hydratation React réelle testée avec horloge simulée (jeudi/vendredi/dimanche)
  pour vérifier le composant client des horaires : jour correct affiché à
  chaque fois, aucune erreur console.
- Aucun débordement horizontal détecté à 1440px ni 390px sur les scénarios testés.

**Non fait**, faute d'environnement complet (pas de `npm install`, donc pas de
vrai Next.js) :
- `npm run lint`, `next build`, le vrai `vitest`.
- Rendu avec le véritable en-tête / pied de page de l'app (j'ai simulé l'en-tête
  dans le harnais de test — la version réelle peut réagir différemment,
  notamment sur un nom très long en mobile).
- Navigation clavier complète, lecteur d'écran réel.
- Le hero générique (`hero.tsx`, composition personnalisée) n'a pas été
  recapturé après le changement de marge négative de l'en-tête — à vérifier.

## À faire de votre côté avant mise en prod

1. `npm install && npm run lint && npx tsc --noEmit && npx vitest run`
2. `npm run dev`, ouvrir un tenant restaurant réel (avec et sans données) et comparer desktop/mobile
3. Vérifier le hero générique (secteur restaurant, composition personnalisée) — il remonte maintenant sous l'en-tête par une marge négative, comme le nouveau hero par défaut
4. Décider si le contenu d'exemple (`SHOW_DEMO_CONTENT`) doit rester actif
5. `git diff` sur les 4 fichiers modifiés pour une revue ligne à ligne avant merge
