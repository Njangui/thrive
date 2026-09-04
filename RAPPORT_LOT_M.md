# Rapport — Lot M : Groupes WhatsApp jusqu'au bout de la diffusion + synchronisation des publications

## 1. Ce qui a été fait

### Vérification API (avant tout code — mandat de la vague K-O)

Deux points étaient explicitement laissés ouverts par les lots précédents.
Les deux ont été vérifiés sur `docs.zernio.com` (31 août 2026), jamais
devinés — détail complet, citations et ce qui reste incertain dans
**`docs/ZERNIO_INTEGRATION.md`** (sections "Groupes WhatsApp" et
"Publications sociales — synchronisation des résultats", mises à jour).

| Question | Verdict |
|---|---|
| Comment un groupe WhatsApp jamais contacté peut-il un jour devenir diffusable ? | **CONFIRMÉ** : "Each group has its own conversation thread identified by the group ID" (`docs.zernio.com/platforms/whatsapp/groups`) — pour un groupe, `conversationId === l'id du groupe`. La conversation Zernio est créée dès le premier message REÇU, jamais avant. Le webhook `message.received` (déjà câblé pour les conversations 1:1) est le seul mécanisme d'activation réel. |
| Nom exact du champ "à confirmer" laissé par le Lot H (`platformResults`) | **CONFIRMÉ** : le champ s'appelle `platforms` (tableau), pas `platformResults`. Forme : `{ platform, accountId, status, platformPostId?, platformPostUrl?, error? }` — vérifiée sur les pages Facebook/Threads de la doc Zernio (exemples de réponse `POST/GET /posts`) et le blog officiel "How we built an API for AI content tools". |
| Liste des événements webhook `post.*` | **CONFIRMÉE** : `post.scheduled`, `post.published`, `post.failed`, `post.partial`, `post.cancelled`, `post.recycled` (agrégés) + `post.platform.published`, `post.platform.failed` (par plateforme) — recoupée entre `docs.zernio.com/webhooks`, le SDK officiel `zernio-php` et `zernio-dev/n8n-nodes-zernio`. |

**Point de vigilance honnête, gardé ouvert** (pas deviné, pas simulé) : la
forme EXACTE de l'enveloppe du webhook `post.*` lui-même (racine plate vs
`{ post: {...} }`) n'a pas pu être confirmée verbatim — seul le blog
officiel confirme que le payload contient a minima l'id du post, son
statut final, et un message d'erreur en cas d'échec. `mapZernioPostEventToDomainEvent`
(mapper.ts) est conçu pour rester tolérant à cette incertitude précise
(accepte `post._id`, `post.id`, ou `postId` à la racine) plutôt que de
deviner une forme unique et planter en production si elle diffère. Voir
section 4 "TODO explicite" ci-dessous — ce point nécessite un vrai compte
Zernio (fonctionnalité "Test webhook" du dashboard) pour être scellé,
exactement le type de vérification que les conventions réservent au
porteur du projet.

### Partie 1 — Diffusion vers un groupe jamais contacté

Le vrai trou trouvé en lisant le code (pas supposé) : **rien, nulle part
dans le projet, n'écrivait jamais `whatsapp_groups.zernio_conversation_id`**
— la colonne existait (Lot F) mais restait NULL pour toujours, et
`createBroadcast` ne vérifiait que `status = 'connected'`, jamais cette
colonne. Une diffusion vers un groupe jamais contacté pouvait donc être
créée avec succès puis échouer silencieusement au traitement cron.

Construit :

- **`activateGroupFromInboundConversation(organizationId, conversationId)`**
  (nouveau, `whatsapp-group-service.ts`) — appelée depuis le webhook à
  CHAQUE `message.received`, matche `conversation.id` contre
  `whatsapp_groups.external_id` de l'organisation et renseigne
  `zernio_conversation_id` au premier message reçu d'un groupe (texte ou
  média — ne dépend pas de `mapZernioEventToDomainEvent`, qui peut
  renvoyer `null` pour un message sans texte). Idempotente (UPDATE ciblé,
  `WHERE zernio_conversation_id IS NULL`), jamais bloquante (best-effort).
- **`createBroadcast`** modifiée : refuse désormais explicitement, À LA
  CRÉATION, toute cible dont `zernio_conversation_id` est encore NULL —
  message nommant le(s) groupe(s) concerné(s), jamais un échec générique
  ni découvert après coup. Le filet de sécurité côté cron
  (`processOneBroadcast`) reste en place en défense en profondeur.
- **`/dashboard/groups`** : la colonne "Diffusable Oui/Pas encore" devient
  un badge "Prêt"/"En attente d'activation" ; un bandeau apparaît sous le
  tableau quand au moins un groupe est en attente, avec l'instruction
  exacte du cahier ("envoyez n'importe quel message... une seule fois")
  et un bouton "Vérifier maintenant" (réutilise `syncGroupsAction`
  existant — un second appel à `syncGroupsFromZernio` n'a aucun effet
  s'il ne trouve rien de neuf, donc pas de nouvelle action serveur créée
  pour ce bouton, juste un point d'entrée UI supplémentaire vers l'action
  déjà existante).

### Partie 2 — Synchronisation des résultats de publication

Types (`messaging/zernio/types.ts`), routage tenant
(`resolve-organization.ts`), traduction webhook -> `DomainEvent`
(`mapper.ts`, nouveau type `SOCIAL_POST_STATUS_UPDATED` dans
`domain-events.ts`), traitement métier (`marketing-service.ts`), et
branchement dans `app/api/webhooks/zernio/route.ts` :

- Le webhook reçoit maintenant deux catégories d'événements sur la même
  route : inbox (`account.id` comme clé tenant, inchangé) et `post.*`
  (routés via **notre propre** `social_posts.provider_post_id`, plutôt
  que de deviner un champ `profileId` non confirmé côté payload — voir
  `resolveOrganizationIdByProviderPostId`, commentée en détail sur ce
  choix).
- **`handlePostStatusWebhook`** (nouveau, `marketing-service.ts`) : met à
  jour `social_posts.status`/`error_message` et, par cible,
  `social_post_targets.status`/`platform_post_id`/`platform_post_url`/
  `error_message` — par UPDATE ciblé (jamais un INSERT), donc idempotent
  par construction même au-delà de la déduplication déjà en place sur
  `webhook_events` (protège aussi contre deux événements DIFFÉRENTS —
  agrégé + par-plateforme — décrivant le même aboutissement). Notifie les
  admins (`notifyOrgAdmins`) sur tout échec (agrégé ou par plateforme).
  `trackEvent("publication_published")` s'y déclenche désormais — plus à
  la programmation (voir ci-dessous) — gardé par le statut PRÉCÉDENT du
  post pour ne compter qu'une fois même si plusieurs événements
  confirment le même aboutissement.
- **TODO résolu, signalé par `RAPPORT_LOT_H.md`** :
  `trackEvent("publication_published")` ne se déclenche plus au moment de
  la programmation (`createCampaignFromProducts`) — l'appel a été retiré
  de cette fonction, avec un commentaire renvoyant vers le nouveau point
  de déclenchement.
- **`listRecentPosts`** (nouveau, lecture) + **`/dashboard/marketing`**
  (nouvel écran — voir "Décision de scope" ci-dessous) : liste les
  publications avec leur statut réel par plateforme, lien vers le post
  publié quand connu, message d'erreur affiché quand échec. Ajouté à la
  navigation du dashboard.
- Migration `0035_post_platform_id.sql` : ajoute
  `social_post_targets.platform_post_id` (le second identifiant confirmé
  aux côtés de `platform_post_url`, qui existait déjà depuis le Lot D).

### Décision de scope — `/dashboard/marketing`

Le cahier suppose un écran de publications déjà existant ("l'écran de
publications existant — vérifiez son emplacement réel"). Recherche
exhaustive dans `src/app` : **aucune route, aucune page n'utilise
`marketing-service.ts`** — le Lot H avait construit
`createCampaignFromProducts` (service) sans jamais construire d'UI pour
créer une campagne (sélection de produits, de comptes cibles,
planification). Construire cette UI de A à Z n'est pas ce que demande CE
cahier ("Groupes WhatsApp + **synchronisation** des publications") — c'est
un chantier à part entière (sélection de produits/comptes, pas seulement
de l'affichage). La page livrée est donc volontairement une **liste en
lecture, réelle et fonctionnelle**, branchée sur les vraies données :
c'est elle qui satisfait le critère d'acceptation "afficher le statut réel
par plateforme". La création de campagne reste accessible uniquement via
`createCampaignFromProducts` (service), comme avant ce lot.

## 2. Fichiers créés

- `supabase/migrations/0035_post_platform_id.sql`
- `src/app/dashboard/marketing/page.tsx`
- `RAPPORT_LOT_M.md`

## 3. Fichiers modifiés

- `src/application/services/whatsapp-group-service.ts` — `activateGroupFromInboundConversation`, `createBroadcast` (refus à la création).
- `src/application/services/whatsapp-group-service.test.ts` — 4 fixtures existantes corrigées (`zernio_conversation_id` désormais requis pour un groupe "prêt"), 5 nouveaux tests.
- `src/infrastructure/providers/messaging/zernio/types.ts` — types `post.*` (événements, `ZernioPostPlatformResult` confirmé, `ZernioWebhookEvent` union, `isZernioPostEvent`).
- `src/infrastructure/providers/messaging/zernio/webhook-handler.ts` — type de retour de `parseZernioWebhookPayload` élargi à l'union.
- `src/infrastructure/providers/messaging/zernio/mapper.ts` — `mapZernioPostEventToDomainEvent` (nouveau).
- `src/infrastructure/providers/messaging/zernio/mapper.test.ts` — 5 nouveaux tests pour la nouvelle fonction.
- `src/infrastructure/providers/messaging/zernio/resolve-organization.ts` — `resolveOrganizationIdByProviderPostId` (nouveau).
- `src/domain/events/domain-events.ts` — `SOCIAL_POST_STATUS_UPDATED` + `SocialPostStatusUpdatedEvent`.
- `src/application/services/marketing-service.ts` — `handlePostStatusWebhook`, `listRecentPosts` (nouveaux) ; retrait du `trackEvent` à la programmation.
- `src/application/services/marketing-service.test.ts` — builder Supabase mocké étendu (table-based, avec suivi des `update`), 5 nouveaux tests pour `handlePostStatusWebhook`.
- `src/application/services/notification-service.ts` — `buildRelatedEntityUrl` accepte `"social_post"`.
- `src/app/api/webhooks/zernio/route.ts` — branchement `post.*` vs inbox ; appel à `activateGroupFromInboundConversation` sur chaque `message.received`.
- `src/app/dashboard/groups/page.tsx` — badges d'activation + bandeau d'instructions + bouton "Vérifier maintenant".
- `src/app/dashboard/layout.tsx` — entrée de navigation "Publications".
- `docs/ZERNIO_INTEGRATION.md` — sections "Groupes WhatsApp" et "Ce qui reste à confirmer" mises à jour ; nouvelle section "Publications sociales — synchronisation des résultats".

## 4. Hypothèses et TODO explicite

Les deux seuls TODO restants concernent une vérification qui nécessite un
accès réel à un compte Zernio de production — carve-out explicite des
conventions, jamais une fonctionnalité non construite :

- **Forme exacte de l'enveloppe webhook `post.*`** (racine plate vs objet
  `post` imbriqué — voir section 1 ci-dessus). Le code est écrit pour
  tolérer les deux formes plausibles ; à confirmer avec un vrai payload
  via "Test webhook" (dashboard Zernio) avant mise en production, puis
  ajuster `mapZernioPostEventToDomainEvent` si besoin (un seul point de
  correction, isolé).
- **Format exact d'`accountId` sur `DELETE .../hide`** — reporté du Lot I,
  toujours ouvert, sans lien avec ce lot.

Hypothèse assumée et documentée (pas un TODO — décision de conception
prise et expliquée dans le code) : le routage tenant des événements
`post.*` se fait via `social_posts.provider_post_id` plutôt que via un
champ `profileId` non confirmé au niveau du payload webhook — voir
`resolve-organization.ts` et `docs/ZERNIO_INTEGRATION.md`.

## 5. Limitation d'environnement — à lire avant de faire confiance à ce lot

**Ce bac à sable n'a pas d'accès réseau** (`npm install` échoue : `403
Forbidden` sur `registry.npmjs.org`, aucun `node_modules` ni cache
préexistant). Il m'a donc été impossible d'exécuter réellement
`npm run typecheck`/`test`/`lint`/`build` sur ce projet — je ne peux pas
prétendre l'avoir fait.

Ce qui a été fait à la place, pour compenser au mieux :
- Relecture manuelle ligne par ligne de chaque fichier modifié, en
  traçant explicitement les types (signatures, unions discriminées,
  narrowing dans `route.ts`) plutôt qu'en supposant que ça compile.
- Traçage manuel de chaque nouveau test (les 5 dans
  `whatsapp-group-service.test.ts`, les 5 dans `marketing-service.test.ts`,
  les 5 dans `mapper.test.ts`) contre l'implémentation réelle, valeur par
  valeur, pour vérifier que les assertions correspondent au comportement
  du code — pas seulement écrites puis supposées correctes.
- Vérification que les 4 fixtures `whatsapp_groups` déjà existantes dans
  `whatsapp-group-service.test.ts` (utilisées par des tests qui ne
  testent PAS l'activation) ont bien été mises à jour avec
  `zernio_conversation_id` pour ne pas casser sous le nouveau
  comportement de `createBroadcast`.
- Vérification grossière d'équilibrage des accolades/parenthèses sur tous
  les fichiers touchés (filet de sécurité minimal, pas un substitut à un
  vrai `tsc`).

**Action requise avant merge, côté porteur du projet** : exécuter
`npm run typecheck && npm run test && npm run lint && npm run build`
dans un environnement avec accès réseau. Je m'attends à ce que ça passe
compte tenu de la relecture faite, mais je ne peux pas le confirmer avec
la même certitude qu'un lot où la commande a réellement tourné — c'est
une différence honnête à ne pas gommer.
