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
de message entrant.** Conséquence assumée dans le code : `whatsapp_groups`
a une colonne `zernio_conversation_id`, nullable, qui reste NULL pour tout
groupe connecté par ce lot — et toute diffusion vers un tel groupe échoue
explicitement (`group_broadcast_targets.status = 'failed'` avec un message
clair) plutôt que de simuler un envoi qui n'a jamais eu lieu. Combler ce
manque demanderait de construire la RÉCEPTION de messages de groupe
(webhook `message.received`, déjà générique et confirmé — "les messages
de groupe de tous les participants apparaissent dans l'Inbox") — **explicitement
hors scope du cahier Lot F** ("réception de messages/réponses DANS un
groupe" est listé dans sa section "Hors scope").

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

**En résumé** : la synchronisation des groupes (lecture) est une
intégration réelle et complète. La diffusion, elle, est honnêtement
câblée de bout en bout (modèle de données, quota, UI, cron) mais ne
pourra réellement délivrer un message tant qu'un lot futur ne branche pas
la réception des messages de groupe pour peupler `zernio_conversation_id`
— voir `RAPPORT_LOT_F.md` pour le détail des décisions prises.

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
- Détail exact du champ `platformResults` dans `GET /posts/{id}`.
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

application/services/whatsapp-group-service.ts   Lot F — groupes + diffusions (voir en-tête du fichier)
app/dashboard/groups/                            UI (connexion, diffusion, historique)
app/api/cron/process-broadcasts/route.ts         Traitement des diffusions dues

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

La diffusion vers un groupe WhatsApp fraîchement connecté échouera
toujours (`group_broadcast_targets.status = 'failed'`) tant qu'aucun
message n'a été reçu de ce groupe — voir la section "Groupes WhatsApp"
ci-dessus. Ce n'est pas un bug : c'est la limite réelle et documentée de
l'API Zernio pour ce cas d'usage précis, pas une supposition de notre
part.
