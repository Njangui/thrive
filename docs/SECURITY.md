# Sécurité

## Isolation multi-tenant

Double barrière, jamais une seule :
1. **RLS Postgres** — `is_member_of_org()` sur chaque table (voir `docs/DATABASE.md`)
2. **`requireMembership(orgId, roles)`** — vérification explicite en tête
   de chaque route/Server Action admin (`application/services/auth-service.ts`)

RLS n'est jamais désactivée pour "faciliter le développement". Le
`service_role` (qui bypass RLS) n'est utilisé que pour les webhooks et
l'onboarding, toujours avec un filtre explicite par `organization_id`
dans le code applicatif.

**Test d'intégration réel** : `tests/integration/tenant-isolation.test.ts`
vérifie, contre une vraie instance Supabase (jamais un mock), qu'un
utilisateur membre d'une seule organisation ne peut ni lire ni écrire
les données d'une autre — sur les 24 tables tenant-scoped du projet
(lecture large, lecture ciblée par id, tentative de modification,
tentative d'usurpation à la création). Volontairement séparé de
`npm test` (`npm run test:integration`, sa propre config Vitest) et
jamais exécuté automatiquement : il attend un projet Supabase DÉDIÉ aux
tests (`SUPABASE_TEST_URL`/`SUPABASE_TEST_ANON_KEY`/
`SUPABASE_TEST_SERVICE_ROLE_KEY`, voir l'en-tête du fichier), avec un
garde-fou qui refuse de tourner si cette URL correspond à
`NEXT_PUBLIC_SUPABASE_URL` (déjà présent). Construit à la fusion des
Lots 1/2/4 (périmètre hérité du Lot O) — **jamais encore exécuté**
faute d'accès réseau à une instance réelle dans l'environnement où ce
projet est construit ; c'est au porteur du projet de le lancer.

Complémentaire de `tests/rls-policies.test.ts` (Lot 1) : celui-ci est
une analyse statique des fichiers de migration (chaque table créée
a-t-elle `enable row level security` + au moins une policy ?) — rapide,
tourne dans `npm test`, mais ne prouve pas qu'une policy filtre
correctement en pratique. Les deux sont complémentaires, ni l'un ni
l'autre ne remplace l'autre.

## Cron

Les routes `src/app/api/cron/*` sont protégées par
`src/lib/cron-auth.ts::checkCronAuth()` (Lot 1) : en l'absence de
`CRON_SECRET` configuré, le comportement diffère explicitement selon
l'environnement — **refus fail-safe en production**
(`NODE_ENV === "production"`), simple avertissement loggé en
développement (pour ne pas bloquer un développeur qui n'a pas encore
configuré ce secret localement). Avant ce correctif, une route cron
sans secret configuré laissait passer la requête dans tous les cas.

## Console Super Admin (`/admin/*`)

Mécanisme entièrement séparé de l'isolation multi-tenant ci-dessus — la
console `/admin/*` (Lot C) n'est PAS scopée à une organisation, elle lit/
agit volontairement sur toutes les organisations, via
`requirePlatformAdmin()` (`application/services/platform-admin-service.ts`)
et non `requireMembership()`.

- `platform_admins` (migration `0015`) a RLS activée mais **aucune
  policy**, pour aucun rôle client — accès service-role uniquement,
  exclusivement depuis `requirePlatformAdmin()`. Même une lecture "suis-je
  admin ?" depuis un client authentifié serait un vecteur d'énumération.
- Devenir super admin = insertion manuelle en base, aucune UI de
  self-service (voir `docs/DEPLOYMENT.md`).
- `requirePlatformAdmin()` est rappelée à la fois par `/admin/layout.tsx`
  ET individuellement par chaque page et chaque Server Action mutante —
  un Server Action reste un point d'entrée HTTP à part entière, pas
  protégé par le rendu de la page qui l'entoure.
- Un utilisateur non-admin qui accède à `/admin/*` reçoit un 404
  générique (`notFound()`), jamais une page "Accès refusé" qui
  confirmerait l'existence de la console.
- `/admin/*` n'expose jamais `provider_connections.credential_reference`
  ni aucune clé API, même en lecture — uniquement des statuts
  (`application/services/admin-channels-service.ts`).
- Toute action de modification (suspendre/activer une entreprise,
  changer de plan, ajouter des crédits IA, ajouter un numéro) écrit une
  ligne `audit_logs` avant/après état, avec `actor_user_id` = l'admin qui
  a agi.

## Secrets

- Aucune clé API n'est jamais exposée au frontend (`NEXT_PUBLIC_*` ne
  contient que l'URL Supabase et la clé anon, qui sont conçues pour être
  publiques et protégées par RLS).
- `ZERNIO_API_KEY`, `MISTRAL_API_KEY`, etc. : uniquement lues côté serveur
  (`src/lib/env.ts`, `secrets-resolver.ts`).
- `provider_connections.credential_reference` : **jamais** de clé en
  clair dans cette colonne — c'est un id Supabase Vault
  (`vault_create_secret`/`vault_read_secret`/`vault_update_secret`/
  `vault_delete_secret`, migration `0037_tenant_credentials.sql`,
  réservées à `service_role` uniquement, jamais `anon`/`authenticated`).
  Résolution per-tenant réelle et câblée (`secrets-resolver.ts::resolveCredential`,
  utilisée par `getMessagingProvider`/`getSocialPublishingProvider`/
  `getAiProvider` dans `registry.ts`) : un tenant avec un compte
  Zernio/IA dédié utilise SON credential ; en son absence, repli
  automatique vers la clé plateforme (`ZERNIO_API_KEY` etc., un seul
  compte pilote partagé) — comportement inchangé pour tous les tenants
  qui n'ont pas encore configuré de compte dédié. **Point vérifié à jour
  lors de l'audit Lot 1** (nouveau master prompt) : ce paragraphe
  indiquait auparavant que cette résolution per-tenant restait à
  construire — c'est fait depuis le Lot N, cette note documentait un état
  passé du code, pas l'état réel au moment de la lecture (section 98/81
  du master prompt : le code est la source de vérité, la doc doit suivre).

## Erreurs — jamais de détail interne exposé

`lib/errors.ts` : toute erreur non anticipée devient `{"error": "Erreur interne"}`
côté client, jamais le message brut (qui pourrait contenir un nom de
table, une connection string...). Testé dans `errors.test.ts`.

## Webhooks

- Signature HMAC-SHA256 vérifiée en comparaison à temps constant
  (`crypto.timingSafeEqual`) — protection contre les attaques par timing.
- Idempotence stricte (`webhook_events`, contrainte unique).
- Un événement dupliqué ou une erreur de traitement isolée ne fait jamais
  planter tout le batch (voir `route.ts`).

## Vulnérabilités connues des dépendances (dernière vérification : 20 septembre 2026)

`npm audit` sur l'arbre fusionné (Next 16.3.5, React 19.3.0, Vitest 5.0.1…) :
**0 vulnérabilité** (info/low/moderate/high/critical = 0, 603 dépendances).

Les trois entrées suivies jusqu'au 28 août 2026 sont **résolues par la migration de dépendances
de la fusion #18** (voir `RAPPORT_FUSION_18.md` et `SECURITY_DEPENDENCY_AUDIT_2026-09-20.md`) :

| Ancienne entrée | Statut |
|---|---|
| `next@14.2.35` — CVE-2026-64643 (endpoints Server Function internes, `"use cache"`) | Résolu : `next@16.3.5` |
| `next` (postcss embarqué) — XSS/path traversal, build-time | Résolu : plus signalé par `npm audit` |
| `vitest@1.6.1` — RCE si serveur UI exposé | Résolu : `vitest@5.0.1` |

Rappel de la règle du projet : ne pas changer de stack sans justification technique forte. La
montée de versions majeures de la fusion #18 est justifiée par les avis de sécurité Next.js de
décembre 2025 (branches 13.x à 16.x) — voir §9 de l'audit du 20/09/2026. À rejouer `npm audit`
avant chaque mise en production.

## Audit log

`audit_logs` trace : import CSV produit, fallback IA, et les actions de la
console Super Admin (suspension/activation d'entreprise, changement de
plan, ajout de crédits IA, ajout de numéro — Lot C). À étendre à toute
nouvelle action sensible future (permissions, fournisseur) au fur et à
mesure que ces écrans admin sont construits.
