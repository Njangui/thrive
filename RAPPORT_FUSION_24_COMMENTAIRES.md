# Rapport #24 — synchronisation des commentaires : automatique + notifications push/in-app

Fait suite à `RAPPORT_FUSION_23_WHATSAPP.md`. Date : 21 septembre 2026.

**Demande** : vérifier que la synchronisation des commentaires est automatique et déclenche bien une notification push **et** in-app.

## 1. Ce qui existait déjà — vérifié conforme

Le mécanisme demandé est bien construit, avec une réserve honnête déjà documentée :

- **Automatique et en temps réel**, pour les posts publiés via flexco  **et** ceux publiés directement sur la plateforme (Facebook/Instagram) — pas seulement au clic sur un bouton. Le webhook Zernio `comment.received` déclenche `handleIncomingComment` (`social-post-tracking-service.ts`) dès qu'un commentaire arrive sur un post « tracké ».
- **Réserve déjà documentée dans le code** : un post publié directement sur la plateforme (hors flexco ) peut mettre jusqu'à ~1 h avant d'être « tracké » par la synchronisation d'arrière-plan de Zernio ; ses commentaires ne deviennent temps réel qu'après ce premier passage. Le bouton manuel « Vérifier une publication » reste affiché exprès pour ce cas, jamais retiré.
- **Les deux canaux de notification partent bien ensemble**, à chaque nouveau commentaire (`notifyOrgAdmins`, appelée sans préciser de priorité → défaut **« important »**, donc un push en urgence « high », pas un push muet) :
  - **in-app** : une ligne insérée dans `notifications` pour chaque owner/admin ;
  - **push** : un vrai envoi Web Push (`web-push`, clés VAPID), best-effort — jamais d'exception si un tenant n'a pas configuré les clés ou si aucun appareil n'est abonné.
- **Pas de doublon** : un commentaire déjà connu (webhook relivré, ou déjà récupéré par le bouton manuel entre-temps) n'est ni réinséré ni renotifié (`ignoreDuplicates: true`).

## 2. Défaut trouvé — corrigé

**Le commerçant était notifié de ses propres commentaires**, sans que rien ne le filtre. Chaque fois qu'il répond à un commentaire — directement sur Instagram/Facebook, ou via le bouton « Répondre » de flexco  lui-même (`replyToComment`, qui poste réellement sur la plateforme via l'API) — Zernio relivre cette réponse comme un `comment.received` ordinaire. Une détection « c'est mon propre commentaire » (`isOwnComment`) existe déjà dans le projet, mais **seulement pour la réponse automatique par IA**, avec deux angles morts :

1. `isOwnComment` n'était jamais appelée si la réponse automatique était désactivée pour ce compte (le test s'arrêtait avant, sur `account.autoReplyComments`).
2. Même quand elle s'exécutait, c'était **après** que `handleIncomingComment` ait déjà notifié — le mal était fait.

Conséquence concrète : à chaque réponse du commerçant, un push + une notification in-app « Nouveau commentaire reçu : [Nom de la boutique] a commenté… », et le commentaire restait affiché comme « Nouveau » dans sa propre boîte de réception `/dashboard/comments` — pour toujours, puisque personne n'allait jamais « répondre » à sa propre réponse.

**Corrigé** dans `social-post-tracking-service.ts::handleIncomingComment` :
- la détection tourne maintenant systématiquement, avant toute notification, indépendamment de la réponse automatique ;
- le commentaire du commerçant est stocké quand même (`is_own = true`, pour garder l'historique du fil cohérent), mais **aucune notification n'est envoyée** ;
- en cas d'échec de résolution du compte (base indisponible), le choix par défaut est de **notifier quand même** — mieux vaut un faux positif occasionnel que de risquer de faire taire un vrai client.

Et dans `social-comment-service.ts::listComments` : les commentaires `is_own = true` sont désormais exclus de la boîte de réception du commerçant (`/dashboard/comments`), pour la même raison — ils ne demandent aucune action et n'auraient jamais quitté la colonne « Nouveaux ».

## 3. Trou de test comblé

**`social-post-tracking-service.ts` — le module qui porte tout ce mécanisme — n'avait strictement aucun test.** Une régression du câblage (l'appel à `notifyOrgAdmins` disparaissant, ou mal branché) serait passée inaperçue par toute la suite existante. 13 tests ajoutés (`social-post-tracking-service.test.ts`) : nouveau commentaire → stocké puis notifié ; texte du corps avec et sans nom d'auteur ; troncature à 120 caractères ; post non-trackable → aucune notification ; commentaire dupliqué → jamais notifié deux fois ; échec d'écriture → pas d'exception ; **commentaire du commerçant → stocké mais jamais notifié** ; échec de résolution du compte → notifie quand même (repli sûr) ; échec de `notifyOrgAdmins` lui-même → n'est jamais propagé ; suivi d'un post externe (création, idempotence, `deleted` jamais destructeur, course concurrente 23505). Plus 2 tests sur `listComments` (le filtre `is_own`, et la propagation d'une erreur de lecture) — cette fonction n'était pas non plus testée jusqu'ici.

**Contrôle de mutation** : en retirant chacun des trois correctifs un par un (le filtre `is_own` de `listComments`, la vérification `isOwn` avant notification, l'appel à `notifyOrgAdmins` lui-même), les tests dédiés échouent à chaque fois (1, puis 4, puis 2 échecs selon le cas) ; ils repassent tous après restauration.

## 4. Vérification

| Contrôle | Résultat |
|---|---|
| `typecheck` | 0 erreur |
| `lint` | 0 alerte |
| `npm test` | **985 réussis / 0 échoué** (91 fichiers) : 970 (fusion #23) + 15 |
| `npm run build` (Next 16.3.5) | OK, 85/85 pages |

Build : copie jetable, polices stubées, identifiants Supabase factices — même méthode que les rapports précédents.

## 5. Ce qui n'a pas pu être vérifié ici

- **Aucun vrai payload Zernio.** La détection « propre commentaire » repose sur `authorExternalId` (identifiant exact) ou, à défaut, le nom d'auteur comparé au nom du compte connecté — ce second repli peut se tromper si un client porte exactement le même nom que la boutique (cas rare, déjà la même limite pour la réponse automatique).
- **Réglage des clés VAPID et abonnement effectif d'un appareil** : le canal push est vérifié unitairement (`push-service.test.ts`, déjà existant) mais pas de bout en bout sur un vrai navigateur.
- **Le délai ~1 h pour un post jamais publié via flexco ** est une limite de Zernio, pas du code : rien à corriger ici, seulement à garder en tête.
- Les points ouverts des rapports précédents restent valables (Fapshi en sandbox, licence des images, revue visuelle, groupes WhatsApp jamais activés avant d'y envoyer un premier message).

Livré en zip du projet complet (`node_modules`, `.next` et `tsconfig.tsbuildinfo` exclus). Reproduire : `npm ci && npm run typecheck && npm run lint && npm test && npm run build`.

## Annexe — fichiers touchés par rapport à la livraison précédente (#23)

### Ajoutés (2)

- `RAPPORT_FUSION_24_COMMENTAIRES.md`
- `src/application/services/social-post-tracking-service.test.ts`

### Modifiés (3)

- `src/application/services/social-comment-service.test.ts`
- `src/application/services/social-comment-service.ts`
- `src/application/services/social-post-tracking-service.ts`

### Supprimés (0)

_aucun_
