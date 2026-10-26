# C4 — Catalogue, Site, SEO, médias R2 — rapport final

Branche prévue : `agents/c4-catalogue-site`. Migration utilisée : **0162** (plage C4 : 0160-0179). Langue du code et des commentaires : français.

> **Avant d'intégrer : `npm install exceljs@4.4.0 --save-exact`** (lecture des `.xlsx`, accordée par Marc-well). Sans cela le build échoue.
>
> **À lire d'abord.** Dans l'environnement de travail il n'y avait ni `node_modules`, ni réseau, ni git, ni base de données. **Rien n'a été exécuté avec Vitest, `next build`, `tsc` du projet, le lint, Supabase, R2 ou un navigateur.** Contrôles réellement faits : syntaxe TypeScript/TSX de tous les fichiers touchés ; typage strict (`tsc --strict --noUncheckedIndexedAccess`, types zod **3.23.8** alors que le dépôt est en 4.6.5) sans erreur sur les modules purs ; ~100 cas de test purs exécutés dans un harnais Node maison. Tout le reste est **non vérifié**.

## 1. Fait

| Livrable | Contenu | Doc |
|---|---|---|
| **F — Stockage R2** | Adaptateur S3-compatible (`R2StorageAdapter`) derrière le port existant, signature SigV4 maison sans dépendance (vérifiée contre le vecteur de test officiel AWS), bascule par `STORAGE_PROVIDER`, erreur typée « objet déjà présent » | `c4-r2.md`, `DEPLOYMENT.md` |
| **F — Migration des médias** | Outil `npm run media:migrate-r2` (un tenant à la fois, simulation par défaut, copie puis vérification puis réécriture, idempotent, retour arrière par rapport JSON, jamais de suppression) ; autorisation du domaine R2 dans `next/image` et la CSP ; optimisation d'image reconnue pour l'hôte R2 | `c4-medias-r2.md` |
| **A — Import catalogue** | Lecture des `.xlsx` (via `exceljs`, converti en CSV), mapping de colonnes deviné (FR/EN), lecture tolérante des prix, doublons (fichier + catalogue), tout en brouillon, rien d'inventé (prix/stock), aperçu sans écriture, validation en bloc, interface dans `/dashboard/products`, décodage Windows-1252 | `c4-import-catalogue.md` |
| **C/D — Modèle de pages du site** | Table `site_versions` (brouillon / publié / archivé, publication atomique, historique immuable, RLS), schémas Zod stricts des blocs, arbre par défaut généré depuis la config actuelle | `c4-site-pages.md` |
| **D — Droits** | Publier = owner/admin, **ou tout membre à qui le propriétaire accorde `publish_site`** (SQL + code) | idem |
| **D — Éditeur et rendu** | Opérations d'édition atomiques, éditeur dans `/dashboard/site/versions` (sections, textes, thème, annonce, SEO, pages, menu, historique, restauration), aperçu privé du brouillon, pages publiques `/<slug>`, menu additif, sitemap | idem |
| **E — Garde-fou SEO** | Lint pur à la publication : 2 erreurs bloquantes, 9 avertissements, niveaux réglables (`SEVERITY`) | idem |
| **Pont vitrine** | La version publiée est convertie en `LandingConfig` : les composants actuels rendent le résultat ; sans version publiée, **aucun changement** ; erreur de lecture = repli sur l'ancienne config | idem |

Principes tenus : règles avant IA (aucun appel LLM dans C4 à ce stade), le LLM ne calcule rien, l'agent ne manipulera que des **données** validées (jamais du code), rien d'inventé, copie jamais déplacement, actions de publication traçables dans `audit_logs`.

## 2. Pas fait

- **Outils de l'agent Catalogue et de l'agent Site** : dépendent du registre d'outils, du moteur de règles et de `pending_actions` de C1 (inexistants dans le dépôt). Les services sont prêts à être enveloppés (`editSiteDraft`, `publishSiteDraft`, `restoreSiteVersion`, `importCatalogSmart`, `validateDraftProducts`) ; publier et restaurer doivent être déclarés `sensitive`.
- **Événement `ProductChanged`** : dépend de l'outbox `domain_events` de C1.
- **Import** : photos par lot (vision), PDF et scans (OCR), dictée (`SpeechPort` de C3), texte libre ; variantes, enrichissement et SEO produit FR/EN.
- **Site** : blocs HTML personnalisés assainis (étape 3 du brief) ; pages avec hero/cta/rendez-vous ; modèles de pages sectoriels.
- **Médias** : retour arrière automatique ; migration des colonnes d'autres équipes ; variantes d'images stockées (décision : `next/image` suffit, à mesurer).
- **Tests d'intégration** de `site-version-service`, `catalog-smart-import-service`, `SupabaseMediaReferenceStore`, de la RLS (le test statique existant couvre la forme, pas le comportement) ; **captures visuelles Playwright**.
- **Interface d'octroi du droit `publish_site`** : à construire par C2 (voir risques).

## 3. Risques (par ordre de gravité)

1. **Refactor de `getStorefrontSite`** (fonction centrale de la vitrine) : extrait en `buildStorefrontSite`. Chemin public conçu identique, **non prouvé**. Lancer `storefront-service.test.ts` et ouvrir une vraie vitrine avant tout déploiement.
2. **`next.config.mjs` lit `R2_PUBLIC_BASE_URL` au BUILD.** Sans la variable au build, `STORAGE_PROVIDER=r2` casserait les images (domaine non autorisé + CSP). À vérifier avant de basculer.
3. **Le service-role contourne la RLS.** La vraie barrière est applicative (`requireSiteEditor` / `requireSitePublisher`, `requireMembership` + filtre tenant). `extra_permissions` n'est lu par aucun autre code et **un admin peut aujourd'hui modifier les permissions d'un membre** (politique RLS de `memberships`) : l'action « accorder le droit de publier » doit être réservée au propriétaire (C2).
4. **Parité de rendu vérifiée sur les données, pas au pixel.** Les gabarits sectoriels (restaurant, services, immobilier, boutique) ont leurs propres compositions ; le texte alternatif du hero n'est lu que par le hero générique.
5. **Hypothèses externes non confirmées** : `If-None-Match: *` (412) sur R2 ; `Content-Length` d'un `HEAD` sur le domaine public R2 ; disponibilité et tarif des transformations d'images Cloudflare (**à vérifier**).
6. **Migration 0162 jamais appliquée.** Relire les triggers (immuabilité de l'historique) et les politiques sur une base de test.
7. **Fichiers partagés modifiés** (à rebaser avec soin, risque de conflit avec les autres Claude) : `next.config.mjs`, `src/application/services/storefront-service.ts`, `landing-config-service.ts` (champ optionnel `heroMediaAlt`), `src/infrastructure/tenant/resolve-request-tenant.ts` (mapper extrait + chargeur par id), `src/infrastructure/providers/registry.ts`, `src/lib/env.ts`, `src/domain/ports/storage-provider.ts`, `hero.tsx`, `app/page.tsx`, `app/sitemap.ts`, `dashboard/site/page.tsx` (bandeau), `dashboard/products/page.tsx`, `catalog-import-service.ts` (parseurs déplacés), `package.json`, `.env.example`, `docs/DEPLOYMENT.md`.
8. **Données personnelles / loi 2024/017** : C4 n'envoie encore **aucune** donnée à une API externe. Les futures parties IA (vision, OCR, dictée) enverront des photos, documents et voix de commerçants à des API tierces : à documenter et **à faire valider par un juriste** avant mise en service ; le déplacement des médias vers R2 est aussi un transfert de stockage à qualifier (région du bucket, hébergeur) — non évalué.
9. **Coût** : une requête supplémentaire par affichage de vitrine (lecture de la version publiée, indexée et mémoïsée). Aucun coût IA.

## 4. Décisions validées par Marc-well (13/10/2026)

Réponse « oui à tout » aux sept questions du rapport précédent :
1. **`exceljs` autorisé** → lecture des `.xlsx` livrée (voir ci-dessus).
2. **Seuils SEO** conservés : titre 15–60, description 70–160 ; bloquants = accueil en `noindex`, page indexable sans section visible.
3. **Droits** : l'admin garde le droit de publier sans délégation ; **le propriétaire seul accorde `publish_site`** (l'action d'octroi reste à construire par C2, avec cette restriction).
4. **Médias migrés** : logo, bannière, favicon, image de partage, hero, images produits/services/catégories ; publications, diffusions et justificatifs restent sur Supabase.
5. **Pages à la racine** (`/notre-histoire`) avec slugs réservés vérifiés par test.
6. **Quotas** : renvoyés au modèle de prix v2 ; `catalog_products` appliqué tel quel, y compris aux brouillons importés en masse.
7. **Ordre de mise en production** : (a) relire et appliquer 0162 sur une base de test ; (b) `npm install exceljs…`, `vitest`/`tsc`/lint ; (c) essai de l'import avec un fichier réel (CSV puis .xlsx) ; (d) bucket R2 + variables au build ; (e) migration d'un tenant de test ; (f) première publication d'un site de test avec captures avant/après.

## 5. Questions restantes
Aucune question bloquante côté C4. À arbitrer avec les autres Claude : contrats C1 (outils, `pending_actions`, `domain_events`), action d'octroi de droits (C2), `SpeechPort` (C3).
