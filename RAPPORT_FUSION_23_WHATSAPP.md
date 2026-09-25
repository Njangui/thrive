# Rapport #23 — audit WhatsApp : messagerie ≠ groupes

Fait suite à `RAPPORT_FUSION_22.md`. Date : 21 septembre 2026.

**Demande** : vérifier toute la partie WhatsApp, en distinguant strictement le **groupe WhatsApp** de la **messagerie WhatsApp**, sur la **dernière version** du code.

## 1. Base de travail

`thrive-main__3_.zip` (698 fichiers) = **fusion #22** (fusion #21 + lot O « Freemium v2 »). C'est un sur-ensemble de ma fusion #21 : 30 fichiers nouveaux, 72 modifiés, **0 fichier manquant**. Son rapport indiquait qu'aucun test n'avait été lancé ; je les ai lancés **tels que reçus** :

| Contrôle (version reçue, avant tout changement) | Résultat |
|---|---|
| `typecheck` | 0 erreur |
| `lint` | 0 alerte |
| `npm test` | 949 réussis (86 fichiers) |

La version reçue est donc saine. Tous les constats ci-dessous sont des défauts de **conception**, pas de compilation.

## 2. Ce qui est distinct — et où

Trois choses portent le nom « WhatsApp » ; le code les sépare bien **presque partout** :

| | Messagerie | Groupes | Bouton vitrine |
|---|---|---|---|
| Usage | Clients en tête-à-tête, réponses automatiques, CRM | Diffusion de produits dans des groupes | Lien `wa.me` vers le numéro du commerçant |
| Numéro / compte Zernio | Numéros de `whatsapp_accounts` (multi-numéros) | **Numéro dédié**, `provider_connections.provider_type = 'whatsapp_groups'`, profil Zernio à part | aucun |
| Quota d'offre | `whatsapp` (nombre de numéros) | `whatsapp_groups` (nombre de groupes connectés) | — |
| Envoi | `getMessagingProvider(org, "zernio", accountId)` | `getWhatsAppGroupsProvider(org)` + `zernioConversationId` | — |
| Diffusion | « Diffusions aux contacts » (fenêtre 24 h, STOP) | « Groupes WhatsApp » | — |

**Vérifié conforme, aucun changement** : quotas séparés et comptés sur les bonnes tables ; page Canaux qui explique qu'un groupe exige « un second numéro, différent de celui de la messagerie » ; envoi de groupe par le bon provider avec l'identifiant de conversation du groupe (et non celui du groupe lui-même) ; aucun bouton envoyé vers un groupe ; contacts désinscrits (STOP) et fenêtre de 24 h respectés par les diffusions aux contacts ; bouton `wa.me` de la vitrine indépendant de tout cela.

## 3. Défauts trouvés (tous corrigés ici)

| # | Gravité | Constat | Preuve dans le code |
|---|---|---|---|
| **C1** | **Critique** | **Aucun groupe ne pouvait être activé, donc aucune diffusion vers un groupe ne pouvait partir.** Un groupe s'active au premier message qui en provient (webhook `message.received`). Or le numéro dédié aux groupes est un compte Zernio **distinct**, et le seul résolveur des événements de messagerie (`resolveOrganizationIdByZernioAccount`) ne reconnaissait que `provider_type = 'messaging'` : les événements du numéro de groupes étaient rejetés (« aucun tenant résolu ») avant d'atteindre `activateGroupFromInboundConversation`, appelée uniquement depuis ce webhook | `registry.ts::getWhatsAppGroupsProvider`, `zernio-channel-service.ts::persistZernioOAuthConnection`, `resolve-organization.ts`, `whatsapp-group-service.ts::createBroadcast` (refuse un groupe non activé) |
| **C2** | **Critique (latent)** | Corriger C1 seul aurait créé pire : le pipeline de messagerie **ne connaissait pas la notion de groupe**. Un message reçu dans un groupe (canal « whatsapp », texte) aurait créé un contact et une conversation CRM, déclenché la **réponse automatique — FAQ, catalogue, IA — envoyée dans le groupe, visible de tous ses membres** (et consommé des crédits IA), et alerté les admins « message sans réponse » | `mapper.ts` (tout message texte devient `MESSAGE_RECEIVED`), `inbox-channel-policy.ts` (`whatsapp` toujours accepté), `inbound-auto-reply-service.ts` |
| **C3** | Élevé | **Multi-numéros : les messages reçus sur un 2ᵉ ou 3ᵉ numéro de messagerie étaient ignorés.** La migration 0063 annonce « le nouveau resolver lit `whatsapp_accounts` », mais le résolveur ne lisait que `provider_connections`, qui ne reflète que le premier numéro. C'est le point « confirmé non résolu » de `RAPPORT_FUSION_17 §8` | `0063_whatsapp_multi_numbers.sql` l. 65, `persistZernioOAuthConnection` (seul le numéro principal est écrit dans `provider_connections`) |
| **C4** | Moyen | Une **diffusion aux contacts** sélectionnait ses destinataires dans `conversations` (canal `whatsapp`) : un fil de groupe présent dans cette table aurait pu recevoir la campagne — un mélange des deux produits | `contact-broadcast-service.ts::loadCandidates`, `sendToRecipient` |
| **C5** | Faible | Deux entrées de menu voisines, « Groupes WhatsApp » et « Diffusions », se prêtaient à confusion (« Diffusions » = contacts, pas groupes) | `dashboard-nav.tsx`, `broadcasts/page.tsx` |

## 4. Corrections

- **`resolve-organization.ts`** : `resolveOrganizationIdByZernioAccount` lit d'abord `whatsapp_accounts` (tous les numéros de messagerie connectés), puis retombe sur `provider_connections` (anciennes lignes) ; nouveau `resolveOrganizationIdByWhatsAppGroupsAccount` pour le numéro dédié aux groupes. Le résolveur de messagerie **ne** reconnaît **pas** le compte de groupes, volontairement (testé).
- **`webhooks/zernio/route.ts`** : le numéro de groupes est routé (ce qui active le groupe), puis **l'événement s'arrête** : ni contact, ni conversation, ni réponse automatique, ni alerte. Défense en profondeur : sur un numéro de messagerie, un fil dont l'identifiant est celui d'un groupe connu est ignoré.
- **`whatsapp-group-threads.ts`** (nouveau, isolé) : `isWhatsAppGroupThread` / `listWhatsAppGroupThreadIds`, le test commun « ce fil est-il un groupe ? ». Une erreur de lecture ne bloque jamais le traitement normal.
- **`contact-broadcast-service.ts`** : les fils de groupe sont exclus de l'audience **à la création** et **à l'envoi** (les destinataires sont figés à la création).
- **Libellés** : « Diffusions » → « Diffusions aux contacts ».
- **`docs/ZERNIO_INTEGRATION.md`** : section « Messagerie WhatsApp ≠ Groupes WhatsApp » (tableau ci-dessus + règles du webhook).
- **`supabase/CHECK_WHATSAPP_GROUPS_VS_MESSAGING.sql`** (lecture seule) : groupes connectés jamais activés, fils de groupe présents dans la messagerie, numéros de messagerie routables, collision entre les deux types de compte.

## 5. Tests — 21 nouveaux

`route.test.ts` du webhook Zernio (7), `resolve-organization.test.ts` (6), `whatsapp-group-threads.test.ts` (6), `contact-broadcast-groups.test.ts` (2). Ils couvrent : message client sur la messagerie (pipeline normal) ; **message de groupe → activation seule** ; groupe sans texte (média) activé quand même ; fil de groupe reçu sur un compte de messagerie ignoré ; compte inconnu ignoré ; numéro secondaire routé ; repli historique ; le résolveur de messagerie ne reconnaît pas le compte de groupes ; audience et envoi des diffusions.

**Contrôle de mutation** : en retirant chaque correctif, **6 de ces tests échouent** ; ils repassent après restauration.

## 6. Vérification (version corrigée)

| Contrôle | Résultat |
|---|---|
| `typecheck` | 0 erreur |
| `lint` | 0 alerte |
| `npm test` | **970 réussis / 0 échoué** (90 fichiers) : 949 + 21 |
| `npm run build` (Next 16.3.5) | OK, 85/85 pages |
| `package.json` / `package-lock.json` | inchangés (déjà vérifiés à froid en #21 ; le lot O n'a ajouté aucune dépendance) |

Build : copie jetable avec polices stubées et identifiants Supabase factices, comme en #18 → #21.

## 7. Limites — à lire

- **Rien n'a été testé contre Zernio.** Les tests reposent sur ce que documente le projet : pour un groupe, l'identifiant de conversation est celui du groupe. Je n'ai pas vu un vrai payload de groupe.
- **Détection par la base uniquement.** Un fil est reconnu comme groupe s'il figure dans `whatsapp_groups`. Aucun champ « est un groupe » n'est confirmé dans l'API Zernio et je n'en ai pas inventé. Un groupe jamais connecté dans flexco  ne serait pas reconnu s'il arrivait sur un numéro de messagerie (cas que la séparation des deux comptes rend improbable).
- **Hypothèse sur le webhook** : les événements du numéro de groupes doivent arriver sur le même endpoint que le reste. À vérifier dans le tableau de bord Zernio (un webhook par clé API, ou par profil ?).
- **Les messages reçus dans un groupe ne sont pas conservés** (il n'existe pas de boîte de groupe) : ils servent uniquement à activer le groupe. Décision produit à prendre si vous voulez les voir.
- `activateGroupFromInboundConversation` est toujours appelée pour chaque message entrant (un `UPDATE` sans effet pour un client) : négligeable, non modifié.

## 8. À faire au déploiement

1. **Zernio** : confirmer que le webhook reçoit bien les événements du profil dédié aux groupes.
2. Exécuter `supabase/CHECK_WHATSAPP_GROUPS_VS_MESSAGING.sql`. Attendu : la requête 1 liste les groupes bloqués (tous, avant correctif) ; les requêtes 2 et 4 renvoient 0 ligne.
3. **Envoyer un message une fois dans chaque groupe déjà connecté** pour l'activer (comportement documenté) ; il quitte alors la requête 1.
4. Essais réels : (a) un message dans un groupe → le groupe s'active, **aucune réponse automatique n'y est envoyée** ; (b) un message client → réponse automatique normale ; (c) un message sur un 2ᵉ numéro de messagerie → il arrive dans la boîte de réception.
5. Les points ouverts des rapports précédents restent valables (Fapshi, licence des images, revue visuelle, lot O non testé contre Zernio).

## Annexe — fichiers touchés par rapport à la dernière version reçue (fusion #22)

### Ajoutés (7)

- `RAPPORT_FUSION_23_WHATSAPP.md`
- `src/app/api/webhooks/zernio/route.test.ts`
- `src/application/services/contact-broadcast-groups.test.ts`
- `src/application/services/whatsapp-group-threads.test.ts`
- `src/application/services/whatsapp-group-threads.ts`
- `src/infrastructure/providers/messaging/zernio/resolve-organization.test.ts`
- `supabase/CHECK_WHATSAPP_GROUPS_VS_MESSAGING.sql`

### Modifiés (6)

- `docs/ZERNIO_INTEGRATION.md`
- `src/app/api/webhooks/zernio/route.ts`
- `src/app/dashboard/_components/dashboard-nav.tsx`
- `src/app/dashboard/broadcasts/page.tsx`
- `src/application/services/contact-broadcast-service.ts`
- `src/infrastructure/providers/messaging/zernio/resolve-organization.ts`

### Supprimés (0)

_aucun_
