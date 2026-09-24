# Intégration Zernio

Zernio est la couche d'intégration WhatsApp + réseaux sociaux (section 13
doc produit). Notre backend ne lui donne jamais un accès direct à
Supabase — on récupère les données pertinentes puis on appelle l'API
Zernio nous-mêmes.

**Règle suivie tout du long** (et vérifiée activement pendant la
construction, pas supposée) : ne jamais deviner un endpoint. Deux fois
pendant ce projet, une hypothèse initiale s'est révélée fausse après
consultation de docs.zernio.com — les corrections sont tracées dans
`docs/GAP_ANALYSIS.md` et dans les commentaires des fichiers concernés.

## Ce qui est CONFIRMÉ (consulté sur docs.zernio.com, 27 août puis 31 août 2026 pour les Lots F et I)

- Base URL : `https://zernio.com/api/v1`, auth `Authorization: Bearer <clé>`
- Modèle multi-tenant Zernio : un **profile** par tenant, chaque profile
  contient des **accounts** (WhatsApp, Facebook, Instagram...)
- Répondre à un message entrant : `POST /inbox/conversations/{conversationId}/messages`
  avec `{ accountId, message }` — **pas** un envoi "à froid" par numéro
- Webhooks : enveloppe `{ id, event, message, conversation, account, timestamp }`,
  signature `X-Zernio-Signature` (HMAC-SHA256 hex), déduplication sur `payload.id`
- Routage multi-tenant des webhooks inbox : `account.id`
- Social publishing : `POST /posts` (un seul endpoint pour brouillon/
  programmation/publication immédiate), `GET /posts/{id}`, `DELETE /posts/{id}`
  (annule un brouillon/post programmé, jamais un post publié),
  `GET /analytics`
- Idempotence native : header `x-request-id` sur `POST /posts`
- Les URLs Supabase Storage sont auto-proxées par Zernio (pas de config
  supplémentaire nécessaire pour les images de produits)
- **Groupes WhatsApp (Lot F)** — voir section dédiée ci-dessous.
- **Commentaires (Lot I)** — voir section dédiée ci-dessous.

## Groupes WhatsApp (Lot F, consulté sur docs.zernio.com le 31 août 2026)

Trois questions posées explicitement par le cahier Lot F avant d'écrire le
moindre code d'intégration, avec réponse vérifiée sur la documentation
publique (jamais devinée) :

**1. Lister les groupes accessibles depuis le compte connecté : SUPPORTÉ.**
`GET /whatsapp/wa-groups?accountId=...&limit=...&after=...` (curseur de
pagination `paging.cursors.after`). Chaque groupe renvoyé ne contient
QUE `{ id, subject, createdAt }` — **pas de nombre de participants**, ni
de `conversationId`. Non disponible pour un numéro connecté en mode
**Coexistence** (Cloud API + application WhatsApp Business installée sur
le même téléphone) — l'API renvoie une erreur dans ce cas, propagée telle
quelle par `client.ts`/`whatsapp-group-service.ts` plutôt que masquée.

**2. Envoyer un message dans un groupe : PARTIEL — jamais à froid.**
L'envoi passe par l'API Inbox standard, `POST
/inbox/conversations/{conversationId}/messages`, exactement comme pour un
message privé. Mais la documentation est explicite : *"les conversations
de groupe sont créées automatiquement quand un message de groupe est
reçu"* — uniquement REÇU, jamais "envoyé". Contrairement au cold-start 1:1
par numéro de téléphone (`POST /inbox/conversations` avec `participantId`,
confirmé lui aussi mais réservé à un numéro individuel — jamais un
identifiant de groupe), **aucun endpoint documenté ne permet d'obtenir ou
de créer un `conversationId` pour un groupe qui n'a encore jamais envoyé
de message entrant.**

**CONFIRMÉ (Lot M, docs.zernio.com/platforms/whatsapp/groups)** — fait
central qui débloque tout : *"Each group has its own conversation thread
identified by the group ID"* — pour un groupe, `conversationId ===
l'id du groupe lui-même` (`external_id` côté tokoo ). La conversation
Zernio n'existe simplement pas tant que personne n'a écrit dedans, mais
son id est connu D'AVANCE : c'est le même que celui du groupe. Le Lot F
avait laissé `zernio_conversation_id` NULL pour toujours ("hors scope"
explicitement pour la réception de messages de groupe) ; **le Lot M ferme
ce trou** : le webhook `message.received` (générique, déjà confirmé et
câblé) est maintenant écouté pour CE cas précis —
`activateGroupFromInboundConversation` (whatsapp-group-service.ts) matche
le `conversation.id` reçu contre `whatsapp_groups.external_id` de
l'organisation et renseigne `zernio_conversation_id` dès le premier
message reçu du groupe, quel qu'il soit (texte ou média). `createBroadcast`
refuse maintenant explicitement, À LA CRÉATION, toute diffusion vers un
groupe encore NULL sur cette colonne — voir `/dashboard/groups`, qui
distingue "Prêt" de "En attente d'activation" et guide le commerçant
(envoyer un message une fois, depuis son téléphone, dans le groupe).

**3. Webhook dédié aux événements de groupe (nouveaux membres...) : NON
SUPPORTÉ.** La liste complète des événements webhook Zernio (`message.*`,
`reaction.received`, `comment.received`, `review.*`, `lead.received`,
`ad.status_changed`, `whatsapp.template.status_updated`,
`whatsapp.number.*`, `account.connected/disconnected`, `post.*`,
`webhook.test`) ne contient aucun événement de type
adhésion/participants. La gestion des participants (`POST`/`DELETE
/whatsapp/wa-groups/{groupId}/participants`) est pilotée par API, pas
notifiée par webhook — hors scope de ce lot de toute façon (gestion des
participants explicitement exclue par le cahier).

**En résumé (mis à jour Lot M)** : la synchronisation des groupes
(lecture) ET la diffusion sont maintenant une intégration réelle et
complète de bout en bout — modèle de données, quota, UI, cron, ET
activation automatique via le webhook inbox. Plus aucun "TODO" sur ce
point : voir `RAPPORT_LOT_M.md` pour le détail. `RAPPORT_LOT_F.md` reste
la référence historique de pourquoi ce trou existait au départ.

## Boutons « Voir plus » (fusion #17, ex-FUSION_14 de la branche liens-tenant)

Un lien produit affiché en clair peut être remplacé par un bouton. Le support
réel dépend du canal — `OutboundMessage.buttons` est ignoré par les canaux qui
ne le gèrent pas.

| Canal | Bouton | Statut |
|---|---|---|
| Telegram | Oui, plusieurs (un par produit, un par ligne) — `reply_markup.inline_keyboard`, sur tous les types d'envoi, par URL comme par téléversement | CONFIRMÉ (core.telegram.org/bots/api) |
| WhatsApp 1:1 via Zernio | Oui, **un seul** (`interactive.type = "cta_url"`), en fenêtre de session (24 h) | CONFIRMÉ (docs.zernio.com : la forme `interactive` reprend l'objet Cloud API de Meta ; SDK `zernio-dev/chat-sdk-adapter`). **Aucun appelant ne l'utilise aujourd'hui** |
| **Groupes WhatsApp** | **Non — jamais de bouton** | Les messages interactifs sont listés comme NON pris en charge par l'API Groupes (docs 360dialog, guide Unipile, sept. 2026) ; docs.zernio.com ne dit rien de contraire. Un envoi de groupe rejeté ferait échouer toute la diffusion, le lien n'étant plus dans le texte. Les groupes gardent donc leurs liens en texte. **À re-tester avec un vrai groupe avant d'envisager de l'activer.** |

Le stockage des boutons des publications Telegram *programmées* est la colonne
`telegram_publications.buttons` (migration `0065`).

## Publications sociales — synchronisation des résultats (Lot M, Partie 2)

Le Lot H avait laissé `docs/ZERNIO_INTEGRATION.md` avec un point
explicitement "à confirmer" (voir ancienne section "Ce qui reste à
confirmer" ci-dessous, maintenant résolue) : le nom exact du champ
contenant le résultat par plateforme d'une publication. **CONFIRMÉ (Lot
M, docs.zernio.com, pages "Facebook API"/"Threads API" — exemples de
réponse `POST /posts`/`GET /posts/{id}` — et le blog officiel "How we
built an API for AI content tools")** : le champ s'appelle réellement
`platforms` (tableau), **pas** `platformResults` comme le code l'avait
supposé. Forme confirmée par élément :
`{ platform, accountId, status, platformPostId?, platformPostUrl?, error? }`.

**Événements webhook confirmés (docs.zernio.com/webhooks, table
"Available events", recoupé avec le SDK officiel `zernio-php` et
`zernio-dev/n8n-nodes-zernio`)** : `post.scheduled`, `post.published`,
`post.failed`, `post.partial` (publié sur certaines plateformes, échoué
sur d'autres), `post.cancelled`, `post.recycled`, `post.platform.published`,
`post.platform.failed` — les deux derniers au niveau d'UNE plateforme,
les autres au niveau agrégé du post entier.

**ENCORE NON CONFIRMÉ** (voir types.ts pour le détail) : la forme EXACTE
de l'enveloppe webhook `post.*` elle-même (est-ce littéralement
`{ post: {...} }` comme la ressource REST, ou un sous-ensemble de champs à
plat au niveau racine ?). Le blog officiel confirme au minimum que le
payload contient l'id du post, son statut final, et un message d'erreur
en cas d'échec — `mapZernioPostEventToDomainEvent` (mapper.ts) reste
volontairement tolérant à cette incertitude précise (accepte `post._id`,
`post.id`, OU `postId` à la racine) plutôt que de deviner puis planter en
production. **À vérifier avec un vrai payload avant mise en prod**, via la
fonctionnalité "Test webhook" du dashboard Zernio (compte de production
réel, hors de portée de ce lot — voir RAPPORT_LOT_M.md).

**Routage tenant** : contrairement aux événements inbox (`account.id`,
mappé via `provider_connections.metadata.accountId`), un post peut cibler
plusieurs comptes/plateformes à la fois — `account.id` seul n'est donc
pas fiable comme clé de routage pour cette catégorie, et
`getSocialPublishingProvider()` ne stocke aujourd'hui aucun
`profileId`/`accountId` distinctif pour la connexion `social` d'une
organisation. Décision prise plutôt que de deviner un champ non confirmé
du payload : router via `social_posts.provider_post_id` (nos propres
données, déjà organisation-scopées) — voir
`resolveOrganizationIdByProviderPostId` (resolve-organization.ts).

## Commentaires sociaux (Lot I, Partie 3)

Le cahier Lot I demandait de vérifier une capacité de LECTURE et une
capacité de RÉPONSE aux commentaires avant d'écrire le moindre code
d'intégration. **Verdict : les deux sont CONFIRMÉES.**

### CONFIRMÉ

- **Lecture** — `GET /v1/inbox/comments/{postId}?accountId=...` retourne
  `{ comments: [...] }`, chaque commentaire exposant `id`, `message`,
  `from`, `createdTime`, et deux indicateurs calculés par Zernio selon les
  permissions réelles du compte connecté : `canReply`, `canHide`.
- **Réponse** — `POST /v1/inbox/comments/{postId}` avec
  `{ accountId, commentId, message }`.
- **Plateformes supportées (lecture + réponse)** : Facebook, Instagram,
  YouTube, LinkedIn, Threads, X/Twitter, Reddit, Bluesky (8 plateformes,
  page "Social Media Comments API").
- **Masquer/afficher** (capacité additionnelle exploitée en bonus dans ce
  lot, au-delà du strict "lecture + réponse" demandé) — confirmé via les
  SDKs officiels `zernio-php`/`zernio-dotnet` : `POST
  /v1/inbox/comments/{postId}/{commentId}/hide` avec `{ accountId }` pour
  masquer, `DELETE` sur la même URL pour réafficher. **Limité à
  Facebook, Instagram, Threads** (FAQ "Social Media Comments API") — voir
  `social-comment-service.ts::commentHidingSupportedOnPlatform`, qui dérive
  cette limite de la plateforme plutôt que de la stocker en base.

### Limites documentées

- Les réponses de lecture (`GET /v1/inbox/comments/{postId}`) sont mises
  en cache jusqu'à 10 minutes côté Zernio — un pull explicite via cette
  route n'est donc jamais parfaitement temps réel. `syncCommentsForPost`
  reste à ce titre un pull À LA DEMANDE (bouton "Forcer une vérification"
  dans le dashboard), conservé comme filet de rattrapage — voir point
  suivant pour le chemin réellement temps réel, câblé au Lot 5.
- LinkedIn nécessite un compte "organisation" (page d'entreprise) côté
  Zernio — un profil LinkedIn personnel connecté n'expose pas de
  commentaires via cette API (limite de la plateforme LinkedIn elle-même,
  pas de Zernio).
- **INFÉRÉ, non confirmé verbatim** : le placement d'`accountId` en query
  string sur l'appel `DELETE .../hide` (démasquer) — déduit par symétrie
  avec `hide`, faute d'exemple de code officiel pour ce cas précis (voir
  commentaire dans `zernio/client.ts::unhideInboxComment`).
- **CÂBLÉ au Lot 5 (20/09/2026)**, contrairement à la note originale de ce
  paragraphe qui le laissait "non exploité en V1" : le webhook
  `comment.received` (docs.zernio.com/webhooks/inbox, CONFIRMÉ, "Fired
  when a new comment arrived on a tracked post") pousse maintenant les
  commentaires en temps réel vers `/api/webhooks/zernio` — voir
  `zernio/mapper.ts::mapZernioEventToDomainEvent` (case `comment.received`)
  et `social-post-tracking-service.ts::handleIncomingComment`. Combiné
  avec `post.external.created`/`updated`/`deleted` (même page,
  CONFIRMÉ : "Zernio's background sync detected a post authored natively
  on the platform... `post.source` is always "external" and `post.id` is
  the platform-native post id", ~horaire, PAS temps réel) via
  `social-post-tracking-service.ts::trackExternalPost`, ceci couvre
  maintenant aussi les commentaires sur un post publié DIRECTEMENT sur la
  plateforme (hors tokoo ) — jusque-là structurellement impossible
  (`social_comments.social_post_id` référence `social_posts(id)` en NOT
  NULL, et aucune ligne `social_posts` n'existe pour un post non publié
  par tokoo  — voir 0064_external_post_tracking.sql, qui ajoute
  `social_posts.source` et l'index unique permettant cet upsert).
  Limite honnête à communiquer au commerçant : un post fait directement
  sur la plateforme peut mettre jusqu'à ~1h avant d'être "tracké" par
  Zernio (premier passage de la synchro arrière-plan) — ses commentaires
  ne deviennent temps réel qu'APRÈS ce premier passage ; le pull manuel
  reste utile pour ce cas précis en attendant. **NON CONFIRMÉ** : forme
  exacte des champs internes de `comment`/`post` sur le payload webhook
  lui-même (la page consultée ne les énumère pas) — repris par analogie
  avec la ressource `comment` confirmée côté REST
  (`ZernioInboxComment` : id/message/from/createdTime), jamais deviné
  au-delà (voir zernio/types.ts) ; à vérifier avec un vrai payload de
  test ("Test webhook", dashboard Zernio) avant mise en prod, même
  réserve que le reste de ce document. **ACTION REQUISE CÔTÉ ZERNIO,
  PAS CODE** : `comment.received`, `post.external.created`,
  `post.external.updated` et `post.external.deleted` doivent être ajoutés
  aux événements souscrits du webhook de chaque tenant (dashboard Zernio
  — ce projet n'appelle aucune API de gestion des webhooks, vérifié par
  recherche exhaustive).
  `like`/`unlike`, suppression de commentaire, "réponse privée"
  (Facebook/Instagram uniquement) et comment-to-DM existent aussi côté
  Zernio mais ne sont ni demandés par le cahier ni utilisés ici.

## Ce qui reste À CONFIRMER avant la mise en production

- Détail exact des champs internes de `message`/`conversation` dans les
  webhooks inbox (la doc consultée référence des types nommés sans lister
  tous leurs champs en clair) — utiliser la fonctionnalité "Test webhook"
  du dashboard Zernio pour capturer un vrai payload avant d'aller en prod.
- ~~Détail exact du champ `platformResults` dans `GET /posts/{id}`~~ —
  **RÉSOLU (Lot M)** : le champ s'appelle `platforms`, forme confirmée —
  voir section "Publications sociales" ci-dessus.
- **Lot M** : forme EXACTE de l'enveloppe webhook `post.*` (racine plate
  vs `{ post: {...} }`) — voir section "Publications sociales" ci-dessus,
  `mapZernioPostEventToDomainEvent` reste tolérant en attendant.
- Le compte WhatsApp business doit être réellement connecté et vérifié
  côté Zernio (numéro, template messages approuvés si utilisés hors
  fenêtre des 24h).
- Format exact d'`accountId` sur `DELETE .../hide` (voir "INFÉRÉ"
  ci-dessus) — à vérifier contre un compte de test réel avant la mise en
  production de la fonctionnalité "Afficher" (démasquer).

## Où se trouve le code

```
infrastructure/providers/messaging/zernio/   Messaging (WhatsApp inbox + groupes, Lot F)
  types.ts       Formes de données confirmées/inférées, avec commentaires
  client.ts      Appels HTTP bas niveau (+ listWhatsAppGroupsPage/listAllWhatsAppGroups, retry léger 5xx)
  mapper.ts      Zernio -> DomainEvent normalisé (le SEUL endroit qui connaît le format Zernio)
  webhook-handler.ts  Signature + parsing + hash
  adapter.ts     Implémente le port MessagingProvider (+ listWhatsAppGroups)
  resolve-organization.ts  account.id -> organization_id

infrastructure/providers/social/zernio/      Social publishing + commentaires (Lot I)
  types.ts, client.ts, adapter.ts (implémente SocialPublishingProvider,
  méthodes listComments/replyToComment/hideComment/unhideComment ajoutées
  au Lot I sans toucher aux méthodes de publication existantes)

application/services/whatsapp-group-service.ts   Lot F/M — groupes + diffusions + activation (voir en-tête du fichier)
app/dashboard/groups/                            UI (connexion, diffusion, historique, activation — Lot M)
app/api/cron/process-broadcasts/route.ts         Traitement des diffusions dues

application/services/marketing-service.ts        Lot D/M — campagnes + handlePostStatusWebhook (sync des résultats)
app/dashboard/marketing/                         UI (Lot M — statut réel par plateforme)

application/services/social-comment-service.ts appelle
`getSocialPublishingProvider()` (ProviderRegistry) — jamais l'adapter
Zernio directement, même discipline que le reste du projet.
```

## Limitation documentée

`cancelPost` fonctionne réellement (`DELETE /posts/{id}`, confirmé), mais
ne peut annuler qu'un brouillon ou un post programmé — un post déjà publié
ne peut pas être supprimé par cette route (Zernio protège l'historique de
publication, cohérent avec notre propre règle de ne jamais supprimer
l'historique).

**Mis à jour Lot M** — ce n'est plus une limitation ouverte : la diffusion
vers un groupe WhatsApp fraîchement connecté est refusée EXPLICITEMENT à
la création (jamais un échec silencieux) tant qu'aucun message n'a été
reçu de ce groupe, et le commerçant est guidé pour lever ce blocage en une
action (envoyer un message une fois) — voir la section "Groupes WhatsApp"
ci-dessus et `activateGroupFromInboundConversation`. Ce n'était pas un bug
avant Lot M : c'était la limite réelle et documentée de l'API Zernio pour
ce cas d'usage précis ; le Lot M construit la solution côté application
que cette limite appelait, plutôt que de la contourner par une simulation.

## Messagerie WhatsApp ≠ Groupes WhatsApp (à lire avant de toucher au webhook)

Trois choses différentes portent le nom « WhatsApp » dans tokoo . Ne jamais les confondre :

| | **Messagerie WhatsApp** | **Groupes WhatsApp** | **Bouton WhatsApp de la vitrine** |
|---|---|---|---|
| À quoi ça sert | Répondre à des clients en tête-à-tête (boîte de réception, réponses automatiques, CRM) | Diffuser des sélections de produits dans des groupes | Un lien `wa.me` (clic pour discuter) vers le numéro du commerçant |
| Numéro | Numéros de messagerie (Coexistence ou dédiés), plusieurs possibles | **Un numéro DÉDIÉ, différent de la messagerie** (Cloud API, jamais Coexistence) | Le numéro affiché sur la vitrine |
| Compte Zernio | `whatsapp_accounts` (+ `provider_connections` type `messaging` pour le premier numéro) | `provider_connections` type **`whatsapp_groups`**, profil Zernio à part | Aucun (pas d'API) |
| Tables | `conversations`, `contacts`, `messages` | `whatsapp_groups`, `group_broadcasts` | — |
| Quota d'offre | `whatsapp` (nombre de numéros) | `whatsapp_groups` (nombre de groupes) | — |
| Envoi | `getMessagingProvider(org, "zernio", accountId)` | `getWhatsAppGroupsProvider(org)` + `zernioConversationId` du groupe | — |
| Diffusion | « Diffusions aux contacts » (`contact-broadcast-service.ts`, fenêtre 24 h Meta, STOP) | « Groupes WhatsApp » (`whatsapp-group-service.ts`, jamais de bouton) | — |

**Webhook `message.received`** (`app/api/webhooks/zernio/route.ts`) — c'est ici que les deux se rencontrent, car le canal s'appelle « whatsapp » dans les deux cas :

1. Le compte qui a reçu l'événement est résolu **avant tout**. `resolveOrganizationIdByZernioAccount` couvre les numéros de messagerie (tous ceux de `whatsapp_accounts`, pas seulement le premier) ; `resolveOrganizationIdByWhatsAppGroupsAccount` couvre le numéro dédié aux groupes.
2. **Numéro de groupes** → le groupe est activé (`activateGroupFromInboundConversation` : la conversation d'un groupe a pour identifiant celui du groupe), puis **l'événement s'arrête là** : ni contact, ni conversation, ni réponse automatique (l'IA répondrait à tout le groupe), ni alerte « message sans réponse ».
3. **Numéro de messagerie** → pipeline client normal. Défense en profondeur : si l'identifiant du fil est celui d'un groupe connu (`whatsapp-group-threads.ts`), il est ignoré.
4. Les **diffusions vers des contacts** excluent les fils de groupe, à la création de la campagne **et** à l'envoi.

Vérifier après un déploiement : `supabase/CHECK_WHATSAPP_GROUPS_VS_MESSAGING.sql`.
