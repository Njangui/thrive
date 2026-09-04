# Rapport de fusion #4 — Lots L, M, N

Quatrième vague de fusion, sur la base du projet précédemment fusionné
(Lots B à I + G, voir `RAPPORT_FUSION.md`/`RAPPORT_FUSION_2.md`/
`RAPPORT_FUSION_3.md`). Avec cette fusion, la vague K-O
(`00_CONVENTIONS_COMMUNES_V3.md`) est complète à l'exception du **Lot K**
(jamais reçu — comme le Lot A en vague B-E, traité comme non livré plutôt
que bloquant) et du **Lot O** (cahier reçu, tests réels/seed
démo/consolidation doc, pas encore commencé — `scripts/` est vide,
`tests/integration/` n'existe pas).

## 1. Vérifications finales

- `npm install` → OK (493 paquets)
- `npm run typecheck` → **0 erreur** (après un correctif, voir section 4)
- `npm test` → **294/294 tests passants**, 32 fichiers
- `npm run lint` → **0 warning**
- `npm run build` → **succès réel, code de sortie 0**, 40 routes générées
  — même contournement temporaire et sans conséquence du fetch réseau
  `next/font` que documenté dans `RAPPORT_FUSION_2.md`/`RAPPORT_FUSION_3.md`
  (sandbox sans accès `fonts.googleapis.com`), `src/app/layout.tsx`
  restauré à l'identique juste après (diff vérifié, zéro différence).
  Variables Supabase factices utilisées uniquement le temps du build
  (jamais commises, supprimées avant packaging).
  - Même note bénigne que RAPPORT_FUSION_2.md : `/admin/logs/export`
    logue une erreur "Dynamic server usage" pendant la génération —
    Next.js qui sonde en interne si la route peut être statique, pas une
    vraie erreur (apparaît correctement en route dynamique `ƒ`).

## 2. Point de départ : trois statuts différents pour les trois lots

- **Lot N** — livré comme `sme-os-fusionne-lot-n.zip` : développé
  **directement dans une copie du projet déjà fusionné B-I+G** (accès
  réseau réel, comme Lot G), donc l'archive reçue EST déjà l'état fusionné
  jusqu'à N. Aucune fusion à refaire pour ce lot seul — pris comme
  nouvelle base de départ pour cette vague.
- **Lot L** — livré en arbre complet, développé **sur la base fusion-3
  (B-I+G) en parallèle de N**, sans connaissance du travail de N (confirmé
  par la présence de `RAPPORT_FUSION_3.md`/`RAPPORT_LOT_G.md` dans son
  arbre mais aucune trace de N). A donc fallu isoler précisément ce que L
  a changé par rapport à cette base commune (diff complet entre l'arbre L
  et la base N-fusionnée) avant de rien copier, exactement comme pour les
  vagues précédentes.
- **Lot M** — livré en **delta seul** (16 fichiers, pas d'arbre complet),
  et signale lui-même **l'absence totale d'accès réseau** dans son
  environnement (`npm install` → 403 sur `registry.npmjs.org`) :
  `typecheck`/`test`/`lint`/`build` n'avaient donc jamais été exécutés
  réellement côté auteur, seulement une relecture manuelle ligne par
  ligne. Le correctif nécessaire trouvé à la fusion (section 4) confirme
  que cette réserve honnête était justifiée — sans invalider le reste du
  travail, qui s'est révélé correct au test.

## 3. Cinq vraies collisions, résolues manuellement

### `src/infrastructure/providers/registry.ts` (Lot L + Lot N) — la plus délicate

Les deux lots modifiaient la même zone (`buildAIAdapter`/`getAIProvider`)
pour des raisons indépendantes :
- **Lot N** rendait `buildAIAdapter` asynchrone et le faisait résoudre le
  credential PAR TENANT (`resolveCredential`) plutôt que la seule clé
  plateforme.
- **Lot L** ajoutait `AI_PROVIDER_NAMES`/`DEFAULT_MODEL_BY_PROVIDER`
  (source unique de vérité consommée par `ai-config-service.ts` et
  `/dashboard/ai`) et corrigeait un bug latent : le provider de secours
  réutilisait le modèle du provider PRINCIPAL au lieu d'un modèle de sa
  propre famille.

Fusionné en gardant l'architecture async/credential-par-tenant de N
**et** en réintégrant les constantes + le correctif de bug de L (que la
version N seule, développée sans connaissance du fix, aurait sinon
silencieusement réintroduit). `getEmailProvider()` (Lot L, avec ses
imports `EmailProvider`/Resend/ConsoleLog) réintégré à l'identique, N ne
touchant pas cette zone du fichier.

### `.env.example` + `src/lib/env.ts` (Lot L + Lot N)

Additions non chevauchantes de part et d'autre (`RESEND_API_KEY`/
`EMAIL_FROM_ADDRESS` pour L, `OPENPROVIDER_USERNAME`/`PASSWORD` déjà
présents côté N) — fusion directe, les deux blocs cohabitent.

### `docs/DATABASE.md` (Lot L + Lot N)

Lot N n'avait en réalité rien ajouté à ce document (absent de sa liste de
fichiers modifiés, confirmé par grep — aucune mention de ses propres
migrations 0036/0037). La version livrée par L (base fusion-3 + ses
propres ajouts) contenait donc déjà tout le contenu utile : reprise telle
quelle, aucun arbitrage nécessaire.

### `src/app/dashboard/layout.tsx` (Lot L + Lot M)

Deux ajouts de liens de navigation indépendants (L : "Clients",
"Commandes", "Assistant IA", "Équipe" ; M : "Publications") — fusionnés
sans conflit réel dans le même tableau `NAV_ITEMS`.

### Fichiers modifiés par N seul, faussement suspects au premier diff

`src/app/admin/organizations/page.tsx`, `src/app/dashboard/site/page.tsx`,
`src/application/services/addons-service.ts` (+`.test.ts`),
`admin-organizations-service.ts`, `domain-service.ts`,
`subscription-payment-service.ts` (+`.test.ts`), `secrets-resolver.ts`
différaient tous entre l'arbre L et la base N — mais dans chaque cas
c'est uniquement parce que N les avait modifiés après la divergence des
deux lots, pas parce que L y avait touché. Vérifié un par un (recherche
de chaque fonction ajoutée par N dans le texte des rapports L, aucune
mention) avant de les laisser tels quels côté N — aucune copie L
effectuée sur ces fichiers.

## 4. Un vrai bug trouvé à la fusion (pas dans les rapports individuels)

`src/application/services/marketing-service.test.ts:204` (Lot M) —
`mockNotifyOrgAdmins.mock.calls[0][0]` échouait au typecheck
(`noUncheckedIndexedAccess`, TS2532). Confirme exactement la réserve
posée par `RAPPORT_LOT_M.md` section 5 ("je ne peux pas prétendre avoir
fait tourner tsc"). Corrigé avec la même assertion non-null `!` déjà
utilisée pour le même pattern dans `onboarding-service.test.ts` et
`subscription-payment-service.test.ts` (convention établie du projet,
pas une invention).

## 5. Aucune collision de migration

- Lot L : `0033_team_invitations.sql`
- Lot M : `0035_post_platform_id.sql`
- Lot N : `0036_recurring_billing.sql`, `0037_tenant_credentials.sql`

Séquence finale : 0001→0018, 0019→0021 (Lot G), 0022→0026, 0030, 0033,
0035→0037. Trous volontaires (0027-0029, 0031-0032, 0034) — plages
réservées non utilisées par cette vague, sans risque.

## 6. Contenu réel des trois lots (au-delà des rapports individuels)

- **Lot L** — Gestion d'équipe (invitations par email via Resend, repli
  console si non configuré ; un Admin ne peut jamais toucher un Owner ;
  protection du dernier Owner), configuration IA par tenant
  (`/dashboard/ai`, provider/fallback/objectifs, jamais le nom de modèle
  brut), écrans CRM (`/dashboard/leads`) et commandes
  (`/dashboard/orders` + détail) branchés sur des services déjà
  existants mais jamais exposés en UI avant ce lot. Corrige aussi le
  flux d'acceptation d'invitation de bout en bout (`/login` → `next` →
  `/auth/callback` → `/invite/accept`), pas seulement en isolation.
- **Lot M** — Un groupe WhatsApp jamais contacté devient réellement
  diffusable dès son premier message reçu (`zernio_conversation_id`
  renseigné au webhook `message.received`, refus explicite à la création
  d'une diffusion tant que ce n'est pas le cas). Synchronisation réelle
  des statuts de publication sociale (`post.*` webhooks →
  `social_posts`/`social_post_targets`, idempotent par UPDATE ciblé),
  nouvel écran `/dashboard/marketing` en lecture.
- **Lot N** — Facturation récurrente réelle côté application (NotchPay
  n'ayant aucune ressource de prélèvement), intégration réelle
  OpenProvider pour la recherche/disponibilité de domaines (repli
  Manual pour l'enregistrement, conforme au mandat V3), credentials IA/
  messaging/social configurables par tenant via `provider_connections` +
  Supabase Vault (jamais en clair, jamais dans les audit logs).

## 7. Ce qui reste

- **Lot K** — jamais reçu, traité comme non livré (même statut que le
  Lot A en vague B-E).
- **Lot O** — cahier reçu (`10_LOT_O_...md`), pas encore réalisé : test
  d'isolation multi-tenant réel contre une vraie instance Supabase,
  tests de bordure paramétrés sur chaque `entitlement_key`, câblage de
  `product_click`/`conversation_started`, migration des derniers liens
  publics vers `resolveRequestOrigin()`, seed de démo "Mode Élégance",
  consolidation finale de `docs/ROADMAP.md`/`GAP_ANALYSIS.md`/
  `SECURITY.md`/`MVP_SCOPE.md`.
- `docs/ROADMAP.md`/`GAP_ANALYSIS.md` n'ont **pas** été mis à jour par
  cette fusion (délibérément — c'est le périmètre explicite du Lot O,
  Partie 5) : ils ne reflètent donc pas encore les Lots L/M/N.
