# Rapport — Lot 5 : commentaires temps réel + audit "IA / réponse automatique"

## ⚠️ Avertissement d'environnement (à lire avant tout le reste)

Même limite que RAPPORT_LOT_4.md : **session sans accès réseau et sans
`node_modules`** (npm install impossible). `npm run typecheck` / `lint` /
`test` / `build` **n'ont PAS tourné**. À la place : relecture manuelle
exhaustive de chaque fichier touché + vérification automatisée de
l'équilibre accolades/parenthèses/crochets par script sur les 13 fichiers
listés en section 5 — aucun déséquilibre trouvé, mais **ceci ne remplace
pas un vrai `npm run typecheck && npm run lint && npm test && npm run
build` avant mise en production.**

Toutes les hypothèses non vérifiables autrement que par un vrai payload
Zernio ("Test webhook" du dashboard) sont marquées **NON CONFIRMÉ** dans
le code et ci-dessous — même discipline que le reste du projet.

---

## 1. Demande initiale et diagnostic

Deux signalements distincts :

1. Un commentaire Facebook publié par l'utilisateur n'apparaissait pas
   dans l'outil.
2. La "réponse automatique" IA ne fonctionnait pas.

**Diagnostic (déjà transmis en cours de conversation, rappelé ici) :**

- Les commentaires n'étaient synchronisés que par un **pull manuel**
  (bouton), jamais en temps réel, et **uniquement pour un post publié
  via le composer flexco ** — un post publié directement sur Facebook
  n'avait structurellement aucun moyen d'être suivi (`social_comments.
  social_post_id` référence `social_posts(id)` en NOT NULL, et aucune
  ligne `social_posts` n'existe pour un post que flexco  n'a pas publié
  lui-même).
- La "réponse automatique" aux commentaires est, par design, une
  suggestion IA qu'un humain doit valider et envoyer — jamais un envoi
  automatique (le code est explicite là-dessus). Le vrai bug technique,
  lui, était ailleurs : le solde de crédits IA des deux tenants de test
  (Habynex, Digital market) était resté bloqué à 0 après l'upgrade SQL
  vers Pro, faisant échouer `draftCommentReplySuggestion` silencieusement.
- En creusant CE bug de crédits jusqu'à sa racine, il s'est avéré
  **structurel, pas spécifique au SQL manuel** : voir section 3.

L'utilisateur a ensuite demandé explicitement : synchroniser les
commentaires **quel que soit l'endroit où le post a été publié, et
automatiquement**, et vérifier en profondeur tout ce qui touche à l'IA
et à la réponse automatique sur l'ensemble du SaaS.

---

## 2. Partie 1 — Synchronisation temps réel des commentaires

### Ce qui existe réellement côté Zernio (vérifié sur docs.zernio.com le 20/09/2026)

- `comment.received` : événement temps réel, "on a **tracked** post" —
  CONFIRMÉ, existait déjà dans `types.ts` comme valeur d'union mais
  n'était jamais mappé ni géré (TODO explicite laissé par un lot
  précédent : "un webhook temps réel dédié reste à construire").
- `post.external.created` / `updated` / `deleted` : synchronisation
  arrière-plan Zernio (**~horaire, PAS temps réel**) qui détecte tout
  post publié **nativement sur la plateforme, hors Zernio** — `post.id`
  y est CONFIRMÉ comme étant l'id natif plateforme, `post.source ===
  "external"`. C'est ce qui rend un post "tracké" et débloque
  `comment.received` pour lui.
- Ces deux briques combinées couvrent donc bien la demande "quel que
  soit l'endroit où j'ai publié" — avec une limite honnête : **jusqu'à
  ~1h de délai la première fois qu'un post fait directement sur la
  plateforme est détecté**, après quoi ses commentaires deviennent
  temps réel. Communiquée à l'utilisateur et dans l'UI (`/dashboard/
  comments`).

### Ce qui a été construit

- **`0064_external_post_tracking.sql`** — ajoute `social_posts.source`
  (`'app'` | `'external'`) et un index unique partiel
  `(organization_id, provider_post_id) where provider_post_id is not
  null`, nécessaire pour un upsert idempotent.
- **`zernio/types.ts`** — payload `comment.received` (objet `comment` +
  référence `post`, repris par analogie avec la ressource REST déjà
  confirmée `ZernioInboxComment`) et payload `post.external.*`
  (`ZernioExternalPostWebhookPost`, seuls `id`/`source`/`platform` sont
  exploités — le texte/media du post externe ne sont PAS rapatriés, noms
  de champs non confirmés au niveau webhook). Ajout de `isZernioExternalPostEvent`,
  correction de `isZernioPostEvent` pour exclure `post.external.*`.
- **`zernio/mapper.ts`** — nouveau cas `comment.received` →
  `COMMENT_RECEIVED`, nouvelle fonction `mapZernioExternalPostEventToDomainEvent`
  → `EXTERNAL_POST_TRACKED`.
- **`domain-events.ts`** — deux nouveaux types d'événement.
- **`resolve-organization.ts`** — **point important trouvé en cours de
  développement** : le routage tenant pour ces deux événements ne peut
  PAS se faire par `account.id` comme pour `message.received`. En
  lisant `zernio-channel-service.ts` avant d'écrire quoi que ce soit
  (jamais deviné) : la ligne `provider_connections` d'un tenant pour
  `provider_type = 'social'` est **unique**, et son `metadata.accountId`
  est **réécrit à chaque nouvelle connexion** (Facebook, puis Instagram,
  puis LinkedIn...) — un tenant avec plusieurs comptes sociaux connectés
  n'a donc qu'un seul `accountId` "survivant" à un instant donné. Router
  par `account.id` y aurait résolu **silencieusement le mauvais tenant**
  dès qu'un deuxième compte social est connecté quelque part sur la
  plateforme — pire qu'un événement perdu. Corrigé en routant par
  `account.profileId` à la place (CONFIRMÉ présent sur le payload,
  stable, jamais réécrit avec une autre valeur) via la nouvelle fonction
  `resolveOrganizationIdBySocialProfile`. Aucun repli sur `account.id` :
  un `profileId` absent reste non résolu plutôt que deviné.
- **`social-post-tracking-service.ts`** (nouveau) — `trackExternalPost`
  (consomme `EXTERNAL_POST_TRACKED`) et `handleIncomingComment`
  (consomme `COMMENT_RECEIVED`), toutes deux appuyées sur
  `ensureTrackedPost`, qui ne devine jamais une plateforme manquante
  (abandon proprement loggé plutôt que d'écrire une valeur inventée dans
  une colonne NOT NULL). `handleIncomingComment` notifie les admins
  (`notifyOrgAdmins`, nouveau type `relatedEntityType: "social_comment"`
  → `/dashboard/comments` dans `notification-service.ts`).
- **`app/api/webhooks/zernio/route.ts`** — câble tout ça : nouvelle
  branche `isZernioExternalPostEvent`, nouveau cas `COMMENT_RECEIVED`,
  résolution tenant par profil pour ces deux catégories.
- **`/dashboard/comments`** — copie mise à jour (le bouton manuel devient
  un filet de rattrapage explicite, plus le seul chemin).
- **`docs/ZERNIO_INTEGRATION.md`** — section commentaires mise à jour
  pour refléter ce qui est désormais câblé vs ce qui reste NON CONFIRMÉ.

### Action requise côté toi — PAS du code

Ce projet n'appelle aucune API de gestion des webhooks Zernio (vérifié
par recherche exhaustive) : les événements souscrits se gèrent depuis le
**dashboard Zernio**. Il faut y ajouter, sur le webhook déjà configuré
pour `message.received` etc. :
- `comment.received`
- `post.external.created`
- `post.external.updated`
- `post.external.deleted`

Sans ça, le code livré ne recevra jamais ces événements.

---

## 3. Partie 2 — Bug réel : le plafond de crédits IA ne suit jamais un changement de palier

`ai_credit_balances` est un **snapshot** posé une seule fois par
`initializeCreditBalance` (`ignoreDuplicates: true` — n'écrase jamais une
ligne existante). Recherche exhaustive : **aucune fonction du projet ne
rafraîchissait `included_credits` sur un changement RÉEL de palier** —
y compris `markPaymentCompleted` (`subscription-payment-service.ts`,
cas `plan_subscription`), le vrai parcours de paiement NotchPay. Un
client qui upgrade Discover → Pro voit son `plan_key` changer, mais
garde le plafond de crédits IA de son ancien palier **indéfiniment**,
jusqu'à intervention manuelle en base. Symptôme : suggestion de réponse
IA aux commentaires (et toute autre fonctionnalité IA) qui échoue
silencieusement, sans message d'erreur à l'écran.

**Corrigé :**
- `ai-credits-service.ts::resetCreditBalanceForPlan(organizationId,
  planKey)` — écrase volontairement le solde existant (nouveau cycle de
  facturation = nouveau quota, `used_credits` repart à 0).
- `subscription-payment-service.ts::markPaymentCompleted` — l'appelle
  juste après la confirmation de l'abonnement, en best-effort (un échec
  ici n'affecte jamais la confirmation du paiement déjà actée, même
  principe que `recordAffiliateConversion`).

**Trouvé mais PAS corrigé** (portée plus large, plus risqué sans tests
réels) : `plans-repository.ts::switchToFreePlan` (downgrade manuel vers
le plan gratuit) a le même défaut, en sens inverse — un client qui
repasse en gratuit garde son ancien plafond de crédits. Impact moindre
(fuite de crédits, pas de fonctionnalité cassée) mais même cause
racine — même correctif à appliquer au bon endroit (attention : import
circulaire à éviter, `plans-repository.ts` est déjà importé PAR
`ai-credits-service.ts`, pas l'inverse — le correctif doit vivre côté
appelant de `switchToFreePlan`, pas dans `plans-repository.ts` lui-même).

**À faire côté toi pour les clients déjà affectés** (si vous avez déjà
de vrais clients payants qui ont upgradé) : identifier les organisations
dont `ai_credit_balances.included_credits` ne correspond plus à
`plan_entitlements` pour leur `plan_key` actuel, et les corriger
manuellement — je peux préparer cette requête si utile.

---

## 4. Partie 3 — Audit "IA / réponse automatique" sur l'ensemble du SaaS

| Canal | Comportement réel | Automatique ? |
|---|---|---|
| WhatsApp / Messenger (DM) | `conversation-orchestrator.ts` → `generateAIReply` → envoi immédiat via `messaging.sendMessage`, webhook `message.received` | **Oui, réellement automatique** (sauf escalade humaine explicite) |
| Commentaires sociaux | Suggestion IA affichée, envoi = clic humain sur "Envoyer" (`social-comment-service.ts`, commentaire explicite : "jamais envoyé automatiquement") | **Non — semi-automatique par design**, jamais changé dans ce lot |

**Écart marketing/réalité** : `application/config/pricing.ts` vend
"Réponse automatique aux commentaires Facebook" sur `/tarifs` — la
réalité livrée est une suggestion, pas un envoi automatique. Pas corrigé
(décision produit, pas un bug technique) — à trancher côté équipe :
corriger la page tarifs, ou construire un vrai mode auto-envoi (risque
plus élevé : une IA qui répond sans validation humaine à un commentaire
public est un choix produit qui mérite sa propre discussion, pas un
changement silencieux).

**Entitlements déclarés mais jamais appliqués** (recherche exhaustive,
`grep` sur tout `src/`) : `facebook_auto_comments`, `instagram_auto_comments`,
`automatic_messaging`, `semi_automatic_messaging` existent dans
`KNOWN_ENTITLEMENT_KEYS` (`plans-repository.ts`) — donc éditables depuis
`/admin/plans` — mais **aucun appel à `canUseFeature()` ne les vérifie
nulle part**. Conséquence concrète : la distinction "messagerie
semi-automatique vs automatique" annoncée entre paliers n'existe pas
dans le comportement réel (l'auto-réponse WhatsApp est soit pleinement
active soit bloquée par épuisement de crédits IA — jamais "semi-auto").
Pas corrigé dans ce lot (portée produit à clarifier avant d'implémenter
un vrai mode semi-automatique).

### Trouvé en cours de route, PAS corrigé : routage multi-numéros WhatsApp

En vérifiant le mécanisme de routage tenant pour construire la partie
commentaires (section 2), le même type de problème a été repéré côté
messagerie : `resolveOrganizationIdByZernioAccount` (utilisé pour
**tout** `message.received`, donc pour l'auto-réponse WhatsApp) ne lit
que la ligne unique `provider_connections` (`provider_type =
'messaging'`), qui ne reflète que le numéro **principal**
(`persistZernioOAuthConnection` : `if (isPrimary) { upsert
provider_connections }` — les numéros secondaires vivent uniquement
dans `whatsapp_accounts`, jamais recoupés par le resolver). Recherche
exhaustive : aucun fichier de résolution de webhook ne lit
`whatsapp_accounts`. **Risque concret : un message reçu sur un numéro
WhatsApp secondaire pourrait ne jamais être routé vers le bon tenant,
donc jamais de réponse automatique pour ce numéro.**

Pas corrigé ici : ça touche le cœur du pipeline de messagerie (le flux
le plus critique du produit), avec un rayon d'impact plus large que ce
lot, et je n'ai pas pu le tester contre un vrai payload. Recommandation :
vérifier en priorité si un lot dédié au multi-numéros (le zip
`whatsapp-multi-numbers` que tu as fourni) a déjà traité ce point sous
un autre angle avant de considérer que c'est un vrai bug en prod — sinon
ça mérite son propre lot, avec le même soin de vérification que
`resolveOrganizationIdBySocialProfile` ci-dessus (probablement router
aussi par `profileId` plutôt que `account.id` seul, ou faire retomber la
résolution sur `whatsapp_accounts.account_id` en repli).

---

## 5. Fichiers touchés

**Nouveaux :**
- `supabase/migrations/0064_external_post_tracking.sql`
- `src/application/services/social-post-tracking-service.ts`
- `RAPPORT_LOT_5.md` (ce fichier)

**Modifiés :**
- `src/infrastructure/providers/messaging/zernio/types.ts`
- `src/infrastructure/providers/messaging/zernio/mapper.ts`
- `src/infrastructure/providers/messaging/zernio/resolve-organization.ts`
- `src/domain/events/domain-events.ts`
- `src/app/api/webhooks/zernio/route.ts`
- `src/application/services/notification-service.ts`
- `src/application/services/ai-credits-service.ts`
- `src/application/services/subscription-payment-service.ts`
- `src/app/dashboard/comments/page.tsx`
- `docs/ZERNIO_INTEGRATION.md`
- `src/app/tarifs/page.tsx` (correctif ESLint apostrophes, session précédente)

## 6. À faire avant mise en production

1. Appliquer la migration `0064_external_post_tracking.sql`.
2. Ajouter les 4 événements listés en section 2 au webhook Zernio (dashboard).
3. `npm ci && npm run typecheck && npm run lint && npm test && npm run build` réels — rien de tout ça n'a pu tourner ici.
4. Tester "Test webhook" (dashboard Zernio) sur `comment.received` et `post.external.created` pour confirmer la forme exacte du payload (voir marqueurs NON CONFIRMÉ dans `zernio/types.ts`) avant de faire confiance à la production.
5. Décider de la position produit sur "réponse automatique aux commentaires" (page tarifs vs comportement réel).
6. Statuer sur le point multi-numéros WhatsApp (section 4).
