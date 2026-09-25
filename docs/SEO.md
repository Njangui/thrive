# SEO — architecture et règles

Dernière révision : 20 septembre 2026 (audit SEO).

## 1. Trois « sites » sous une seule application

Le routage par hôte (`src/proxy.ts`, ex-`middleware.ts`) fait servir trois choses par la même
application, et leur SEO est opposé. La règle est dans `src/lib/request-surface.ts`
(pure, testée) ; la lecture des headers dans `resolveRequestSurface()`
(`src/infrastructure/tenant/resolve-request-tenant.ts`).

| Surface        | Hôte                                                     | robots.txt                          | Sitemap                    | Canonique                     |
| -------------- | -------------------------------------------------------- | ----------------------------------- | -------------------------- | ----------------------------- |
| `marketing`    | domaine racine (`NEXT_PUBLIC_ROOT_DOMAIN`) ou son `www.` | ouvert, sauf chemins privés         | `/`, `/tarifs`, `/devenir-affilie` | plateforme (domaine racine) |
| `tenant`       | sous-domaine ou domaine custom d'un commerçant           | ouvert, sauf chemins privés **et** pages plateforme | vitrine du tenant | domaine custom principal, sinon hôte visité |
| `unrecognized` | sous-domaine inconnu, tenant suspendu, preview Vercel    | `Disallow: /`                       | vide                       | —                             |

Avant l'audit, « pas de tenant » était traité comme « à ne jamais indexer » : la
landing, `/tarifs` et `/devenir-affilie` renvoyaient `Disallow: /`.

## 2. Ce qui est indexé, ce qui ne l'est pas

- **Bloqué à l'exploration** (`CRAWL_BLOCKED_PATHS`) : `/dashboard`, `/admin`, `/api`,
  `/affiliate`, `/onboarding`, `/auth`, `/invite`, `/r/` (chaque visite de `/r/` enregistre
  un clic d'affiliation : un robot fausserait les statistiques).
- **`noindex` seulement** (`NOINDEX_ONLY_PATHS`) : `/login`, `/reset-password`. Pas dans
  robots.txt exprès : Google doit pouvoir lire le `noindex`.
- **En-tête `X-Robots-Tag: noindex, nofollow`** sur tout cela (`NOINDEX_SOURCES` dans
  `next.config.mjs`). Les deux listes sont recopiées à la main ; `request-surface.test.ts`
  échoue si elles divergent.
- **Pages de la plateforme sous un hôte tenant** (`PLATFORM_ONLY_PATHS` : `/tarifs`, `/cgu`,
  `/signup`…) : `noindex` + `Disallow` (elles sont joignables sous chaque boutique mais n'y
  ont pas leur place).
- **Fiche produit** `draft`/`inactive` : `noindex` ; `out_of_stock` reste indexée.
  **Prestation** non `active` : `noindex`.
- **Recherche / tri / filtre** du catalogue : `noindex, follow`.
- **Pagination** : `?page=N` s'auto-référence (canonique propre, titre « — page N »),
  la page 1 n'a jamais de `?page=1`, une page hors limite renvoie un vrai 404.

## 3. Métadonnées

- Vitrine : `buildStorefrontMetadata` (`src/app/(site)/_lib/storefront-page.ts`).
- Plateforme : `buildMarketingMetadata` (`src/app/_lib/marketing-page.ts`).
- Open Graph + Twitter : **toujours** `buildSocialMetadata` (`src/lib/seo.ts`). Next.js
  *remplace* (et ne fusionne pas) `openGraph`/`twitter` d'un layout parent : impossible de
  poser `siteName`/`locale` une seule fois dans le layout racine.
- Image de partage d'un tenant : image SEO dédiée > bannière > logo. Sans cela, un lien de
  boutique collé dans WhatsApp s'affiche en texte nu.
- Image de la plateforme : `public/images/og-flexco .png` (1200×630, < 300 Ko — WhatsApp
  ignore les images plus lourdes). À régénérer si le logo change.
- **Ne pas définir `metadataBase` dans le layout racine** : Next.js s'en servirait pour
  rendre absolus `manifest` et `icons`, et sur un domaine de commerçant ils pointeraient
  alors vers le domaine de la plateforme (manifeste PWA cross-origin bloqué).

## 4. Domaine custom et duplication

Un tenant avec domaine custom vérifié est joignable sur deux hôtes. `resolveCanonicalOrigin()`
renvoie le domaine custom principal (`is_primary`, sinon le premier vérifié, départagé par
ordre alphabétique) : canonique, `og:url` et URL des JSON-LD s'y alignent. `robots.ts` et
`sitemap.ts` gardent l'hôte visité (un sitemap ne liste que les URL de l'hôte qui le sert).

## 5. Données structurées (JSON-LD)

- **Toujours** via `<JsonLd data={…} />` (`src/app/_components/json-ld.tsx`) — jamais
  `JSON.stringify` dans `dangerouslySetInnerHTML`. `JSON.stringify` n'échappe pas `<` :
  un nom de boutique contenant `</script>` exécutait du code chez les visiteurs (le CSP
  autorise `'unsafe-inline'`). `no-raw-json-ld.test.ts` échoue si un fichier réintroduit la balise.
- Horaires : `OpeningHoursSpecification` avec `dayOfWeek` = `https://schema.org/Monday` et
  `opens`/`closes` en `HH:MM`. Une valeur ambiguë (« Fermé », « 24h/24 ») omet le jour.
- Blocs émis : `LocalBusiness`/`Organization` + `WebSite` (accueil tenant),
  `Organization` + `WebSite` (accueil plateforme), `Product`, `Service`, `FAQPage`,
  `BreadcrumbList`.
- `FAQPage` : depuis 2023, Google ne réserve plus les résultats enrichis aux questions/
  réponses qu'aux sites institutionnels et de santé — aucun effet attendu pour une boutique.

## 6. Sitemap

Lectures légères (`src/application/services/sitemap-service.ts` : slug + `updated_at`,
paginées par 1000 — le plafond PostgREST tronquait silencieusement au-delà).
`lastModified` : fiches produit/prestation et pages `/produits` et `/services`. Accueil,
catégories et pages éditoriales n'ont pas de date fiable : aucune (une `lastmod` fausse fait
ignorer tout le champ).

## 7. Pages légales

`src/application/config/legal-entity.ts` est l'unique endroit à remplir (dénomination, RCCM,
NIU, adresse, contact, tribunal, durée de conservation). Tant qu'un champ obligatoire est
vide, les trois pages affichent `[À COMPLÉTER — …]` **et restent `noindex`**. Le texte doit
rester conforme au comportement réel du produit (ex. : pas de renouvellement automatique,
passage au gratuit immédiat — voir `docs/PAYMENT_INTEGRATION.md`).

## 8. Avant / après une mise en production

1. Vérifier `https://<domaine>/robots.txt` et `/sitemap.xml` sur : le domaine racine, un
   sous-domaine tenant, un sous-domaine inexistant (doit renvoyer `Disallow: /`).
2. `curl -I https://<domaine>/dashboard` → présence de `X-Robots-Tag: noindex, nofollow`.
3. Google Search Console : propriété « domaine » sur le domaine racine, soumission du sitemap
   de la plateforme ; un tenant avec domaine custom déclare sa propre propriété.
4. Test des résultats enrichis (search.google.com/test/rich-results) sur une fiche produit
   et sur l'accueil d'un tenant avec adresse et horaires.
5. Redirection `www` → apex à configurer côté Vercel (Domains) ; l'application n'en fait pas.
6. Aperçu de partage : coller l'URL de la landing et d'une fiche produit dans WhatsApp.

## 9. Limites connues

- Les pages `/cgu`, `/confidentialite`, `/mentions-legales` sont désormais rendues à la
  demande (leurs métadonnées dépendent de l'hôte) et non plus pré-générées.
- Pas de `hreflang` : le produit est monolingue (fr).
- Pas de balisage vidéo : les vidéos catalogue sont hébergées 7 jours chez Zernio, une URL
  qui expire n'a pas sa place dans des données structurées.
- `addressCountry` n'est pas émis dans `PostalAddress` (le pays n'est pas dans `TenantContext`).
