# Rapport de vérification — build V22 (module finance plateforme + tenant)

Fait suite à `FUSION_flexco _V22.md`, qui notait : *« npm ci tentée mais
interrompu, build non validé »*. Date : 23 septembre 2026.

**Demande** : « build mon projet pour voir si tout passe ». Entrée :
`flexco -FUSION-V22-COMPLETE.zip`.

## 1. Résultat en bref

| Étape | Avant correctifs | Après correctifs |
|---|---|---|
| `npm ci` | ✅ | ✅ |
| `tsc --noEmit` | ❌ 5 erreurs | ✅ 0 erreur |
| `eslint .` | ❌ 13 erreurs + 2 warnings | ✅ 0 erreur |
| Tests unitaires (`vitest run`) | ❌ 7 échecs / 997 | ✅ 1003 / 1003 (dont 6 nouveaux) |
| `next build` | ❌ (jamais atteint) | ✅ 86/86 pages |

6 bugs réels trouvés et corrigés (aucun n'était un problème d'environnement,
sauf mention contraire au §2.6). Détail ci-dessous.

## 2. Bugs trouvés et corrigés

### 2.1 `AppBarChart` utilisé mais jamais défini

`src/app/admin/_components/charts.tsx`, `src/app/admin/finance/page.tsx` et
`src/app/dashboard/finance/page.tsx` importent `AppBarChart` depuis
`app-charts.tsx`, qui n'exportait que `AppLineChart`/`AppDonutChart`. Ajouté
dans le même style (SVG fait main, pas de librairie de graphes), signature
`{ items: { label; value }[] }`.

### 2.2 `tenant-finance-service.ts` — retour cassé

L'objet retourné utilisait le raccourci `operatingExpenses30d,` /
`taxes30d,`, qui référence des variables du même nom — sauf que les
variables locales s'appellent `operatingExpenses30` / `taxes30` (sans le «
d »). `operatingExpenses30d`/`taxes30d` étaient donc `undefined` à
l'exécution, silencieusement (pas d'erreur TypeScript sur un raccourci
d'objet mal nommé provenant d'un scope avec `noUnusedLocals` déjà satisfait
autrement — la variable existait juste sous un autre nom). Corrigé en
`operatingExpenses30d: operatingExpenses30` / `taxes30d: taxes30`.

### 2.3 `vitest.config.ts` / `vitest.integration.config.ts` — doublons obsolètes

Doublons de `vitest.config.mts` / `vitest.integration.config.mts`
(migration Vitest 1→5 antérieure), référençant encore `vite-tsconfig-paths`
— retiré des dépendances lors de cette même migration. Supprimés (les
`.mts` sont la version courante, sans ce plugin).

### 2.4 `tests/rls-policies.test.ts` — préfixe `public.` non géré par le parseur

`0069_complete_financial_system.sql` écrit `alter table public.platform_costs
...` alors que tout le reste du projet (y compris `0068`, dans le même lot)
écrit `alter table platform_costs ...` sans préfixe de schéma — seules les
FONCTIONS sont préfixées `public.` dans ce projet (contournement documenté
dans `0037`, lié au vault Supabase). Le test statique de sécurité RLS parse
le SQL par regex et ne gérait pas ce préfixe : `platform_costs` en sortait
purement et simplement invisible (aucune vérification RLS n'était donc
réellement faite dessus, silencieusement), et `public` lui-même apparaissait
à tort comme une « table » sans RLS.

Corrigé à la source (`0069`, jamais déployée) plutôt que dans le test :
préfixe `public.` retiré de toutes les instructions DDL sur les tables,
gardé uniquement sur l'appel à la fonction `public.set_updated_at()` (seul
cas légitimement préfixé, par convention du projet). `platform_expenses` et
`platform_costs` ajoutées à l'allowlist `SERVICE_ROLE_ONLY_TABLES` du test
(RLS activée, aucune policy — lecture/écriture exclusivement via la console
Super Admin, service role, comme `platform_admins`/`platform_settings`).

### 2.5 Webhook Zernio — numéro dédié aux groupes WhatsApp jamais résolu

`resolveOrganizationIdByWhatsAppGroupsAccount` (`resolve-organization.ts`)
est une fonction complète et déjà documentée (« sans ce résolveur, les
événements de ce numéro étaient rejetés ») — mais jamais importée ni
appelée dans `api/webhooks/zernio/route.ts`. Les messages reçus sur le
numéro Zernio dédié aux groupes étaient donc systématiquement ignorés
(aucun tenant résolu), et l'activation de groupe ne se déclenchait jamais.

Ajoutée comme repli après le résolveur de messagerie standard, avec un
indicateur `isGroupsAccountEvent` (tout message venant de ce compte dédié
est un message de groupe, y compris pour un groupe pas encore « connecté »
par le marchand).

En creusant ce même chemin de code : `route.ts` appelait
`isKnownWhatsAppGroupConversation` (`whatsapp-group-service.ts`) — jamais
mockée par les tests, qui attendent `isWhatsAppGroupThread`
(`whatsapp-group-threads.ts`). Les deux fonctions sont strictement
identiques (même requête, même table `whatsapp_groups`) ; la seconde a été
créée *exprès* pour être la version partagée entre webhook et diffusions
sans tirer le fichier plus lourd (voir son en-tête). `route.ts` appelait
encore l'ancienne. Corrigé (bascule vers `isWhatsAppGroupThread`, ajout
d'une garde « canal WhatsApp uniquement » — un événement Messenger/Instagram
ne peut pas être un groupe WhatsApp) ; `isKnownWhatsAppGroupConversation`
supprimée (doublon mort, plus aucun appelant).

### 2.6 Webhook Telegram plateforme — mauvais fichier au mauvais endroit

`src/app/api/webhooks/telegram/route.ts` (URL fixe, le **bot plateforme** :
alertes opérateur + commandes affiliés `/start` `/mystats` `/help`, voir
`docs/TELEGRAM_INTEGRATION.md`) contenait en réalité une copie du webhook
**tenant** (`telegram/tenant/[token]/route.ts` — canal client par
organisation, bot différent). `next build` l'a détecté via le vérificateur
de routes de Next 16 : cette route sans segment dynamique déclarait un
paramètre `{ params }: { params: Promise<{ token: string }> }` qui n'existe
jamais pour ce chemin.

Toutes les briques de la vraie implémentation existaient déjà, inutilisées :
`infrastructure/providers/telegram/webhook-handler.ts` (vérification du
secret, parsing, hash) et
`application/services/telegram-bot-service.ts::handlePlatformBotMessage`
(déjà tout le traitement `/start` `/mystats` `/help`). Réécrit pour les
relier réellement. 6 tests ajoutés (`route.test.ts`, absent auparavant) :
secret invalide/absent, déduplication `provider = 'telegram_platform'`,
dispatch vers `handlePlatformBotMessage`, update dupliqué ignoré, échec de
traitement marqué `failed` sans faire échouer la réponse HTTP, update sans
`message` (ex. `callback_query`) sans crash.

### 2.7 (non-bug) Google Fonts inatteignable dans ce bac à sable

Comme lors de toutes les sessions précédentes sur ce projet :
`next/font/google` (`src/app/fonts.ts`, `src/app/layout.tsx`) nécessite un
accès réseau à Google Fonts, absent de ce bac à sable. Stubé temporairement
le temps du build (fonctions renvoyant juste `{ variable }`), fichiers
originaux restaurés à l'identique avant livraison (diff vérifié vide) — pas
un problème de code.

## 3. Ce qui n'a PAS été vérifié

- `next build` utilise des identifiants Supabase factices
  (`NEXT_PUBLIC_SUPABASE_URL` etc., jamais commités — `.env.local` créé puis
  supprimé) : aucune requête réseau réelle n'a eu lieu, seule la
  compilation/génération de pages est validée. Les échecs de lecture
  attendus (`/api/public/countries`, réglages plateforme, plans) pendant la
  génération statique sont gérés avec dégradation gracieuse par le code
  lui-même (déjà en place, pas une régression).
- Comme pour toutes les sessions précédentes : `tests/integration/tenant-isolation.test.ts`
  et les specs Playwright nécessitent respectivement un vrai projet
  Supabase et un accès réseau à `cdn.playwright.dev`, tous deux absents ici
  — non exécutés.
- Migration `0069` corrigée (§2.4) mais jamais appliquée à une vraie base
  dans ce passage (pas de PostgreSQL disponible cette fois).

## 4. Livraison

Zip du projet complet (`node_modules`/`.next` exclus), incluant ce rapport.
