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
l'id du groupe lui-même` (`external_id` côté SME-OS). La conversation
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

- Les réponses de lecture sont mises en cache jusqu'à 10 minutes côté
  Zernio — ce n'est **pas un flux temps réel**. `syncCommentsForPost` est
  donc un pull explicite (bouton "Vérifier les commentaires" dans le
  dashboard), jamais un polling automatique en tâche de fond.
- LinkedIn nécessite un compte "organisation" (page d'entreprise) côté
  Zernio — un profil LinkedIn personnel connecté n'expose pas de
  commentaires via cette API (limite de la plateforme LinkedIn elle-même,
  pas de Zernio).
- **INFÉRÉ, non confirmé verbatim** : le placement d'`accountId` en query
  string sur l'appel `DELETE .../hide` (démasquer) — déduit par symétrie
  avec `hide`, faute d'exemple de code officiel pour ce cas précis (voir
  commentaire dans `zernio/client.ts::unhideInboxComment`).
- **Non exploité en V1** (existe, documenté, mais volontairement hors
  périmètre du cahier Lot I qui ne demandait que lecture + réponse) : le
  webhook `comment.received` permettrait une synchronisation temps réel
  au lieu du pull actuel — piste V2 si le besoin réel se confirme, pas
  construit préventivement (section 62 : ne pas sur-engineer).
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
