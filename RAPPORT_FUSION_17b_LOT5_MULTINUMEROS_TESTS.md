# Rapport de fusion #17 — Lot 5 (commentaires temps réel) + WhatsApp multi-numéros v7 + report du correctif domaine/boutons

Deux archives reçues, toutes deux descendant de `RAPPORT_FUSION_16.md` +
`RAPPORT_LOT_1/2/4.md` (travail fait ailleurs, jamais vu jusqu'ici) :

1. **`files__20_.zip`** — en réalité le Lot 5 complet (576 fichiers) :
   commentaires Facebook/Instagram/LinkedIn en temps réel + audit du
   système de notifications/crédits IA (voir `RAPPORT_LOT_5.md`, déjà à
   la racine).
2. **`tokoo -tokoo -whatsapp-multi-numbers-v7.zip`** (573 fichiers) :
   plusieurs numéros WhatsApp par entreprise (table `whatsapp_accounts`,
   migration `0063`). Corrige un vrai risque signalé par le Lot 5 lui-même
   (§4 de son rapport) : un message reçu sur un numéro WhatsApp secondaire
   pouvait ne jamais être routé vers le bon tenant.

## Fusion Lot 5 + multi-numéros

Diff exhaustif entre les deux : seulement 13 fichiers divergents,
exactement la liste du Lot 5 lui-même. Les deux fichiers à plus haut
risque de conflit réel (`zernio/resolve-organization.ts`,
`webhooks/zernio/route.ts` — l'un pour le routage WhatsApp, l'autre pour
le nouveau routage commentaires) vérifiés un par un : additions pures,
aucune ligne du multi-numéros touchée. Fusion appliquée sans réserve.

## Mon propre travail, absent de cette lignée, entièrement reporté

Cette lignée (`FUSION_15/16` + Lots 1/2/4/5) a divergé de ma `FUSION_13`
en parallèle, sans jamais recevoir ma `FUSION_14` (correctif du lien
produit pointant vers le domaine générique au lieu de celui du tenant +
bouton "Voir plus" Telegram/WhatsApp). Vérifié absent (`getTenantPublicOrigin`
introuvable, `env.NEXT_PUBLIC_APP_URL` toujours utilisé dans
`conversation-orchestrator.ts`, `marketing-service.ts`,
`omnichannel-publication-service.ts`, `whatsapp-group-service.ts`) —
entièrement reporté, adapté aux évolutions survenues entre-temps (notes
vocales et upload binaire côté Telegram, numéro WhatsApp dédié aux
groupes). Détail du correctif original : voir `RAPPORT_FUSION_14.md`.

**Bug retrouvé une seconde fois** : la diffusion WhatsApp groupe immédiate
(`omnichannel-publication-service.ts`) confondait encore `externalId` (le
groupe WhatsApp) et `zernio_conversation_id` (la conversation Zernio) —
aurait échoué à chaque envoi. Corrigé (`ConnectedGroup.zernioConversationId`
ajouté). Un test écrit par une autre session validait ce bug comme
comportement attendu (`externalThreadId: "ext-1"` au lieu de la
conversation) — corrigé avec le reste.

## 3 fichiers de tests obsolètes trouvés et corrigés (sans rapport avec cette fusion)

La session ayant livré le multi-numéros n'avait ni réseau ni
`node_modules` (voir son propre `RAPPORT_LOT_5.md`, §"limite") — jamais
pu lancer `npm run test`. Trouvé en lançant la suite complète ici :

- **`admin-plans-service.test.ts`** : attendait `-1` (illimité) pour une
  clé jamais configurée. Le code (`plans-repository.ts`, commenté et
  déjà cohérent avec 3 autres services) est fail-closed à `0` depuis le
  passage freemium — délibéré, documenté. Test corrigé pour refléter ce
  choix, pas une régression.
- **`team-service.test.ts`** (4 tests) : même cause — `team_members` fait
  partie des clés connues, donc fail-closed à `0` sans configuration en
  base, ce qu'aucun mock du fichier ne fournissait. Ajout d'un défaut
  "illimité" dans le `beforeEach` (ce fichier teste la logique
  d'invitation, jamais l'application du quota elle-même).
- **`marketing-service.test.ts`** (2 tests) : testait un ancien plafond
  global unique (`"social_accounts"`, comptage des comptes RÉELLEMENT
  connectés via `listAccounts()`). Le code actuel vérifie par plateforme
  (`facebook_pages`, `instagram_accounts`...) à partir des comptes CIBLÉS
  par la campagne — `listAccounts()` n'est d'ailleurs plus appelé nulle
  part dans ce fichier. Vérifié avant de conclure à une régression : le
  vrai garde-fou contre un compte en trop est à la CONNEXION du compte
  (`dashboard/channels/page.tsx::connectSocialAction`, quota vérifié
  avant toute connexion) — un plan ne peut donc jamais avoir plus de
  comptes connectés que sa limite, ce qui rend le recomptage global à la
  création de campagne redondant. Tests réécrits pour refléter le
  mécanisme actuel (délibéré, pas une régression) plutôt que reverter le
  code vers l'ancien comportement.

## Vérification finale

- `npm run typecheck` : 0 erreur.
- `npm run lint` : 0 erreur (1 warning préexistant, sans rapport).
- `npm run test` : **755/755 tests verts**, 67 fichiers (dont 7 corrigés/
  ajoutés cette session : `admin-plans-service`, `team-service`,
  `marketing-service`, `catalog-service` (+`buildProductButtons`),
  `omnichannel-publication-service`, `whatsapp-group-service`,
  `zernio/adapter`, `telegram/adapter`).
- `npm run build` : succès, toutes les routes générées (Google Fonts
  stubé temporairement le temps du build à cause du bac à sable, fichiers
  originaux restaurés avant livraison — même méthode que d'habitude).

Livré en zip du projet complet (`node_modules`/`.next` exclus).
