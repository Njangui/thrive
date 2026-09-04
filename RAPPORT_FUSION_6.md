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

## 7. Écart identifié, non corrigé à cette fusion

`restockProduct` (`catalog-service.ts`) reste **sans aucun appelant
UI** — vérifié : aucune page dashboard ne l'invoque. Le Lot 1
l'avait lui-même signalé comme limite connue (il ne construit pas
d'UI, hors de son périmètre) ; ni le Lot 2 ni le Lot 4 n'ont ajouté
cette action. Fonctionnellement, un produit repassé en stock ne peut
donc être réactivé aujourd'hui que par le workflow de commande
(annulation) ou une intervention directe en base — pas par une action
"Ajuster le stock" depuis le dashboard. Signalé ici plutôt que corrigé
silencieusement : ce n'est le périmètre explicite d'aucun des 4 lots,
à trancher par le porteur du projet (petit complément au Lot 2 le plus
probable, ou nouveau point pour le Lot 3/une prochaine vague).

## 8. Lot 3 manquant — impact sur cette fusion

Le Lot 3 (WhatsApp/conversations/IA/groupes/publications sociales)
n'a pas encore été livré. Cette fusion ne touche donc à aucun des
fichiers qui lui sont réservés (`marketing-service.ts`, `whatsapp-
group-service.ts`, `ai-*`, `conversation-*`, `messaging-provider.ts`)
— ils sont toujours dans l'état où le Lot N/K les avait laissés. Le
Lot 3 devra être fusionné séparément ; attends-toi à la même collision
de numérotation de migration `0038`/`0039` décrite en section 5 (voir
la note laissée dans `docs/DATABASE.md`).
