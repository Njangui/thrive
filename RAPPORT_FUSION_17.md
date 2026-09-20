# Rapport de fusion #17 — branche « Lot 5 / multi-numéros » + branche « liens tenant / boutons »

Fait suite à `RAPPORT_FUSION_16.md` et `RAPPORT_LOT_5.md`.

## 1. Sources reçues et leur relation

| Archive | Contenu | Relation |
|---|---|---|
| `Cresyva-CRESYVA-whatsapp-multi-numbers-v7.zip` (**A**) | Projet complet, migrations jusqu'à `0063` | Sous-ensemble strict de B |
| `files__20_.zip` → `thrive-main-lot5-commentaires-temps-reel.zip` + `RAPPORT_LOT_5.md` (**B**) | Projet complet, migrations jusqu'à `0064` | **= A + exactement les 14 fichiers du lot 5** (11 modifiés, 3 nouveaux — vérifié par `diff -r`, conforme au rapport du lot 5) |
| `cresyva-fusionne_1_.zip` (**C**) | Projet complet, migrations jusqu'à `0056` | **Branche parallèle** : issue de la fusion #13 comme B, mais avec son propre « #14 » (liens tenant + boutons) |

A n'apporte donc rien que B n'ait déjà : la fusion réelle est **B + C**.
Les deux branches partagent l'ancêtre (fusion #13, `cresyva-fusionne.zip`), non fourni.
Les deux portaient un `RAPPORT_FUSION_14.md` **différent** (Catalogue V2 côté B ;
liens tenant + boutons côté C) — celui de C est conservé sous
`RAPPORT_FUSION_14b_LIENS_TENANT_BOUTONS.md`.

## 2. Méthode

- **Base = B** (branche la plus avancée : Catalogue V2, vidéos, analytics landing, freemium,
  coexistence WhatsApp, multi-numéros, lot 5). C n'a rien de ceci.
- **Isoler ce que C a réellement changé** sans l'ancêtre : les dates de modification des
  fichiers de l'archive C. 482 fichiers portent la date de l'ancêtre ; ceux modifiés entre
  le 19/09 10:18 et le 20/09 01:49 sont le chantier propre de C. Même méthode que
  `RAPPORT_FUSION_14.md` (B).
- Sur ~130 fichiers où C « diffère » de B, **la quasi-totalité sont des lignes d'ancêtre que B
  a réécrites** (renommage SME-OS → CRESYVA, suivi de pages déplacé côté navigateur, FAQ
  freemium, UI multi-numéros…). Vérifié sur les cas ambigus : rien à reprendre.
- Les ~24 fichiers réellement touchés par C ont été traités **un par un**, jamais de `cp` en
  masse (sauf `resolve-request-tenant.ts`, où B ⊂ C : C n'ajoute que 50 lignes).
- Chaque remplacement est fait par ancre exacte qui **échoue** si elle n'est pas trouvée
  une seule fois.

## 3. Repris de C

1. **Liens produit sur le domaine RÉEL du tenant** — `getTenantPublicOrigin()` remplace
   `env.NEXT_PUBLIC_APP_URL` dans `conversation-orchestrator.ts`, `marketing-service.ts`,
   `whatsapp-group-service.ts`, `omnichannel-publication-service.ts`. B avait encore le bug
   dans ces 4 fichiers (un lien produit partagé pointait vers le domaine générique de la
   plateforme → 404). Il ne reste plus aucun `NEXT_PUBLIC_APP_URL}/produits` dans `src/`.
2. **Boutons « Voir plus » Telegram** — `OutboundMessage.buttons`, `reply_markup` sur tous
   les envois, `buildProductButtons` (`catalog-service.ts`), colonne
   `telegram_publications.buttons`, plomberie complète dans `telegram-publication-service.ts`
   (publication immédiate, échec, programmée, cron).
3. **Capacité `cta_url` WhatsApp 1:1** dans `ZernioAdapter` (un seul bouton, sinon repli texte).
4. **Bug `externalThreadId`** des envois immédiats vers un groupe WhatsApp
   (`ConnectedGroup.zernioConversationId`). Confirmé dans le code de B : la diffusion
   programmée (`whatsapp-group-service.ts`) utilisait déjà `zernio_conversation_id`, seul le
   chemin immédiat de `omnichannel-publication-service.ts` passait `externalId`.
5. **Domaine racine** `scholarmach.com` dans `.env.example` (exemple) et `VAPID_SUBJECT`
   (`env.ts` + `.env.example`) — voir décision 5.
6. Tests de C : `resolve-request-tenant.test.ts`, `zernio/adapter.test.ts`, bloc
   `buildProductButtons`, mocks du domaine tenant dans les tests de l'orchestrateur et des
   groupes.

## 4. Décisions non triviales

### 4.1 Migration `0056_telegram_publications_buttons` → `0065`
`0056` est déjà pris par `0056_service_images_and_specifications.sql` (B). Même schéma que les
collisions `0016`/`0038`/`0055`. Le dernier numéro de B étant `0064`, la migration devient
**`0065`**, et est rendue **idempotente** (`add column if not exists`) : si l'ancienne `0056`
de C a déjà été jouée quelque part, rejouer `0065` est sans effet.

⚠️ **`0065` doit être appliquée AVANT le déploiement.** Le code écrit toujours `buttons`
dans `telegram_publications` : sans la colonne, **toute** publication Telegram échoue, même
sans bouton. `supabase/CHECK_MIGRATIONS_0062_0065.sql` (lecture seule, nouveau) dit lesquelles
de `0062`→`0065` manquent.

### 4.2 Bouton CTA : NON envoyé vers les groupes WhatsApp (divergence volontaire avec C)
C envoyait le bouton `cta_url` aussi vers les groupes, en retirant le lien du texte.
Vérification faite à la fusion (recherche web, 20/09/2026) :
- la documentation de l'API Groupes (**360dialog**, guide **Unipile**) liste explicitement les
  *messages interactifs* comme **non pris en charge** ; la doc Meta ne cite que texte, médias
  et templates textuels ;
- docs.zernio.com confirme `cta_url` **pour les conversations 1:1 en session** (« requires a
  recent inbound message ») et ne dit rien pour les groupes.

Or les groupes de B utilisent un numéro « connecté en Cloud API uniquement ». Envoyer un
interactif à un groupe serait très probablement rejeté, et **comme le lien n'est plus dans le
texte, toute la diffusion échouerait** — une régression par rapport à B, dont l'envoi texte
fonctionne. Les groupes gardent donc leurs liens **en texte** (avec le bon domaine tenant).
La capacité reste dans l'adaptateur pour le 1:1 (aucun appelant aujourd'hui), documentée dans
`OutboundMessage.buttons`, `ZernioInteractiveCtaUrl` et `docs/ZERNIO_INTEGRATION.md`.
**À re-tester avec un vrai groupe avant d'envisager de l'activer.** Deux tests le verrouillent.

### 4.3 Boutons Telegram aussi sur le chemin « téléversement » (ajout de cette fusion)
B envoie désormais vidéos/audios/fichiers Telegram **par téléversement** (`uploadBinary`,
`sendFileUpload`, multipart), et `sendVoice`. C n'avait ajouté `reply_markup` que sur l'envoi
par URL. Un simple greffage aurait produit, pour une publication catalogue **avec vidéo**, un
message **sans bouton et sans lien** (C retire le lien du texte quand un bouton existe).
Corrigé : `sendFileUpload(..., replyMarkup?)` sérialise `reply_markup` en JSON (forme attendue
en multipart) ; le bouton passe sur toutes les branches, `sendVoice` compris. Test dédié.

### 4.4 Commentaire périmé de C corrigé
Le commentaire de `OutboundMessage.buttons` chez C disait « ni WhatsApp/Zernio… », alors que le
rapport de C corrigeait ensuite ce point (WhatsApp supporte `cta_url`). Réécrit pour refléter
l'état réel, par canal.

### 4.5 `scholarmach.com` (à valider)
Le rapport de C indique que ce domaine racine a été « confirmé par Vox ». Repris dans 2 lignes
qui ne s'exécutent qu'en l'absence de variable d'environnement (`VAPID_SUBJECT` par défaut,
exemple de `.env.example`). La marque **CRESYVA** de B est conservée partout ailleurs
(`EMAIL_FROM_ADDRESS`, titre du fichier : C avait encore « SME-OS »). **Si `scholarmach.com`
n'est pas le bon domaine, ce sont 2 lignes à remettre.**

### 4.6 B l'emporte sur C pour tout le reste
`layout.tsx` (icône Apple dédiée de B), `marketing-service.ts` (quotas par plateforme de B,
pas le `social_accounts` global de C), `conversation-orchestrator.ts` (`allowAI`),
`zernio/adapter.ts` (`message: content || undefined` pour vocaux/pièces jointes seules —
verrouillé par un test), `omnichannel-publication-service.ts` (quotas, garde-fou vidéo 7 jours,
limite vidéo Telegram, `getWhatsAppGroupsProvider`), `whatsapp-group-service.ts` (statut
`suspended`, `getWhatsAppGroupsProvider` ×3).

## 5. Vérification

Exécutée dans mon environnement, pas seulement lue.

| Contrôle | Résultat |
|---|---|
| `npm ci` | OK |
| `npm run typecheck` | **0 erreur** |
| `npm run lint` | **0 erreur**, 1 warning `no-img-element` sur `omnichannel-publication-composer.tsx` (préexistant, déjà signalé au #14) |
| `npm test` — **B intact (témoin)** | 736 réussis / **7 échoués** (66 fichiers) |
| `npm test` — **fusion** | **758 réussis** / **7 échoués** (68 fichiers) — **exactement les mêmes 7** |
| `npm run build` | **84/84 pages** |

Les +22 tests réussis correspondent au décompte : 3 (domaine tenant) + 4 (Zernio) + 4
(`buildProductButtons`) + 11 (test omnichannel combiné). Aucun échec nouveau, aucun disparu.

Build : `next/font/google` exige Internet (bloqué ici). Le build a été fait dans une **copie
jetable** avec polices stubées ; `layout.tsx` et `fonts.ts` livrés sont intacts (vrai
`next/font/google`).

Audit du diff contre B : 20 fichiers modifiés, 6 ajoutés, **0 supprimé** ; toutes les lignes de
B retirées dans le code de production sont des remplacements voulus (aucun apport de B perdu).

### Les 7 tests rouges — préexistants, pas causés par la fusion
Identiques sur B intact. Ce sont des **tests périmés face à des changements volontaires de B** ;
je ne les ai **pas** modifiés (les réécrire reviendrait à trancher des questions produit) :

| Fichier | Échecs | Cause |
|---|---|---|
| `marketing-service.test.ts` | 2 | Attendent l'ancien quota global `social_accounts` ; B utilise des quotas **par plateforme** (`facebook_pages`…) |
| `admin-plans-service.test.ts` | 1 | Attend « clé jamais configurée = illimité (-1) » ; B affiche désormais **0** (fail-closed, commentaire explicite dans le code) |
| `team-service.test.ts` | 4 | Ne mocke pas `canUseFeature` ; B a ajouté le quota cumulatif `team_members` → « limite de 0 membre(s) » avec les mocks actuels |

Point de vigilance lié : l'aperçu admin (0 pour une clé absente) et `getEntitlementLimit`
(-1 = illimité pour une clé absente) n'ont pas la même sémantique. Sans conséquence si les
migrations `0062` sont appliquées, mais à trancher.

## 6. Non vérifié

- **Aucune exécution contre un vrai Supabase / Telegram / Zernio / WhatsApp.** Les boutons
  Telegram n'ont pas été envoyés à un vrai bot ; la migration `0065` n'a pas été jouée.
- Le comportement de **Zernio pour un envoi interactif vers un groupe** n'est pas confirmé
  (décision 4.2 : prudence, pas certitude).
- Les tests Playwright (`test:e2e`) et d'intégration Supabase n'ont pas été exécutés.

## 7. À faire avant mise en production

1. **Appliquer `0065`** ; exécuter `supabase/CHECK_MIGRATIONS_0062_0065.sql` (et
   `CHECK_MIGRATIONS_0055_0061.sql` si ce n'est pas fait) pour `0062`→`0064`.
2. Ajouter au webhook Zernio (dashboard) : `comment.received`, `post.external.created`,
   `post.external.updated`, `post.external.deleted` (lot 5).
3. Tester en réel : un produit publié sur Telegram (texte, image, **vidéo**) → bouton visible,
   lien correct sous le domaine du tenant ; une diffusion vers un groupe WhatsApp → liens
   en texte, aucune erreur.
4. Confirmer `scholarmach.com` (§4.5).
5. Décider du sort des 7 tests rouges (§5).

## 8. Points ouverts hérités (non traités ici)

- **Routage multi-numéros WhatsApp — CONFIRMÉ non résolu.** `resolveOrganizationIdByZernioAccount`
  (auto-réponse `message.received`) ne lit que `provider_connections` (numéro principal) ;
  aucun fichier de webhook ne lit `whatsapp_accounts`. Un message reçu sur un numéro secondaire
  risque de ne jamais être routé vers son tenant. Préexistant (A et B), signalé par
  `RAPPORT_LOT_5.md` §4 ; mérite son propre lot.
- Page `/tarifs` (« réponse automatique aux commentaires ») vs comportement réel (suggestion IA),
  entitlements `*_auto_comments` jamais appliqués, `switchToFreePlan` sans reset des crédits IA :
  voir `RAPPORT_LOT_5.md`.

## 9. Fichiers

**Modifiés (20)** : `.env.example`, `src/lib/env.ts`, `src/domain/ports/messaging-provider.ts`,
`src/infrastructure/tenant/resolve-request-tenant.ts`,
`src/infrastructure/providers/messaging/telegram/{adapter,client,types}.ts`,
`src/infrastructure/providers/messaging/zernio/{adapter,types}.ts`,
`src/application/services/{catalog-service,conversation-orchestrator,marketing-service,omnichannel-publication-service,telegram-publication-service,whatsapp-group-service}.ts`
et leurs tests (`catalog-service`, `conversation-orchestrator`, `omnichannel-publication-service`,
`whatsapp-group-service`), `docs/ZERNIO_INTEGRATION.md`.

**Ajoutés (6)** : `supabase/migrations/0065_telegram_publications_buttons.sql`,
`supabase/CHECK_MIGRATIONS_0062_0065.sql`,
`src/infrastructure/tenant/resolve-request-tenant.test.ts`,
`src/infrastructure/providers/messaging/zernio/adapter.test.ts`,
`RAPPORT_FUSION_14b_LIENS_TENANT_BOUTONS.md`, `RAPPORT_FUSION_17.md`.

Livré en zip du projet complet (`node_modules`, `.next` et `tsconfig.tsbuildinfo` exclus).
