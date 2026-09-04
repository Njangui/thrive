# Rapport — Lot K : Landing page configurable par section et par secteur

Construit directement dans le dépôt déjà fusionné (`sme-os-fusionne.zip`,
227 tests, 33 routes, 0 erreur au point de départ — vérifié : `npm install`
réel, `typecheck`/`test`/`lint` exécutés réellement contre le code, pas
seulement raisonnés par lecture). `npm install` fonctionne dans cet
environnement ; `npm run build` fonctionne aussi, à une seule exception
près, connue et déjà documentée par les vagues précédentes — voir section 4.

## 1. Fichiers créés

**Migration**
- `supabase/migrations/0031_landing_sections.sql` — `organization_landing_config`
  (sections/ordre/couleurs/police) + `testimonials`, RLS `is_member_of_org`
  sur les deux tables.

**Domaine et configuration**
- `src/domain/entities/landing.ts` — schémas zod (15 types de section,
  `LandingSection`, `FontChoice`, regex couleur hex, `Testimonial`).
- `src/application/config/landing-presets.ts` — `LANDING_PRESETS`
  (boutique/salon/restaurant/default), `resolveIndustryPresetKey`,
  `buildDefaultSections`, `LANDING_SECTION_LABELS`.
- `src/application/config/landing-presets.test.ts` — 14 tests.

**Service central**
- `src/application/services/landing-config-service.ts` — `getLandingConfig`/
  `updateLandingConfig`, lecteurs par type de section (`services`,
  `categories`+comptes, `promotions`, `gallery`, `team`, `faq`),
  `getLandingSectionData` (dispatcher), CRUD témoignages.
- `src/application/services/landing-config-service.test.ts` — 11 tests
  (dont le cas explicitement demandé : `getLandingConfig` avec/sans ligne
  existante).

**Branding — n'existaient pas malgré ce que le cahier suppose (voir section 3)**
- `src/app/fonts.ts` — 3 choix de police (`modern`/`classic`/`friendly`).
- `src/lib/tenant-branding.ts` — `getTenantBrandingStyle`,
  `resolveTenantFontClassName`.

**Utilitaire partagé**
- `src/lib/format.ts` — `formatPrice`, extrait de deux copies identiques
  préexistantes (voir section 3).

**Composants de section publique** (`src/app/_components/landing-sections/`)
- `hero.tsx`, `about.tsx`, `products.tsx`, `services.tsx`, `categories.tsx`,
  `promotions.tsx`, `gallery.tsx`, `testimonials.tsx`, `team.tsx`, `faq.tsx`,
  `contact.tsx`, `location.tsx`, `social-links.tsx`, `cta.tsx`, `footer.tsx`
  (toujours rendu, jamais désactivable).
- `booking.tsx`, `booking-form.tsx` (Client Component), `booking-actions.ts`
  (Server Action publique, sans `requireMembership` — visiteur anonyme,
  voir section 3).

## 2. Fichiers modifiés

- `src/app/_components/tenant-landing.tsx` — **réécrit** : orchestrateur qui
  itère sur `getLandingConfig(...).sections` (activées, triées) au lieu de
  la structure fixe précédente (hero + grille 6 produits + contact).
- `src/app/page.tsx` — retire le chargement de produits (déplacé dans
  `TenantLanding`, sinon double-requête/requête inutile selon les
  sections activées) ; ajoute `searchParams` pour le feedback succès/erreur
  de la demande de rendez-vous publique.
- `src/app/dashboard/site/page.tsx` — **étendu** (pas réécrit dans son
  esprit, mais substantiellement enrichi) : bloc "Sections de ma page"
  (activation + monter/descendre), bloc "Couleurs et police", bloc
  "Réseaux sociaux", bloc "Témoignages" (ajout/suppression). 5 nouvelles
  Server Actions : `toggleSectionAction`, `moveSectionAction`,
  `updateBrandingAction`, `createTestimonialAction`,
  `deleteTestimonialAction` — toutes `requireMembership(orgId, ["owner",
  "admin", "manager"])` (cahier Lot K).
- `src/application/services/site-service.ts` — `SiteMedia`/
  `UpdateSiteMediaInput` étendus avec `socialLinks` (colonne
  `organizations.social_links`, déjà lue par la vitrine publique mais
  jamais écrite nulle part avant ce lot — vérifié).
- `src/application/services/catalog-service.ts` —
  `listActiveProductsForStorefront`/`countActiveProducts` acceptent un
  filtre `categoryId` optionnel ; nouvelle fonction `getCategoryBySlug`.
- `src/app/produits/page.tsx` — filtre `?category=<slug>` (lien "voir
  tout" de la section landing "categories") ; applique désormais les
  couleurs/police de marque.
- `src/app/produits/[slug]/page.tsx` — applique désormais les couleurs/
  police de marque (cohérence visuelle avec la landing page) ; réutilise
  `formatPrice` partagé au lieu de sa copie locale.
- `src/app/_components/product-card.tsx` — réutilise `formatPrice`
  partagé au lieu de sa copie locale (comportement inchangé).
- `docs/DATABASE.md` — entrée `0031_landing_sections.sql`.

## 3. Décisions et hypothèses prises

**Le cahier suppose plusieurs choses qui n'existaient pas — vérifié par
lecture exhaustive du dépôt avant d'écrire le moindre code, pas supposé.**

- **`getTenantBrandingStyle`/`src/app/fonts.ts`** : le cahier les décrit
  comme "existant". Recherche exhaustive (`grep -r` sur tout `src/`) :
  aucun des deux fichiers n'existait, `tenant-branding.ts` n'était même
  jamais mentionné ailleurs que dans un commentaire de
  `site-service.ts` disant explicitement que cette personnalisation
  "n'existe TOUJOURS PAS". En revanche, `tailwind.config.ts` avait déjà
  posé les variables CSS `--brand-primary`/`--brand-secondary`/
  `--font-display`/`--font-body` avec un commentaire disant qu'elles
  n'étaient "pas encore branchées" — ce lot construit exactement ce
  branchement, pas une réécriture du système de thème.
- **`organizations.industry` "texte libre"** : en pratique, l'onboarding
  actuel (`onboarding-wizard.tsx::INDUSTRY_OPTIONS`) produit une des 5
  valeurs contrôlées `retail`/`restaurant`/`beauty`/
  `professional_services`/`real_estate` (ou vide). `resolveIndustryPresetKey`
  gère donc DEUX cas, pas un seul : les mots-clés couvrent à la fois ces
  valeurs contrôlées (`retail`→boutique, `beauty`→salon, `restaurant`→
  restaurant) ET du texte libre arbitraire (le comportement littéralement
  demandé par le cahier — une organisation créée avant ce wizard, ou
  modifiée à la main, peut porter n'importe quelle valeur dans cette
  colonne `text` non contrainte). `professional_services`/`real_estate`
  n'ont pas d'équivalent parmi boutique/salon/restaurant : repli
  `default`, assumé explicitement (14 tests couvrent les deux familles de
  cas, voir `landing-presets.test.ts`).
- **Le flux de réservation publique n'existait pas** : `appointment-service.ts`
  existe (Lot E), mais `createAppointment` n'était appelé QUE depuis
  `/dashboard/appointments`, derrière `requireMembership` — aucun point
  d'entrée public. Le cahier est explicite ("pas une section
  décorative") : ce lot construit le vrai formulaire public
  (`booking-form.tsx`) + la Server Action publique
  (`booking-actions.ts`, volontairement SANS `requireMembership` — un
  visiteur anonyme n'a pas de session à vérifier, même raisonnement que
  `track-click-action.ts` pour le tracking de clics) + une notification
  best-effort au staff (`notifyOrgAdmins`). Une demande publique crée un
  rendez-vous `status: "scheduled"` (comportement déjà existant de
  `createAppointment`) que le commerçant confirme/annule ensuite depuis
  le dashboard existant — pas de nouvel état ni de nouvelle colonne
  nécessaire.
- **`profiles.full_name`/`avatar_url` ne sont écrits par AUCUN écran de ce
  projet** — vérifié (`grep` : zéro écriture `.from("profiles")` dans
  tout le code fourni, y compris le flux de connexion, qui est un simple
  lien magique sans capture de nom). La section "team" lit quand même
  `memberships`+`profiles` comme demandé, mais avec un repli sur un
  libellé de rôle (ex : "Responsable") quand le nom est absent — jamais
  une carte vide/cassée. Le cahier autorise explicitement à ne pas
  construire "un futur champ photo/bio" ("si vous en ajoutez un") :
  aucune UI d'édition de profil n'a été ajoutée, ce gap pré-existant
  reste documenté ici plutôt que masqué.
- **Filtrage de catalogue par catégorie** (`/produits?category=<slug>`) :
  pas explicitement demandé par le cahier pour la section "categories",
  mais construit quand même — sans lui, chaque vignette de catégorie
  aurait mené vers le catalogue générique non filtré, ce qui aurait été
  un lien "presque" fonctionnel plutôt que réellement utile. Changement
  petit et contenu (filtre optionnel sur une fonction déjà existante +
  une fonction de résolution slug→id).
- **Réseaux sociaux** : `organizations.social_links` était déjà lu par la
  vitrine publique (`resolve-request-tenant.ts`) mais jamais écrit nulle
  part — la section "social_links" du cahier aurait donc été
  perpétuellement vide pour toute entreprise réelle. Ajout d'un bloc
  simple (Facebook/Instagram/TikTok/LinkedIn) à `/dashboard/site`,
  branché sur `site-service.ts` (même table `organizations`, même écran
  — pas un second service pour 4 champs texte).
- **`getLandingSectionData`** existe et est testé indirectement via les
  tests `getLandingConfig`/section — la page publique
  (`tenant-landing.tsx`) l'appelle réellement pour chaque section activée
  qui a besoin d'une lecture DB (products/services/categories/
  promotions/gallery/testimonials/team/faq/booking) ; hero/about/contact/
  location/social_links/cta lisent directement le `TenantContext` déjà
  résolu par la page, une requête DB dédiée serait redondante.
- **Comparaisons de colonnes SQL non supportées par le query builder
  Supabase fluide** (`compare_at_price > unit_price` pour les
  promotions) : filtrées en mémoire après sur-échantillonnage plutôt que
  via une fonction SQL dédiée non demandée par le cahier — documenté
  dans le code (`listPromotedProductsForStorefront`).
- **Pas de relation directe `memberships`→`profiles`** en base (les deux
  référencent `auth.users` séparément) : `listTeamMembers` fait deux
  requêtes + fusion en mémoire plutôt qu'un embed PostgREST qui aurait
  échoué au runtime (aucune FK directe entre les deux tables).

## 4. Ce qui a été vérifié — réellement, pas seulement raisonné

- `npm install` réel (493 paquets, aucune nouvelle dépendance ajoutée —
  `next/font/google` était déjà utilisé par `layout.tsx`).
- `npm run typecheck` → **0 erreur**.
- `npm run test` → **252 tests passants** (227 de départ + 25 nouveaux :
  14 `landing-presets.test.ts` + 11 `landing-config-service.test.ts`).
- `npm run lint` → **0 erreur/avertissement** (2 corrigées : apostrophes
  non échappées, `react/no-unescaped-entities`).
- `npm run build` → **échoue uniquement sur l'accès réseau à Google
  Fonts** (`fonts.googleapis.com` non joignable dans cet environnement
  sandboxé — déjà documenté par `RAPPORT_FUSION_3.md` pour les polices
  globales existantes de `layout.tsx`). Pour vérifier que le reste
  compile réellement, les appels `next/font/google` de `layout.tsx` ET du
  nouveau `fonts.ts` ont été temporairement remplacés par des stubs
  locaux sans réseau (même méthode que les vagues précédentes,
  "contournement temporaire et sans conséquence du fetch réseau
  `next/font`, annulé immédiatement après vérification") — avec des
  variables d'environnement Supabase factices (`.env.local` temporaire,
  supprimé après coup) pour dépasser aussi la vérification
  `src/lib/env.ts`. Résultat : **build complet réussi, 33 routes
  générées** (aucune route ajoutée — ce lot étend des composants et pages
  existants, il n'ajoute aucun fichier `page.tsx`/`route.ts` nouveau).
  Les fichiers `layout.tsx` et `fonts.ts` ont été restaurés à l'identique
  immédiatement après (diff vérifié : `layout.tsx restored OK`, `fonts.ts
  restored OK`) — le code livré n'a jamais contenu ces stubs.
- Chaque critère d'acceptation du cahier vérifié individuellement :
  - Secteur "salon" → sections par défaut Services/Équipe/Galerie/
    Rendez-vous/Contact, pas Produits/Promotions, sans ligne
    `organization_landing_config` existante : couvert par
    `landing-presets.test.ts` + `landing-config-service.test.ts`
    (`"calcule (sans persister) le preset..."`).
  - Désactiver une section → disparaît de `/` immédiatement : `/` est une
    route dynamique (dépend de `resolveRequestTenant()`, jamais mise en
    cache statiquement — confirmé `ƒ /` dans la sortie de build, pas
    `○`), et `toggleSectionAction` fait un aller-retour serveur complet
    avant redirection ; aucun cache applicatif n'a été ajouté par ce lot.
  - Section "booking" → flux fonctionnel réel : formulaire public → 
    Server Action → `createAppointment` (déjà testé, Lot E) → notification
    staff best-effort → rendez-vous visible et confirmable depuis
    `/dashboard/appointments` (déjà existant, inchangé).
  - Test unitaire mapping industry → preset : 14 cas (le cahier en
    demandait au moins 4).
  - `typecheck`/`test`/`lint` passants : voir ci-dessus.

## 5. Limites connues restantes

- **`profiles.full_name`/`avatar_url` jamais éditables** (voir section 3)
  — la section "Équipe" reste utile (rôles réels affichés) mais moins
  personnalisée qu'elle pourrait l'être tant qu'aucun lot ne construit un
  écran d'édition de profil. Explicitement permis par le cahier de ce
  lot ; noté ici pour un lot futur, pas caché derrière "hors scope".
- **Pas de connecteur d'avis Google/Facebook** pour les témoignages —
  saisie manuelle uniquement, comme la plupart des données de ce projet
  (cohérent avec l'absence de tout autre connecteur d'avis ailleurs dans
  le code, et non demandé par le cahier).
- **`config` par section** (`organization_landing_config.sections[].config`)
  existe au niveau du schéma (JSONB + zod `passthrough`) mais n'est
  utilisé par aucune section de ce lot — prêt pour une évolution future
  sans migration supplémentaire, pas un TODO fonctionnel : aucune
  section de ce lot n'a besoin de réglage plus fin que activé/ordre.
- **`npm run build` non vérifiable de bout en bout dans cet environnement
  sandboxé** faute d'accès réseau à `fonts.googleapis.com` — voir section
  4 pour la méthode de vérification indirecte utilisée (stub temporaire,
  annulé). Le porteur du projet, en environnement réel avec accès
  réseau, devra simplement lancer `npm run build` normalement — rien de
  spécifique à ce lot ne change ce comportement déjà connu des vagues
  précédentes.

## 6. Migrations à appliquer

- `supabase/migrations/0031_landing_sections.sql` — seule migration de ce
  lot (plage `0031`-`0032` assignée, `0032` non utilisée : aucun besoin
  identifié d'une seconde migration pour ce périmètre).

## 7. Variables d'environnement à configurer

Aucune — ce lot n'introduit aucun nouveau fournisseur externe, aucune
nouvelle clé API. Tout repose sur l'infrastructure Supabase déjà
configurée par les lots précédents.
