# RAPPORT_FUSION_26.md — Fusion CRESYVA-FUSION-V22-BUILD-OK × THRIVE-FUSION-25

**Date : 23/09/2026**
**Fait par : session Claude (chat), à partir de deux fusions déjà produites par deux sessions antérieures distinctes.**

## 0. Ce que sont réellement les deux sources

Les deux fichiers fournis ne sont **pas** deux copies du même livrable : ce sont deux fusions **parallèles et divergentes** du même projet CRESYVA, faites par deux sessions différentes à partir de bases qui se recoupent partiellement.

| | `CRESYVA-FUSION-V22-BUILD-OK.zip` (« V22 ») | `thrive-fusion-25.zip` (« F25 », dans `files__2_.zip`) |
|---|---|---|
| Sources | `cresyva-fusionne-24` + système financier **v21** + Lot P + Lot 4 (prix par pays) + Lot 24 (commentaires) | `cresyva-fusionne-24` + audit sécurité (`thrive-main-corrige`) + système financier **v22-polished** + Lot P + groupes Telegram (travail propre à cette session) |
| Vérifié comment | **Réellement buildé** : `npm ci` / `tsc` / `eslint` / `vitest` (1003/1003) / `next build` (86/86 pages). 6 bugs réels trouvés et corrigés (voir `RAPPORT_VERIFICATION_BUILD_V22.md`) | Vérifié **seulement par relecture syntaxique** — RAPPORT_FUSION_25.md le dit lui-même : jamais de `npm install`/`tsc`/`next build` réel |
| Apporte | Les 6 correctifs de build, un système financier v21→v22 « maison », Lot 4 (dérive de prix par pays) | 3 correctifs de sécurité réels (élévation de privilège, XSS SVG, SSRF YouTube), la fonctionnalité **groupes Telegram** (conversation partagée), un système financier v22-polished plus avancé sur certains points |

**728 fichiers vs 726, 691 identiques, 28 qui divergent réellement, 9 et 7 fichiers propres à chacun.**

## 1. Stratégie de fusion

Base retenue : **V22** (le seul réellement build-testé). Par-dessus, ajout de tout ce que F25 apporte en plus sans rien casser, et arbitrage au cas par cas des 28 fichiers qui divergent réellement.

## 2. Ajouts sans ambiguïté (repris de F25 tels quels)

**Sécurité** (absents de V22) :
- `team-service.ts` (+ test) — verrou élévation de privilège
- `media-service.ts` — liste blanche contre le XSS via SVG
- `youtube/adapter.ts` (+ test, nouveau fichier) — correctif SSRF

**Groupes Telegram** (fonctionnalité absente de V22, ajoutée par la session F25) :
- `mapper.ts` (+ test, nouveau fichier), `domain-events.ts`, `conversation-service.ts`, `conversation-admin-service.ts`, `conversation-thread-view.tsx`, webhook tenant Telegram, `admin/channels/page.tsx` (polish UI associé)

**Système financier** :
- `order-service.ts` — F25 alimente `order_items.unit_cost` à la création d'une commande (cohérent avec la migration 0069/COGS) ; V22 avait perdu ce bout de code, une vraie incohérence interne à corriger
- `admin/payments/page.tsx` — version F25 plus complète (libellé « numéro dédié », composants UI partagés)

**Documentation** : `docs/AI.md`, `docs/RAPPORT_LOT_P.md`, `FINANCIAL_AUDIT_V22.md`, `RAPPORT_FUSION_25.md` conservés pour la traçabilité.

## 3. Fusion manuelle (les deux côtés avaient touché le même code pour des raisons différentes)

**`src/app/api/webhooks/zernio/route.ts`** — V22 avait *câblé* le résolveur de groupes WhatsApp (bug réel corrigé pendant sa session build) et supprimé une fonction dupliquée ; F25 avait ajouté une **3ᵉ couche de défense** (repli sur `externalThreadId` quand `conversation.id` est absent du payload). Résultat : structure de V22 + la couche de défense de F25 réintégrée par-dessus, rien perdu des deux côtés.

**`admin-finance-service.ts` / `.test.ts` / `admin/finance/page.tsx`** — base = version F25 (système v22-polished, plus avancé : nettage des remboursements sur 30 jours, fonction d'édition d'un coût existant conservée), sur laquelle j'ai réappliqué le seul changement de V22 qui est **testé et délibéré** : au-delà de 2000 comptes connectés, Zernio passe en tarif « custom », plus facturé automatiquement à 1 $/compte (`over2000Accounts` → `customAccounts`, test mis à jour en conséquence).

## 4. Migrations — renumérotées pour éviter la collision

V22 et F25 avaient chacun réutilisé 0070/0071 pour des choses différentes. Séquence finale :

| N° | Contenu | Origine |
|---|---|---|
| 0068 | `platform_finance_and_zernio_costs` | identique des deux côtés |
| 0069 | `complete_financial_system` | V22 (corrige le préfixe `public.` qui rendait la table invisible aux tests RLS) |
| 0070 | `finance_category_compatibility` | **F25, uniquement** — corrige un décalage de contrainte CHECK entre 0068 et 0069 |
| 0071 | `ai_handoff_auto_resume` | contenu identique des deux côtés (Lot P), renommée depuis `0068_...` côté V22 |
| 0072 | `fix_plan_prices_drift` | V22, Lot 4 — renommée depuis `0071_...` |

## 5. ⚠️ Point resté un choix par défaut — à valider par vous

`admin-finance-service.ts` : le numéro Zernio **dédié aux groupes WhatsApp** doit-il compter dans le coût Zernio affiché à l'admin plateforme ?
- F25 l'**exclut** explicitement, avec un commentaire justifiant que c'est un enregistrement de configuration, pas un compte facturé.
- V22 l'**inclut**, sans commentaire expliquant pourquoi.

J'ai gardé l'exclusion de F25 par défaut (mieux vaut sous-estimer le coût affiché que le surestimer sans certitude), mais seule votre facture Zernio réelle permet de trancher. Cherchez `groupProviderResult` dans `admin-finance-service.ts` si vous voulez inverser ce choix.

## 6. Bugs trouvés et corrigés *pendant cette fusion* (nouveaux, propres à F25, jamais détectés faute d'avoir lancé `tsc`)

En important les fichiers « groupes Telegram » de F25, `npx tsc --noEmit` a révélé que F25 ne compilait en réalité pas :
1. `mapper.ts` référence `TelegramMessage.reply_to_message` et `.entities`, absents du type — ajoutés dans `types.ts`.
2. Le webhook tenant Telegram attend `botTelegramId`/`botUsername` du résolveur — le résolveur ne les renvoyait pas alors que `telegram_bots` les stocke déjà (`bot_id`, `bot_username`, capturés à la connexion via `getMe()`) ; `resolve-organization.ts` les sélectionne et les renvoie désormais.
3. `mapper.test.ts` lisait `event.payload.contactFullName` sans avoir d'abord vérifié `event.type === "MESSAGE_RECEIVED"` (erreur de type sur l'union `DomainEvent`) — ajout du contrôle avant lecture.

## 7. Vérifications réellement effectuées sur le résultat fusionné

- `npm ci` → OK (465 paquets)
- `npx tsc --noEmit` → **0 erreur**
- `npx eslint .` → **0 erreur** (1 corrigée : apostrophe non échappée dans `admin/payments/page.tsx`, repris de F25)
- `npx vitest run` → **95 fichiers, 1014 tests, tous verts**
- `next build` → non concluant ici : le bac à sable réseau de cette session ne peut pas atteindre `fonts.googleapis.com` (Inter, Poppins, etc. via `next/font/google`), donc le build Turbopack échoue sur la récupération des polices — **rien à voir avec le code fusionné**. À relancer dans un environnement avec accès réseau normal pour la vérification finale (c'est ce qu'avait fait la session V22).

## 8. Fichiers écartés de la fusion (déchets/doublons, présents uniquement dans V22)

- `src/application/services/0068_ai_handoff_auto_resume.sql` — copie exacte de la migration, égarée dans le mauvais dossier
- `src/application/services/docs-AI.md` — brouillon obsolète, `docs/AI.md` (F25) est plus complet
- `RAPPORT_LOT_P.md` (racine) — contenu identique à `docs/RAPPORT_LOT_P.md`, gardé une seule fois à son emplacement F25
- `tsconfig.tsbuildinfo` — artefact de build, ne doit pas être livré
