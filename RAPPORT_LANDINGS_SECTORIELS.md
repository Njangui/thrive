# Restructuration des landings sectoriels — rapport

Deux templates livrés dans ce zip : **restaurant** (livré précédemment, rappelé
ici) et **prestataire de service** (nouveau, ce tour).

## Où regarder

```
src/app/_components/
├── restaurant/                    template restaurant (préfixe CSS rl-)
├── professional-services/         template prestataire de service (préfixe CSS ps-)
├── sector-shared/                 logique partagée entre templates sectoriels
│   ├── business-hours.ts          horaires : fonctions pures (DAYS, getHoursEntries, summarizeHours, dayIndex)
│   ├── use-today-index.ts         hook client partagé : quel jour sommes-nous dans le navigateur
│   ├── accent-theme.ts            contraste texte/accent (calcul WCAG), indépendant du secteur
│   ├── rating.ts                  moyenne d'avis réels (averageRating, formatAverage)
│   └── phone.ts                   lien tel: à partir d'un numéro saisi librement
├── landing-sections/hero.tsx      resolveCtaTarget extrait vers cta-target.ts (partagé restaurant+générique)
├── sector-home.tsx                RestaurantHome et ProfessionalServicesHome retirés (déplacés)
├── tenant-landing.tsx             branche les deux nouveaux templates
└── globals.css                    320 règles .rest-*/.pro-* supprimées au total, en-têtes déplacés
```

Pendant ce chantier, j'ai extrait dans `sector-shared/` ce que restaurant et
prestataire de service ont en commun (horaires, contraste de couleur, note
moyenne, téléphone) plutôt que de dupliquer : restaurant a été retouché pour
consommer ces modules partagés (comportement inchangé, ses 46 tests
repassent tous), et le nouveau template en bénéficie directement.

## Prestataire de service — ce qui a été corrigé

L'ancien `ProfessionalServicesHome` avait les mêmes familles de problèmes que
l'ancien restaurant, plus deux bugs propres à ce secteur :

| Avant | Après |
|---|---|
| Texte jusqu'à 8 px, bleu marine `#0c1422`/`#1d4ed8` en dur | 16 px minimum, couleurs de marque du commerçant |
| Bouton personnalisé du commerçant ignoré (toujours `/rendez-vous` ou `/contact`) | Respecté, avec repli WhatsApp → email → téléphone |
| **« Domaines d'intervention » utilisait les catégories PRODUITS** (comptées par nombre de *produits*) — toujours 0 pour un prestataire qui ne vend que des services, donc toujours le contenu d'exemple | Domaines calculés à partir du champ réel `categoryName` des services eux-mêmes ; compte exact, apparaît dès qu'un service a un domaine renseigné |
| **L'équipe affichait `member.role` tel quel** — ce champ est le rôle d'accès interne au tableau de bord (`owner`, `admin`, `cashier`, `employee`...), pas un intitulé de poste ; un visiteur pouvait voir « cashier » sous une photo | Nom uniquement ; aucun intitulé de poste inventé faute de donnée réelle |
| Note « 4,8 » → `NaN` (même bug que le restaurant) | Moyenne réelle calculée sur les avis notés |
| Section « La relation client » et « Notre méthode » (3 étapes) : texte marketing générique identique pour tous les prestataires, qu'il corresponde ou non à leur vraie façon de travailler | Retirées ; la section « Notre approche » n'existe que si le commerçant a écrit sa propre description |
| Aucune adresse/téléphone/horaires visibles nulle part | Hero + section dédiée avec adresse, horaires du jour, téléphone, email, WhatsApp |
| Photo de hero bleue générique imposée même sans rapport avec l'activité | Pas de photo par défaut : panneau sobre dans les couleurs de la marque tant qu'aucune photo réelle n'existe |

Un choix assumé, différent du restaurant : les promesses (`site.highlights`,
personnalisables par le commerçant dans le tableau de bord) sont ici
affichées dans le hero. En reconstruisant le restaurant je les avais
retirées en les jugeant trop généralistes — en creusant plus loin, elles
sont bien un champ éditable par le commerçant (pas figé), donc légitimes à
montrer. Le restaurant ne les affiche donc plus, ce template-ci si ; à
harmoniser si vous le souhaitez.

## Comportement du nouveau template

- **Hero** : nom réel, sous-titre fonctionnel, jusqu'à 2 boutons, note
  moyenne si des avis existent, jusqu'à 3 promesses, barre adresse/horaires
  du jour/téléphone.
- **Nos services** : jusqu'à 6 services réels (nom, durée, prix,
  description) ; contenu d'exemple signalé « Exemple » si aucun service.
- **Domaines d'intervention** : uniquement si au moins un service a un
  domaine renseigné ; jamais de domaines inventés.
- **Notre approche** : uniquement si le commerçant a écrit une description.
- **Qui vous accompagne** : uniquement si l'équipe contient au moins une
  personne réelle — jamais d'équipe fictive.
- **Ils nous font confiance** : avis réels ou, à défaut, avis d'exemple
  signalés, défilement horizontal natif au-delà de 3.
- **Demander un rendez-vous** : canal réellement disponible annoncé (en
  ligne / WhatsApp / email / téléphone), horaires, coordonnées.
- **Contenu d'exemple** : interrupteur `SHOW_DEMO_CONTENT` dans
  `services-model.ts`, indépendant de celui du restaurant.

## Tests

`services-model.test.ts` — 26 tests (mêmes méthodes que le restaurant :
succédané de vitest, à relancer avec le vrai). Avec les 46 tests restaurant
(inchangés après le refactor partagé), **72 tests** au total.

Points spécifiquement testés : agrégation des domaines à partir des vrais
services, absence totale du rôle d'accès interne dans la sortie du modèle
(assertion sur la sérialisation JSON), résolution des canaux de contact
(en ligne/WhatsApp/email/téléphone), calcul du thème de couleur.

## Vérifications faites / limites

Mêmes méthodes que pour le restaurant (rendu React statique + Chromium
headless, contrôle de types strict) :

- 7 scénarios rendus sans erreur : rempli, rempli+4 avis, nom très long
  avec palette sombre, accent jaune clair, services sans domaine renseigné,
  commerce vierge, minimal (comptable indépendant, sans équipe ni avis).
- Contrôle de types strict sur tous les fichiers `.ts`/`.tsx` écrits ou
  modifiés (restaurant, professional-services, sector-shared) : 0 erreur.
- Hydratation React réelle testée avec horloge simulée (jeudi/vendredi/
  samedi) : horaires du jour corrects, « Fermé aujourd'hui » quand le jour
  n'a pas d'horaires renseignés, aucune erreur console.
- Aucun débordement horizontal détecté à 1440 px ni 390 px.
- Contraste du bouton d'accent vérifié visuellement avec une couleur de
  marque jaune clair (texte foncé lisible, comme pour le restaurant, via le
  module partagé `accent-theme.ts`).

**Non fait**, mêmes raisons que pour le restaurant (pas de `npm install`
possible ici) : `npm run lint`, `next build`, le vrai `vitest`, le vrai
en-tête/pied de page de l'app, navigation clavier complète, lecteur d'écran
réel.

## Décision à prendre

Le lien "Explorer" de chaque domaine d'intervention pointe vers `/services`
en général (pas de filtre par domaine dans son URL) plutôt que vers une
ancre précise, pour rester strictement dans le périmètre de cette landing.
Si vous voulez un lien direct vers le bon groupe de la page `/services`, il
faudrait ajouter un `id` à chaque titre de groupe dans
`src/app/(site)/services/page.tsx` — petit changement, hors périmètre de ce
tour, je peux le faire si vous le souhaitez.

## À faire de votre côté avant mise en prod

1. `npm install && npm run lint && npx tsc --noEmit && npx vitest run`
2. `npm run dev`, ouvrir un tenant prestataire de service réel (avec et sans
   données) et comparer desktop/mobile
3. Décider si les deux interrupteurs de contenu d'exemple
   (`SHOW_DEMO_CONTENT` dans chaque `*-model.ts`) doivent rester actifs
4. `git diff` sur les 4 fichiers existants modifiés (`diffs-fichiers-existants.diff`)
   pour une revue ligne à ligne avant merge
