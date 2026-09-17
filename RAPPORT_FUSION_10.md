# Rapport de fusion #10 — Code promo affiliation + Country Engine (expansion) + Vitrine V2

Fait suite à `RAPPORT_FUSION_9.md`. Trois exports fusionnés sur le tronc
reçu (`thrive-main`, migrations jusqu'à `0051_landing_personalization.sql`).
Contrairement aux fusions précédentes, les trois patches partaient bien du
même état du tronc (aucun n'était en retard sur une fonctionnalité déjà
présente ailleurs) — la fusion a donc été essentiellement additive, à deux
exceptions près détaillées ci-dessous.

Aucun chevauchement de chemin de fichier entre les trois patches
eux-mêmes (vérifié par comparaison d'arborescence avant application). Les
seuls points de couplage réels étaient entre patch et tronc, via des
fichiers non inclus dans les zips :

- `onboarding-actions.ts` / `onboarding-service.ts` (patch 1) importent
  `createProduct` / `seedDefaultCategories` de `catalog-service.ts` — ce
  fichier est modifié par le patch 3. Vérifié : les deux exports existent
  toujours avec une signature compatible dans la version du patch 3.
- `subscription-payment-service.ts` (patch 1) importe le type
  `NotchPayWebhookEvent` de `notchpay/types.ts` — modifié par le patch 2.
  Vérifié : toujours exporté à l'identique.

## 1. `thrive-promo-code-feature` — Code promo à l'inscription (affiliation)

Purement additif, aucun conflit :

- `domain/entities/affiliate.ts` — `computeDiscountedAmountFcfa`
- `application/services/affiliate-service.ts`, `affiliate-admin-service.ts`
- `application/services/onboarding-service.ts`, `onboarding-actions.ts`,
  `onboarding-wizard.tsx` — saisie du code promo comme alternative au lien
  de suivi cliqué
- `application/services/subscription-payment-service.ts` — remise sur le
  1er paiement quand l'inscription vient d'un code promo
- `app/admin/affiliates/settings/page.tsx` — déjà relié : `Réglages` était
  déjà présent dans `admin/affiliates/_components/sub-nav.tsx` du tronc,
  aucun câblage de navigation à faire

**Migration** : `0052_affiliate_promo_codes.sql` — le numéro `0052` était
libre (dernier du tronc : `0051`), conservé tel quel. Modifie
`affiliate_referrals` (contrainte `attribution_method` élargie à
`promo_code`) et `platform_settings` (deux réglages plateforme). Aucune
dépendance avec les deux autres migrations de ce lot (tables distinctes).

## 2. `thrive-fichiers-modifies` — Country Engine (expansion 7 pays) + retrait sync NotchPay

Additif dans son intention, mais **un fichier orphelin a cassé le
typecheck** — détecté seulement une fois appliqué sur le vrai tronc (le
patch, livré comme un simple diff de fichiers modifiés, ne pouvait pas
représenter une suppression par omission) :

- `infrastructure/providers/payment/notchpay/resources-client.ts`
  (présent dans le tronc, absent du patch) importait
  `NotchPayGetCountryResponse` / `NotchPayListChannelsResponse` /
  `NotchPayListCountriesResponse` depuis `notchpay/types.ts` — types
  supprimés par le patch, qui documente explicitement leur retrait dans
  son propre commentaire (`types.ts`, note du 16/09/2026) et dans
  `docs/notchpay-resources.md` (section « Retrait complet ») : la
  synchronisation automatique NotchPay s'appuyait sur un endpoint
  inexistant (404 constaté en prod), remplacée par une gestion 100%
  manuelle SQL + `/admin/countries`. `notchpay-resources-service.ts` du
  patch n'est déjà plus qu'une couche de lecture DB
  (`getCountries`/`getCountry`/`getChannels`), sans plus aucune fonction
  de sync — j'ai supprimé `resources-client.ts` pour aligner le code sur
  cette décision déjà actée par le patch. Recherche globale confirmée :
  plus aucune référence à `syncCountries`/`syncChannels`/
  `syncAllResources`/`getSyncStatus`/`NotchPayResourcesClient` ailleurs
  dans `src/`.
- `app/admin/countries/page.tsx`, `admin/countries/[code]/page.tsx`,
  `admin-countries-service.ts` (+ tests) : cohérents avec ce retrait, déjà
  sans bouton "Synchroniser".
- `docs/notchpay-resources.md`, `docs/country-engine.md` : mise à jour de
  documentation existante (les deux fichiers existaient déjà dans le
  tronc), contenu remplacé par le patch.
- `/admin/countries` était déjà relié dans `admin/_components/sidebar.tsx`
  du tronc (entrée "Pays") — aucun câblage de navigation à faire.

**Migration** : `0052_country_engine_expansion_seed.sql` →
**`0053_country_engine_expansion_seed.sql`** (renumérotée, `0052` déjà pris
par le patch 1 dans ce lot de fusion). Contenu inchangé : seed additif de
7 pays en `coming_soon` (Nigeria, Ghana, Côte d'Ivoire, Sénégal, Gabon,
Kenya, Ouganda) + canaux de paiement placeholder tous `is_available =
false`, aucune ligne existante modifiée, ne touche pas au Cameroun.
Idempotente (`on conflict ... do nothing`), aucune dépendance d'ordre avec
`0052`/`0054`.

## 3. `sme-os-vitrine-v2-session` — Vitrine V2 (boutique en ligne complète)

Le plus gros lot (26 fichiers créés, 34 modifiés, 5 supprimés) — conforme
au `MANIFEST.md` livré avec ce patch, appliqué tel quel :

- Blueprint sectoriel, routing, `storefront-service.ts`, composants
  vitrine partagés (header/footer/shell/badges/cartes produit), pages du
  nouveau groupe de routes `(site)` (produits, catégories, services,
  promotions, à-propos, contact, rendez-vous, FAQ, galerie)
- `src/lib/safe-url.ts`, `src/lib/whatsapp.ts` extraits de
  `resolve-request-tenant.ts`
- Sections landing, `tenant-landing.tsx`, `globals.css`, `layout.tsx`,
  `fonts.ts` modifiés

**5 fichiers supprimés** (existaient bien dans le tronc, confirmé avant
suppression) :
- `app/_components/landing-sections/location.tsx`,
  `social-links.tsx` (fusionnés dans `contact.tsx`)
- `app/_components/product-card.tsx` (remplacé par
  `app/_components/storefront/product-card.tsx`)
- `app/produits/page.tsx`, `app/produits/[slug]/page.tsx` (déplacés vers
  `app/(site)/produits/...`)

**Migration** : `0052_storefront_v2.sql` → **`0054_storefront_v2.sql`**
(renumérotée). Modifie `organization_landing_config`, `categories`,
`products` (colonnes nullables, aucune table en commun avec les deux
autres migrations de ce lot).

Le `MANIFEST.md` livré à la racine de ce patch n'a pas été copié dans le
dépôt final : son contenu (liste des fichiers créés/modifiés/supprimés,
vérifications passées en fin de session) est repris et étendu ci-dessus,
pour rester cohérent avec la convention `RAPPORT_FUSION_*.md` déjà en
place dans ce dépôt.

## Vérifications passées sur l'ensemble du dépôt fusionné

- `npm ci` : 517 paquets, aucune erreur
- `tsc --noEmit` : propre (après suppression de `resources-client.ts` —
  3 erreurs avant, 0 après)
- `next lint` : aucun avertissement/erreur
- `vitest run` : **619/619 tests passent (56 fichiers)**
- `next build` : succès complet, 80 routes générées, y compris toutes les
  nouvelles routes des trois patches (`/admin/countries`,
  `/admin/countries/[code]`, `/admin/affiliates/settings`, `/produits`,
  `/categories`, `/services`, `/promotions`, `/a-propos`, `/contact`,
  `/rendez-vous`, `/faq`, `/galerie`, etc. — chacune une seule fois, donc
  aucun conflit de route entre l'ancien `app/produits/*` supprimé et le
  nouveau groupe `(site)`). Vérifié avec deux stubs **temporaires** (ce
  bac à sable n'a pas accès à `fonts.googleapis.com`, exactement comme
  déjà noté dans le `MANIFEST.md` du patch 3) sur `src/app/fonts.ts` et
  les deux appels `next/font/google` de `src/app/layout.tsx` (Plus Jakarta
  Sans/Inter), plus des variables Supabase factices (`NEXT_PUBLIC_SUPABASE_URL`
  etc., absentes de ce sandbox). **Les deux fichiers ont été restaurés à
  l'identique de l'original avant livraison** (diff vérifié) — aucun
  changement de code réel, seulement une vérification de build qui se
  déroulera normalement dans un environnement avec accès réseau et un
  vrai `.env.local`.

## Points laissés pour vérification manuelle

- Le renumérotage `0053`/`0054` a mis à jour uniquement le nom de fichier
  et le commentaire d'en-tête interne de chaque migration ; le contenu SQL
  n'a pas été touché.
- Aucune table/contrainte/index en commun entre les trois nouvelles
  migrations — applicables dans n'importe quel ordre entre elles, l'ordre
  `0052→0053→0054` choisi ici suit simplement l'ordre de réception des
  trois archives.
