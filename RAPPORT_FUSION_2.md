# Rapport de fusion #2 — Lots F, H, I

Deuxième vague de fusion, sur la base du projet précédemment fusionné
(Lots B/C/D/E, voir `RAPPORT_FUSION.md`) + ma propre passe d'optimisation
(`RAPPORT_OPTIMISATION.md`). Le Lot G n'a pas encore été livré — ses
migrations restent réservées (`0019`-`0021`), rien ne les utilise encore.

## 1. Vérifications finales

- `npm install` (nouvelle dépendance `web-push`, Lot I) → OK
- `npm run typecheck` → **0 erreur**
- `npm test` → **195/195** (23 fichiers)
- `npm run lint` → **0 warning**
- `npm run build` → **succès réel, code de sortie 0**, 33 routes générées
  (même contournement temporaire du fetch réseau `next/font` que pour les
  vagues précédentes, annulé immédiatement après vérification —
  `src/app/layout.tsx` identique à avant). C'est la première fois que ce
  build est vérifié avec le code du Lot H : leur propre rapport signalait
  ne jamais avoir pu l'exécuter chez eux (pas d'accès npm) — confirmé sain
  maintenant.
  - Note bénigne dans les logs de build : `/admin/logs/export` affiche
    "Export CSV audit_logs: erreur inattendue" pendant la génération —
    c'est Next.js qui sonde en interne si la route peut être statique, pas
    une vraie erreur (elle apparaît correctement comme route dynamique
    `ƒ` dans le tableau final, et fonctionne normalement à l'exécution).

## 2. Point de départ : tous les lots travaillaient sur un snapshot antérieur à mon optimisation

Aucun des trois lots n'avait connaissance de ma passe d'optimisation
(délivrée juste avant leur travail, mais visiblement pas redistribuée
avant qu'ils ne commencent). Plusieurs fichiers de leurs livraisons
étaient donc simplement des copies non modifiées de la version
pré-optimisation — pas de vrais changements de leur part, juste un
décalage de base. Vérifié précisément avant de copier quoi que ce soit
(recherche de marqueurs comme `countActiveProducts`, `PAGE_SIZE`,
`MESSAGES_PAGE_SIZE`, `orgs.map(async` dans chaque fichier suspect) pour
ne jamais écraser mon travail d'optimisation par une copie obsolète.
Fichiers concernés, ignorés des trois livraisons et gardés tels quels :
`admin-organizations-service.ts`, `admin-numbers-service.ts`,
`conversation-admin-service.ts`, `dashboard/products/page.tsx`,
`produits/page.tsx`, `finance-forms.tsx`.

## 3. Aucune collision de migration

Les plages assignées à l'avance (`00_CONVENTIONS_COMMUNES_V2.md`) ont
fonctionné parfaitement :
- Lot F : `0018_whatsapp_groups.sql`
- Lot H : `0022_seo_fields.sql`, `0023_analytics_events.sql`
- Lot I : `0024_push_subscriptions.sql`, `0025_onboarding_progress.sql`,
  `0026_social_comments.sql`
- Mon `0030_performance_indexes.sql` (hors plage, sans risque)

Séquence finale 0001→0018, 0022→0026, 0030 — trous volontaires (0019-0021
réservées au Lot G, non fusionné).

## 4. Quatre vraies collisions de fichiers, résolues manuellement

### `src/app/dashboard/layout.tsx` (Lot F + Lot I)

Lot F ajoutait un lien nav "Groupes WhatsApp" ; Lot I ajoutait la
redirection vers `/onboarding` si non terminé + un lien nav
"Commentaires". Combinés sans conflit réel (deux ajouts indépendants au
même fichier).

### `src/infrastructure/tenant/resolve-request-tenant.ts` (mon optimisation + Lot H)

Ma requête unique (au lieu de deux séquentielles) + les champs SEO et
`resolveRequestOrigin()` du Lot H. Gardé ma stratégie de requête,
simplement étendu les colonnes sélectionnées et le type `TenantContext`
avec les 3 champs SEO.

### `src/app/page.tsx` (mon optimisation + Lot H)

Lot H ajoutait `generateMetadata` (title/description/Open Graph/Twitter
Card via `src/lib/seo.ts`) + JSON-LD + `trackEvent("page_view")`. Gardé
tout ça, en remplaçant leur appel non borné à
`listActiveProductsForStorefront` + `.slice(0, 6)` par mon
`listActiveProductsForStorefront(id, { limit: 6 })`.

### `src/application/services/catalog-service.ts` (mon optimisation + Lot H)

Le plus gros des quatre. Lot H ajoutait les champs SEO à
`CatalogProductDetail`/`getProductBySlug`/`UpdateProductInput`/
`updateProduct`/`ProductForEdit`/`getProductForEdit`. Aucune de ces
fonctions ne chevauchait celles que j'avais modifiées
(`listActiveProductsForStorefront`, `countActiveProducts` — nouvelle).
Fusion directe, rien n'a été arbitré entre les deux séries de
changements.

## 5. Contenu réel des trois lots (au-delà des rapports individuels, lire aussi `RAPPORT_LOT_F.md`/`H`/`I`)

- **Lot F** — Groupes WhatsApp : synchronisation réelle (API Zernio
  confirmée), diffusion vers un groupe **honnêtement limitée** : aucun
  groupe fraîchement connecté ne peut recevoir de diffusion tant qu'il n'a
  pas lui-même envoyé un premier message (limite RÉELLE de l'API Zernio,
  pas un bug — détaillée dans `docs/ZERNIO_INTEGRATION.md`). Cron
  `/api/cron/process-broadcasts` à configurer en prod (voir
  `docs/DEPLOYMENT.md`, section 4bis, `CRON_SECRET` à définir).
- **Lot H** — SEO (balises meta + JSON-LD + `sitemap.xml`/`robots.txt`),
  analytics de base (`analytics_events`, best-effort partout, jamais
  bloquant), observabilité Super Admin (`/admin/logs` + export CSV,
  compteurs d'usage par entreprise sur `/admin/organizations`).
- **Lot I** — Push notifications (câblées dans `notifyOrgAdmins`, jamais
  bloquant si l'envoi échoue), onboarding reprenable (`onboarding_step`,
  redirection automatique), commentaires sociaux : lecture + réponse
  confirmées sur 8 plateformes (Facebook, Instagram, YouTube, LinkedIn,
  Threads, X, Reddit, Bluesky), masquage limité à 3 d'entre elles
  (Facebook/Instagram/Threads) — le tout vérifié contre la vraie
  documentation Zernio avant d'être codé, pas deviné.

## 6. Ce qui reste

- **Lot G** (domaines/add-ons/paiement abonnement) — pas encore livré,
  migrations `0019`-`0021` toujours réservées.
- **Lot J** (tests d'isolation réels, tests de limites, seed démo,
  consolidation doc) — idem, dernier de la vague F-J.
- `docs/GAP_ANALYSIS_V2.md`/`00_CONVENTIONS_COMMUNES_V2.md` (documents de
  planification, pas dans ce zip) restent la référence pour ce qui est
  encore attendu.
