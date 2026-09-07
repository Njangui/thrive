# Rapport — Lot H : Analytics, SEO, Observabilité Super Admin

## 0. Note sur le niveau de finition demandé

Consigne reçue en cours de lot : optimiser et livrer "la meilleure version"
de chaque fonctionnalité plutôt que le strict minimum. Arbitrage appliqué,
documenté ici pour que la fusion sache où j'ai volontairement dépassé le
cahier et où je m'en suis tenu à sa lettre :

- **SEO (Partie 1)** — rien dans le "Hors scope" du cahier ne l'exclut :
  version complète (meta + Open Graph + **Twitter Card** + **URL
  canonique** + **JSON-LD** Organization/Product + **sitemap.xml +
  robots.txt** par tenant), au-delà des 3 balises explicitement demandées.
- **Analytics (Partie 2)** — le master prompt (§55) et le cahier
  interdisent EXPLICITEMENT "funnels, cohortes, A/B testing, dashboards
  graphiques". Je ne les ai PAS ajoutés. "Meilleure version" ici = l'
  implémentation la plus robuste et la mieux testée de exactement ce qui
  est demandé (compteurs bruts), pas plus de features.
- **Observabilité admin (Partie 3)** — seul "alerting temps réel" est
  explicitement hors scope. J'ai ajouté pagination/filtre déjà demandés +
  **export CSV** (reste un export passif à la demande, pas de l'alerting).

## 1. Fichiers créés

**Migrations**
- `supabase/migrations/0022_seo_fields.sql`
- `supabase/migrations/0023_analytics_events.sql`

**SEO (Partie 1)**
- `src/lib/seo.ts` + `.test.ts` — résolution pure title/description/OG
  (`resolveOrganizationSeo`, `resolveProductSeo`) + builders JSON-LD
  (`buildOrganizationJsonLd`, `buildProductJsonLd`)
- `src/app/sitemap.ts`, `src/app/robots.ts` — par tenant, au-delà du cahier

**Analytics (Partie 2)**
- `src/application/services/analytics-service.ts` + `.test.ts`
- `src/app/_components/track-click-action.ts` (Server Action)
- `src/app/_components/tracked-cta-link.tsx` (composant client)

**Observabilité Super Admin (Partie 3)**
- `src/application/services/admin-observability-service.ts` + `.test.ts`
- `src/app/admin/logs/page.tsx`
- `src/app/admin/logs/export/route.ts` (export CSV, au-delà du cahier)

## 2. Fichiers modifiés

- `src/application/services/catalog-service.ts` — `seoTitle`/
  `seoDescription` sur `CatalogProductDetail`/`getProductBySlug`,
  `UpdateProductInput`/`updateProduct`, `ProductForEdit`/`getProductForEdit`
- `src/application/services/site-service.ts` — champs SEO organisation
  (voir §3, décision de ne PAS créer `tenant-branding-service.ts`)
- `src/application/services/media-service.ts` — `MediaType` + `"seo_og"`
- `src/infrastructure/tenant/resolve-request-tenant.ts` — `TenantContext`
  + `seoTitle`/`seoDescription`/`seoOgImageUrl` ; nouvelle fonction
  `resolveRequestOrigin()` (voir §4)
- `src/application/services/lead-service.ts` — `trackEvent("lead_created")`
- `src/application/services/order-service.ts` — `trackEvent("order_created")`
- `src/application/services/marketing-service.ts` —
  `trackEvent("publication_published")` (voir §4, limite documentée)
- `src/app/page.tsx` — `generateMetadata` complet + JSON-LD + `trackEvent("page_view")`
- `src/app/produits/[slug]/page.tsx` — idem côté produit + `trackEvent("product_view")`
- `src/app/_components/tenant-landing.tsx` — CTA WhatsApp → `TrackedCtaLink`
- `src/app/dashboard/site/page.tsx` — champs SEO organisation (titre/description/image)
- `src/app/dashboard/products/[id]/edit/page.tsx` — champs SEO produit (voir §4)
- `src/app/dashboard/page.tsx` — section "Activité (30j)"
- `src/app/admin/layout.tsx` — entrée nav "Logs"
- `src/app/admin/organizations/page.tsx` — compteurs d'usage (édition ciblée, pas de réécriture)

## 3. Décisions de portée notables

- **Pas de `tenant-branding-service.ts` séparé** — le cahier proposait les
  deux options ("nouveau fichier, OU étendre un service équivalent si
  vérifié avant de créer"). `site-service.ts` gère déjà exactement le même
  type de colonnes `organizations` (logo/bannière/favicon), affichées sur
  la même page `/dashboard/site` — j'ai étendu ce fichier plutôt que d'en
  créer un second pour 3 colonnes de plus sur la même table (DRY).
- **`getTenantBrandingStyle`/`src/lib/tenant-branding.ts`/`src/app/fonts.ts`
  confirmés absents** — `00_CONVENTIONS_COMMUNES_V2.md` les présente comme
  existants ; j'ai vérifié dans le dépôt réel (pas supposé) : ils
  n'existent pas (déjà noté dans `RAPPORT_LOT_E.md`). Sans impact sur ce
  lot (le SEO n'en dépend pas), mais à signaler pour les lots F/G/I/J qui
  pourraient s'appuyer sur la même hypothèse fausse.
- **Champs SEO produit ajoutés à l'écran d'édition, non listés
  explicitement par le cahier pour cette page** — sans ça, `seo_title`/
  `seo_description` du produit (étendus côté backend comme demandé) ne
  seraient réglables par AUCUNE interface, ce qui aurait rendu vide de
  sens le critère d'acceptation correspondant. Ajout minimal (2 champs
  texte), documenté en commentaire dans le fichier.
- **Section "Activité (30j)" volontairement partielle** — 4 compteurs sur
  les 8 event_type existants (`page_view`, `product_view`, `cta_click`,
  `publication_published`). `lead_created`/`order_created` auraient fait
  doublon avec les cartes déjà existantes du dashboard (lues directement
  depuis `leads`/`orders`, pas depuis `analytics_events`) ;
  `product_click`/`conversation_started` ne sont émis par aucun point
  d'appel de ce lot (le cahier ne le demandait pas) — les afficher à zéro
  en permanence aurait été trompeur.
- **CTA "Contact" non trouvé** — le cahier mentionne "clics CTA
  (WhatsApp/Contact)" mais la vitrine actuelle n'a qu'un seul type de CTA
  cliquable (WhatsApp, landing + fiche produit). Aucun bouton "Contact"
  distinct n'existe dans le code fourni — je n'en ai pas inventé un ; les
  deux CTA WhatsApp existants sont trackés.

## 4. Décisions techniques notables

- **`resolveRequestOrigin()` plutôt que `env.NEXT_PUBLIC_APP_URL`** pour
  `alternates.canonical`, Open Graph `url`, JSON-LD `url` et
  `sitemap.xml`/`robots.txt` : `NEXT_PUBLIC_APP_URL` (déjà utilisé ailleurs
  dans le projet, ex. liens WhatsApp de `marketing-service.ts`) pointe vers
  le domaine générique de la plateforme, jamais vers le sous-domaine/
  domaine custom réellement visité — l'utiliser dans un sitemap aurait
  produit des URLs pointant vers le mauvais domaine. `resolveRequestOrigin`
  lit le header `host` déjà propagé par `src/middleware.ts` pour la requête
  courante. Limite assumée et documentée dans le code : sur un domaine
  custom pas encore vérifié par le Lot G, le comportement reste celui du
  header `host` brut, pas une résolution DNS distincte.
- **`publication_published` déclenché à la PROGRAMMATION réussie auprès de
  Zernio, pas à la diffusion réelle** — ce projet n'a pas encore de sync
  webhook `post.*` confirmant qu'une publication programmée a été
  effectivement diffusée (`docs/ROADMAP.md`, point 2, non fait). Plutôt que
  de laisser l'ambiguïté, j'ai documenté le choix dans le code
  (`marketing-service.ts`) — à déplacer vers le futur handler webhook
  quand ce sync existera.
- **`trackEvent` toujours `await`é côté serveur** (page.tsx,
  produits/[slug]/page.tsx, lead/order/marketing-service.ts), jamais un
  vrai fire-and-forget non attendu — le cahier suggère
  `.catch()`/fire-and-forget, mais le pattern déjà établi dans ce projet
  pour ce type de fonction (`notifyOrgAdmins`, jamais rejetée mais toujours
  `await`ée) protège contre l'interruption d'une promesse non attendue par
  une plateforme serverless une fois la réponse partie. Seul l'appel
  client (`tracked-cta-link.tsx`, clic CTA) reste un vrai fire-and-forget,
  parce qu'il tourne hors du cycle de vie d'une requête serveur.
- **JSON-LD Product omis pour un produit non-actif** — on ne fait pas la
  promotion structurée d'un produit draft/rupture/inactif auprès de
  Google, même si la page reste consultable par lien direct.

## 5. Ce qui a été vérifié — et comment

**Vérifié :**
- Chaque colonne/table utilisée a été confrontée aux migrations réelles
  (`0001`, `0003`, `0006`, `0008`) et au schéma proposé par le cahier lui-même
  avant écriture — pas de nom de colonne deviné.
- **Typecheck partiel réel exécuté** (pas seulement un parsing) : sans
  accès réseau ni `node_modules` (le registre npm renvoie 403 dans cet
  environnement), j'ai construit des déclarations de types minimales pour
  les paquets tiers (`next`, `react`, `@supabase/supabase-js`, `vitest`,
  `zod`...) et fait tourner `tsc --noEmit` avec le `tsconfig.json` réel du
  projet (mêmes `strict`, `noUncheckedIndexedAccess`, alias `@/*`). Chaque
  erreur relevée a été croisée avec le code PRÉ-EXISTANT non modifié par ce
  lot : toutes proviennent soit de mes stubs volontairement grossiers
  (absence de `@types/node`, vérification JSX `children`/`key` incomplète
  sans les vrais types React), soit de motifs déjà présents ailleurs dans
  le projet — jamais d'un fichier de ce lot isolément. `src/app/sitemap.ts`
  et `src/app/robots.ts` compilent sans aucune erreur une fois le stub
  `MetadataRoute` corrigé pour refléter la vraie API Next.js (namespace,
  pas un type plat). Fichier de stubs et tsconfig temporaire supprimés
  avant livraison — ils ne font pas partie du projet.
- Vérification manuelle des 33 nouveaux tests (logique de repli SEO,
  agrégation analytics, CSV, usage admin) contre leur implémentation ligne
  à ligne — voir aussi le format CSV vérifié caractère par caractère dans
  les tests d'échappement.
- Équilibre parenthèses/accolades/crochets vérifié par script sur
  l'ensemble des fichiers créés/modifiés.

**PAS vérifié — limite d'environnement, pas de fausse déclaration :**
- **Aucune exécution réelle de `npm run typecheck`/`test`/`lint`** (mêmes
  causes que `RAPPORT_LOT_E.md` : pas de `node_modules` fourni, registre
  npm inaccessible). Le typecheck partiel décrit ci-dessus est une
  vérification plus poussée qu'un simple parsing, mais reste construit sur
  des stubs, PAS une compilation avec les vrais types `next`/`@supabase/
  supabase-js`. **À faire avant fusion : les trois commandes réelles.**
- Aucune exécution contre une vraie instance Supabase (migrations,
  policies RLS `analytics_events`, upload `seo_og` réel, rendu réel d'un
  `<script type="application/ld+json">` face à l'outil de test Google Rich
  Results).
- Aucune vérification manuelle du rendu visuel des nouveaux écrans
  (`/dashboard/site`, édition produit, `/admin/logs`, section "Activité").

## 6. TODO explicite restant

- [ ] Exécuter `typecheck`/`test`/`lint` réels dans un environnement avec
      accès npm (non fait ici, voir §5).
- [ ] Tester un `<script type="application/ld+json">` réel avec l'outil
      "Résultats enrichis" de Google une fois déployé.
- [ ] Quand le sync webhook `post.*` de Zernio sera construit (ROADMAP.md,
      point 2) : déplacer `trackEvent("publication_published")` de
      `marketing-service.ts` vers le futur handler webhook (voir §4).
- [ ] Décider si `product_click`/`conversation_started` (déjà dans l'enum
      SQL mais non émis) doivent être câblés dans un lot futur, ou retirés
      de l'enum s'ils ne sont finalement jamais utiles.
- [ ] `resolveRequestOrigin()` pourrait devenir la référence pour d'autres
      liens publics actuellement construits avec `env.NEXT_PUBLIC_APP_URL`
      (ex. liens WhatsApp de `marketing-service.ts`) — pas fait ici pour
      rester dans le scope strict de ce lot (SEO), mais signalé car même
      limite, même fichier concerné.
