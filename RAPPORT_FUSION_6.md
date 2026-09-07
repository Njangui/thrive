# Rapport de fusion #6 — Lots 1, 2, 4 (vague master prompt)

Nouvelle vague, distincte de B-O : le porteur du projet a fourni un
master prompt d'audit et de finition MVP, découpé en 4 lots
indépendants (1/2/4 fusionnés ici, **le Lot 3 — WhatsApp/conversations/
IA/groupes/publications sociales — n'a pas encore été livré**). Base de
départ : le projet fusionné B→N (`RAPPORT_FUSION_5.md`).

## 1. Vérifications finales

- `npm install` → OK
- `npm run typecheck` → **0 erreur** (après 2 correctifs, section 3)
- `npm test` → **392/392 tests passants**, 39 fichiers
- `npm run lint` → **0 warning**
- `npm run build` → **succès réel, code de sortie 0**, 47 routes
  générées (dont les nouvelles `/admin/plans`, `/admin/payments`,
  `/dashboard/services*`) — même contournement temporaire que les
  vagues précédentes pour `next/font/google` (`src/app/layout.tsx` et
  `src/app/fonts.ts`), restaurés à l'identique juste après (diff
  vérifié, zéro différence). Même note bénigne connue sur
  `/admin/logs/export` (sondage interne Next.js, pas une vraie erreur).

## 2. Point de départ et fiabilité déclarée de chaque lot

- **Lot 2** (dashboard/catalogue/services/landing) — livré en arbre
  complet, **a réellement fait tourner** `npm install`/`typecheck`/
  `lint`/`test` avec succès dans son propre environnement (340/340
  tests annoncés). Le lot le plus fiable des trois.
- **Lot 1** (architecture/sécurité/DB/stock) — livré en **delta seul**
  (pas d'arbre complet), et signale lui-même n'avoir **aucun accès
  réseau** (`npm install` → 403) : tout vérifié "à la main"
  (relecture, exécution de fragments de logique isolés dans Node),
  jamais par le compilateur ni le test runner réels.
- **Lot 4** (Super Admin/abonnements/domaines) — livré en arbre
  complet mais **même réserve que le Lot 1** : aucun accès réseau,
  aucune vérification tsc/vitest/eslint réelle non plus.

Deux lots sur trois arrivaient donc totalement non vérifiés par
l'outillage — cette fusion l'a confirmé en pratique (section 3).

## 3. Deux vrais bugs trouvés à la fusion (confirment les réserves posées par Lot 1 lui-même)

- `tests/rls-policies.test.ts` (Lot 1) — 3 erreurs `tsc`
  (`noUncheckedIndexedAccess` : `match[1]` possiblement `undefined`
  sur un résultat de `matchAll`). Corrigé avec la même assertion
  non-null `!` déjà utilisée pour ce pattern ailleurs dans le projet
  (convention établie depuis `RAPPORT_FUSION_5.md`).
- `src/lib/cron-auth.test.ts` (Lot 1) — le fichier entier plantait au
  chargement : `Cannot access 'mockEnv' before initialization`. Piège
  classique de hoisting Vitest — `vi.mock(...)` est hoisté au-dessus
  de tout le fichier, une `const mockEnv = {}` déclarée juste avant
  dans le code source est donc encore dans sa zone morte temporelle
  quand la factory du mock s'exécute. Corrigé avec `vi.hoisted()`
  (mécanisme prévu par Vitest pour exactement ce cas) — aucun autre
  fichier du projet ne mockait encore `@/lib/env` directement, donc
  pas de convention préexistante à suivre, celle-ci en devient une.

## 4. Collision réelle : `catalog-service.ts` (Lot 1 + Lot 2)

La seule vraie collision de logique de cette fusion, sur deux zones
différentes du même fichier :

- **Lot 1** a réécrit `decrementStock`/`restockProduct` pour passer
  par une nouvelle fonction SQL atomique, `adjust_product_stock()`
  (verrouillage `FOR UPDATE`, réservée `service_role`, voir
  `0038_atomic_order_stock_transaction.sql`) — corrige une vraie race
  condition : l'ancienne version lisait le stock, le recalculait en
  mémoire applicative, puis réécrivait en plusieurs opérations non
  atomiques, ce qui permettait à deux décréments concurrents de se
  marcher dessus.
- **Lot 2** a ajouté `compareAtPrice` (prix barré / promotion) et une
  vraie galerie multi-photos (`appendProductImage`/`removeProductImage`/
  `moveProductImage`/`setPrimaryProductImage`) dans une zone
  entièrement différente du fichier (`CreateProductInput`/
  `updateProduct`/gestion de `product_images`).

Fusionné en partant de la version Lot 2 (la plus large) et en greffant
par-dessus uniquement le corps réécrit de `decrementStock`/
`restockProduct` du Lot 1, plus l'interface `AdjustProductStockRow`
qu'il ajoute en tête de fichier. **Le fichier de test correspondant a
dû être reconstruit à la main** : chaque lot mockait le client
Supabase différemment (Lot 1 : `.rpc()` uniquement ; Lot 2 : un faux
query-builder chaînable `.from()/.select()/.eq()/.insert()/...`) — un
seul mock unifié exposant les deux (`{ from: mockFrom, rpc: mockRpc }`)
porte maintenant l'ensemble des tests des deux lots, aucun perdu.

`order-service.ts` (Lot 1 uniquement — réécriture de
`markOrderCompleted` pour appeler `complete_order_transaction()`,
même logique de transaction atomique) n'avait aucune collision, repris
tel quel.

## 5. Collision de numérotation de migration : `0038` (Lot 1 + Lot 4)

Deux lots indépendants, sans visibilité l'un sur l'autre, ont chacun
livré un fichier `0038_*.sql` :

- Lot 1 : `0038_atomic_order_stock_transaction.sql`
- Lot 4 : `0038_plan_whatsapp_groups_correction.sql`

Contenus strictement indépendants (l'un ajoute des fonctions RPC de
stock/commande, l'autre corrige des lignes `plan_entitlements` +
ajoute une clé `whatsapp_groups_dedicated_bonus`) — pas de conflit
logique, seulement de nommage. Le fichier du Lot 1 garde son numéro
(le stock/commande est un socle dont potentiellement d'autres lots
dépendent), celui du Lot 4 renommé en `0039` — contenu inchangé, seul
son commentaire d'en-tête mis à jour. Même traitement que la collision
`0016` déjà rencontrée en vague B-E (`RAPPORT_FUSION.md`).
`docs/DATABASE.md` mis à jour en conséquence, avec une note explicite
pour anticiper la même collision quand le Lot 3 arrivera (il partait
probablement lui aussi d'un dépôt où `0038` semblait libre).

## 6. Tout le reste : aucune collision réelle

Vérifié fichier par fichier : `src/app/dashboard/layout.tsx`/
`src/app/page.tsx` (Lot 2 seul, personne d'autre n'y touchait),
`docs/MVP_SCOPE.md` (Lot 2 — techniquement hors du périmètre que son
propre cahier lui assignait, mais aucun autre lot ne le touchait non
plus : repris sans arbitrage, aucun conflit réel), toutes les pages
`/admin/**` et pages dashboard d'abonnement/finance/commandes/clients/
rendez-vous/produits(liste) modifiées par le Lot 4 (aucune ne
recoupait le Lot 1 ou le Lot 2), `entitlements-service.ts`/
`subscription-service.ts`/`admin-numbers-service.ts` (Lot 4 seul).

## 7. Écart identifié à la fusion initiale — corrigé depuis (voir section 9)

`restockProduct` (`catalog-service.ts`) n'avait aucun appelant UI —
corrigé section 9.4 ci-dessous.

## 8. Lot 3 manquant — impact sur cette fusion

Le Lot 3 (WhatsApp/conversations/IA/groupes/publications sociales)
n'a pas encore été livré. Cette fusion ne touche donc à aucun des
fichiers qui lui sont réservés (`marketing-service.ts`, `whatsapp-
group-service.ts`, `ai-*`, `conversation-*`, `messaging-provider.ts`)
— ils sont toujours dans l'état où le Lot N/K les avait laissés. Le
Lot 3 devra être fusionné séparément ; attends-toi à la même collision
de numérotation de migration `0038`/`0039` décrite en section 5 (voir
la note laissée dans `docs/DATABASE.md`).

## 9. Complément post-fusion — périmètre hérité du Lot O, construit directement (hors des 4 lots)

Suite à la demande explicite du porteur du projet ("construit ou
optimise ce qui n'est pas encore fait ou pas optimisé, sauf ce qui
concerne le Lot 3"), le reste du périmètre P0 identifié en section 8
de `COMPARAISON_MASTER_PROMPT.md` a été construit directement à cette
fusion plutôt que laissé en attente — chaque point vérifié en isolant
soigneusement tout fichier réservé au Lot 3 :

### 9.1 Test d'isolation multi-tenant réel

`tests/integration/tenant-isolation.test.ts` — deux organisations, un
utilisateur authentifié membre d'une seule, sur les 24 tables
tenant-scoped du projet (lecture large, lecture ciblée, tentative de
modification, tentative d'usurpation à la création). Séparé de
`npm test` (`npm run test:integration`, `vitest.integration.config.ts`
dédié), garde-fou explicite si l'URL cible correspond à
`NEXT_PUBLIC_SUPABASE_URL`. Jamais encore exécuté (aucun projet
Supabase réel disponible dans cet environnement) — vérifié skip propre
(101 tests sautés, aucune erreur) plutôt qu'un vrai run.

### 9.2 Tests de bordure entitlements (99/100/101, `-1` illimité)

Bloc dédié ajouté à `entitlements-service.test.ts` (18 nouveaux tests,
42 au total) — `ai_credits`, `whatsapp_groups`, `broadcast_contacts`,
`social_accounts`, plus la vérification explicite que le bonus
add-ons s'additionne correctement à la limite à chaque cas de bordure.

### 9.3 `product_click` câblé

`ProductCard` (converti en composant client) journalise `product_click`
au clic, avant navigation — branché sur les deux points d'affichage
public (`/produits` et la section "Produits" de la landing tenant).
`conversation_started` reste NON câblé : son seul point d'insertion
possible est `conversation-orchestrator.ts`, réservé au Lot 3.

### 9.4 `restockProduct` — action UI ajoutée

Petit formulaire "Réapprovisionner" sur `/dashboard/products/:id/edit`
(delta, jamais une valeur absolue — réactive automatiquement un
produit `out_of_stock`). Complète le champ "Stock" existant, ne le
remplace pas.

### 9.5 `resolveRequestOrigin()` — migration partielle assumée

Sur les 4 fichiers utilisant encore `NEXT_PUBLIC_APP_URL` identifiés à
la fusion initiale, seul `team-service.ts` a été migré (lien
d'invitation d'équipe — hors du périmètre du Lot 3). `marketing-
service.ts`, `whatsapp-group-service.ts` et `conversation-
orchestrator.ts` restent INTENTIONNELLEMENT non touchés — réservés au
Lot 3, à traiter à sa fusion.

### 9.6 `scripts/seed-demo.ts` — construit

"Mode Élégance", idempotent par slug. Réutilise les vrais services
applicatifs partout où c'est possible (catalogue, services, leads,
finance, landing config, témoignages, add-on) — trois exceptions
documentées en tête de fichier : création organisation/owner
(`createOrganization` dépend des cookies Next.js, inutilisable dans un
script autonome), groupes WhatsApp (le service réel appelle Zernio,
insertion directe autorisée explicitement par le cahier), abonnement/
add-on (paiement simulé déjà confirmé plutôt qu'un vrai appel
NotchPay). Jamais encore exécuté (même limite que 9.1 : aucune
instance Supabase réelle disponible ici).

### 9.7 Documentation entièrement rafraîchie

À la demande explicite du porteur du projet ("mes docs sont tous
obsolètes") : `docs/ROADMAP.md` réécrit intégralement (datait de la
toute première vague B-E, listait comme "manquant" une dizaine de
choses construites depuis) ; `docs/GAP_ANALYSIS.md` reçoit sa section
de clôture finale (§U) ; `docs/MVP_SCOPE.md` corrigé (la galerie
multi-photos, listée "non construite" par erreur par le Lot 2 lui-même,
avait pourtant bien été livrée par ce même lot) ; `docs/SECURITY.md`
référence désormais le vrai test d'isolation (9.1) et documente le
comportement cron fail-safe (Lot 1, jamais documenté à l'origine) ;
`docs/ARCHITECTURE.md`/`docs/AI.md` légèrement complétés (`getDomainProvider`/
`getEmailProvider`, résolution credential par tenant, modèle IA par
défaut par provider) ; `docs/DEPLOYMENT.md` corrigé sur deux affirmations
fausses (sync `post.*` et résolution credential per-tenant présentées
comme non faites alors que livrées par les Lots M et N).

## 10. Complément production-readiness (à la demande explicite du porteur du projet, hors périmètre Lot 3)

Suite à une proposition d'améliorations classées par priorité (🔴 avant
production / 🟠 conversion-expérience / 🟡 fiabilité-qualité), le
porteur du projet a demandé de commencer l'implémentation — en
respectant strictement la même règle que tout le reste de cette
session : ne rien toucher qui appartienne au périmètre du Lot 3, en
cours de traitement ailleurs.

### 10.1 CI/CD

`.github/workflows/ci.yml` — typecheck/lint/test sur chaque push/PR,
puis build séparé (secrets réels si configurés dans le repo, valeurs
factices sinon — même méthode que toutes les vérifications manuelles de
ce projet). `test:integration` volontairement exclu (parle à une vraie
instance Supabase dédiée, n'a pas sa place sur n'importe quelle PR).

### 10.2 Headers de sécurité

`next.config.mjs::headers()` — CSP, `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`
(sans `preload`, décision à prendre explicitement plus tard). CSP avec
`script-src 'self' 'unsafe-inline'` — compromis documenté dans le
commentaire du fichier (Next.js injecte un script inline pour
l'hydratation ; une politique par nonce l'éliminerait mais demande des
tests approfondis non faits ici).

### 10.3 Pages d'erreur racine

`src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/global-error.tsx`
— avant ça, une erreur non gérée montrait l'écran brut de Next.js.

### 10.4 Rate limiting — une leçon de runtime en cours de route

`src/lib/rate-limit.ts` (Upstash Redis, repli ouvert si non configuré,
jamais un crash). **Premier essai incorrect** : branché dans
`src/middleware.ts`, qui tourne obligatoirement en Edge Runtime — le
build a averti que `@upstash/redis` tire une dépendance utilisant
`process.version` (API Node.js absente d'Edge Runtime). Une défaillance
là aurait bloqué TOUTE requête (résolution tenant comprise), pas
seulement le rate limiting. Corrigé en déplaçant l'appel dans
`/api/webhooks/notchpay/route.ts` (route handler, runtime Node.js par
défaut) — le webhook Zernio n'a volontairement pas reçu la même
protection, il appartient au périmètre du Lot 3. `/login` n'a pas non
plus été câblé : ce flux appelle `supabase.auth.signInWithOtp`
directement depuis le navigateur (magic link, pas de mot de passe),
sans passage par notre propre serveur — déjà protégé par le rate
limiting natif de Supabase Auth, un câblage applicatif supplémentaire
n'aurait eu aucun point d'accroche réel. Le type `RateLimitKind`
conserve un cas `"auth"` disponible mais non utilisé, pour un futur
flux qui en aurait réellement besoin.

### 10.5 Photos produit dans le catalogue public + `next/image`

**Vérifié** : `CatalogProductSummary` n'a jamais porté de champ image —
la grille catalogue et la section landing "produits" n'affichaient que
du texte. Nouveau type dédié `StorefrontProductSummary` (n'étend le
comportement QUE pour la vitrine publique, `getActiveProducts`/
`searchProductsByName`/`getProductsByIds` — consommés par le
router IA/la mémoire conversationnelle, périmètre Lot 3 — restent
inchangés). Photo principale choisie par plus petite `position`
(`product_images`), même logique appliquée à `listPromotedProductsForStorefront`
(section "promotions").

`next/image` adopté pour ces nouvelles photos — mais avec un vrai
garde-fou (`src/lib/optimizable-image.ts`) : une photo produit peut
venir du bucket Supabase (upload) OU d'un lien externe collé par le
commerçant (`ImageUploadField`, mode "Lien existant") ; `next/image`
refuse tout domaine non listé dans `images.remotePatterns`. Basculer
vers `next/image` sans discernement aurait cassé l'affichage de toute
photo externe — une régression, pas une amélioration. `hero.tsx`/
`gallery.tsx`/`team.tsx`/la page produit détail utilisent déjà `<img>`
pour la même raison (déjà correctement géré par un lot antérieur,
non retouché ici) — pourraient adopter le même garde-fou dans un futur
passage, non prioritaire (déjà sûrs, juste non optimisés).

### 10.6 Pages légales

`/cgu`, `/confidentialite`, `/mentions-legales` — structure standard
SaaS + informations factuelles vérifiables (sous-traitants réels du
projet : Supabase, Vercel, Zernio, NotchPay, Resend, OpenProvider),
mais contenu de DÉPART explicitement marqué comme tel (bandeau visible
sur chaque page) : ce n'est pas un document juridique validé — les
champs `[À COMPLÉTER]` (raison sociale, RCCM, adresse, droit
applicable...) nécessitent une vraie révision par un juriste
(droit camerounais/OHADA) avant mise en production. Liées depuis le
footer de la landing marketing.

### 10.7 Health-check

`/api/health` — vérifie une connectivité DB réelle (pas juste "le
process tourne"), pour un monitoring d'uptime externe.

### Vérifié pour l'ensemble de cette section

`npm run typecheck`/`npm test` (419 tests, +21 depuis la fin de la
section 9)/`npm run lint` 100% verts, `npm run build` réussi — y compris
la disparition de l'avertissement Edge Runtime après correctif (10.4).
