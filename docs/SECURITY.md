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

**Non fait dans ce dépôt** : un vrai test d'intégration qui vérifie qu'un
user du tenant A ne peut pas lire les données du tenant B (nécessite une
instance Supabase réelle — voir `docs/ROADMAP.md`). Le mécanisme est en
place et suit le pattern standard Supabase RLS, mais n'a pas été vérifié
en conditions réelles.

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

## Vulnérabilités connues des dépendances (dernière vérification : 28 août 2026)

| Dépendance | Vulnérabilité | Impact réel | Action |
|---|---|---|---|
| `next@14.2.35` (résiduel) | CVE-2026-64643 — divulgation d'endpoints Server Function internes | Modérée, ne s'applique qu'aux apps utilisant `"use cache"` — **non utilisé dans ce projet** | Documenté, pas de correctif 14.x disponible (nécessite 15.5.21+/16.2.11+) |
| `next` (bundled postcss) | XSS/path traversal PostCSS | Build-time uniquement, CSS 100% auteur (jamais d'input utilisateur/externe traité) | Documenté |
| `vitest@1.6.1` (devDependency) | RCE si serveur UI Vitest exposé | Dev uniquement, jamais buildé en prod ; notre script `npm test` utilise `vitest run` (pas de serveur écoutant) | Ne pas utiliser `vitest --ui` sans upgrade avant correctif |

Aucune de ces vulnérabilités résiduelles n'a été jugée comme justifiant un
saut de version majeure (breaking changes) sans validation explicite du
mainteneur du projet — conforme à la règle "ne pas changer de stack sans
justification technique extrêmement forte".

## Audit log

`audit_logs` trace : import CSV produit, fallback IA, et les actions de la
console Super Admin (suspension/activation d'entreprise, changement de
plan, ajout de crédits IA, ajout de numéro — Lot C). À étendre à toute
nouvelle action sensible future (permissions, fournisseur) au fur et à
mesure que ces écrans admin sont construits.
