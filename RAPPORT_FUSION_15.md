# Rapport de fusion #15 — trois livraisons sur tokoo -fusionne-14

Fait suite à `RAPPORT_FUSION_14.md` (dont l'addendum décrit le bug de
redirection et l'hypothèse des migrations non appliquées). Trois archives
reçues :

1. **`fix-redirect-bug.zip`** (6 fichiers) — correctif du bug « le succès
   s'affiche comme une erreur ».
2. **`fichiers-modifies-catalogue-v2.zip`** (31 fichiers) — Catalogue V2,
   **2ᵉ livraison** : ajout de photos par lot, import CSV des images et des
   informations complémentaires.
3. **`thrive-main-whatsapp-coexistence.zip`** (514 fichiers) — lot **WhatsApp
   Coexistence + numéro dédié aux Groupes**. Aucun rapport n'accompagnait cette
   archive : sa description ci-dessous est reconstituée depuis l'en-tête de sa
   migration et des commentaires du code.

## Méthode — cette fois avec l'ancêtre commun

Contrairement à #14, l'ancêtre commun a pu être **reconstitué exactement** :
l'archive WhatsApp et l'archive Catalogue V2 (1ʳᵉ livraison) partagent 477
fichiers à la date d'ancêtre, **tous de contenu identique** (0 différence) ; les
fichiers touchés d'un côté sont retrouvés intacts de l'autre (510 fichiers
d'ancêtre). Ce qui permet de faire de vraies **fusions à trois voies**
(`git merge-file`, base = ancêtre) au lieu de raisonner à partir de diffs :

- fichier touché d'un seul côté (tokoo  = ancêtre) → version de la livraison ;
- fichier touché des deux côtés → fusion à trois voies, chaque conflit tranché
  à la main.

L'arbre de départ est celui de #14 **plus** les correctifs de redirection (faits
après la livraison de `tokoo -fusionne-14.zip`, donc absents de ce zip-là et
présents dans celui-ci).

## 1. `fix-redirect-bug.zip` — déjà couvert, rien à importer

Comparé ligne à ligne, fichier par fichier : mêmes 6 fichiers, **même schéma**
que mon correctif (succès appelé après le `try/catch` ; `throw new AppError(...)`
pour la validation « aucune photo » des pages d'édition). Version de l'arbre
conservée : elle ajoute un `console.error` de la cause réelle dans
`dashboard/ai` et contient les évolutions des deux autres livraisons, que
l'archive du correctif ignore. Le test de non-régression
(`src/lib/no-redirect-in-try-catch.test.ts`) vérifie que l'arbre fusionné ne
contient plus aucun `redirect()` avalé par un `catch`.

## 2. Catalogue V2, 2ᵉ livraison

Delta réel par rapport à la 1ʳᵉ livraison (déjà fusionnée) : **10 fichiers de
code** + le rapport. Les 21 autres fichiers du zip étaient identiques à la 1ʳᵉ
livraison ; les deux migrations aussi (rien à refaire côté SQL).

Fusion à trois voies, base = V2 v1 (avec la même renumérotation qu'en #14) :
8 fichiers sans conflit — dont `media-service.ts` : l'union de `MediaType`
(`"service"` de V2 + `"telegram-inbox"` de Telegram v3, faite en #14)
survit intacte et la nouvelle fonction `resolveImagesFromFormData` s'y ajoute.

**2 conflits** (`dashboard/products/[id]/edit` et `dashboard/services/[id]/edit`) :
V2 v2 passe l'ajout de photo au pluriel (`urls`, `appendProductImages` /
`appendServiceImages`) mais garde `redirect()` dans le `try` pour le cas « aucune
photo ». Résolu = logique multi-photos de V2 v2 **+** correctif de redirection
(`throw new AppError("Choisissez au moins une photo ou collez au moins un
lien.", 400, "validation")`, message inchangé pour l'utilisateur).

`RAPPORT_CATALOGUE_V2.md` remplacé par la version à jour (section « Suite — ajout
de photos par lot »), avec le bandeau de renumérotation.

## 3. WhatsApp Coexistence + numéro dédié aux Groupes

**Ce que fait le lot** (d'après l'en-tête de la migration) : la messagerie
WhatsApp 1:1 passe en Coexistence (le commerçant garde son numéro utilisable sur
l'app WhatsApp Business) ; or un numéro en Coexistence ne supporte pas l'API
Groupes. Les Groupes exigent donc un **second numéro, dédié** : soit connecté
par le commerçant lui-même (gratuit), soit **loué à la plateforme** (demande →
assignation par un Super Admin depuis `/admin/numbers` → loyer mensuel séparé du
forfait, payé via le pipeline NotchPay existant, `payment_type =
'dedicated_number'`). Sans renouvellement à l'échéance : relance J-3 puis reprise
automatique du numéro et **suspension** des groupes qu'il alimente.

**Fichiers** (14 fichiers de code ; `package-lock.json` et
`tsconfig.tsbuildinfo` de l'archive non repris — `package.json` est inchangé côté
WhatsApp, le `package-lock.json` tokoo  est conservé) :

| Traitement | Fichiers |
|---|---|
| Repris tels quels (tokoo  = ancêtre) | `zernio/client.ts`, `zernio-channel-service.ts`, `providers/registry.ts`, `admin-addons-service.ts`, `admin/addons/page.tsx`, `admin/numbers/page.tsx` |
| Nouveaux | `phone-number-rental-service.ts`, `api/cron/process-phone-number-renewals/route.ts`, migration |
| Fusion à trois voies, sans conflit | `dashboard/groups/page.tsx` (+ mon correctif de redirection), `whatsapp-group-service.ts`, `subscription-payment-service.ts` |
| Fusion à trois voies, **1 conflit** chacun | `notification-service.ts`, `dashboard/channels/page.tsx` |
| Corrigé pour compatibilité entre lots (fichier tokoo , pas dans l'archive WhatsApp) | `omnichannel-publication-service.ts` |

**Conflits tranchés**
- `notification-service.ts` (`buildRelatedEntityUrl`) : les deux lots ont ajouté
  une route au même endroit — Telegram `telegram_publication` → Marketing, WhatsApp
  `phone_number` → Canaux. **Union** des deux. Nouveau test
  (`notification-service.test.ts`, 6 cas) pour qu'aucune des deux ne disparaisse
  dans une fusion future ; `subscription_payment` reste dirigé vers « Mon
  abonnement ».
- `dashboard/channels/page.tsx` : les deux côtés avaient modifié les mêmes deux
  lignes de la carte « WhatsApp Business ». Base **tokoo ** (marque tokoo ,
  palette `#F8FAFC`) + **texte de la coexistence** repris de WhatsApp (« Connectez
  le numéro que vous utilisez déjà… », « Sélectionnez votre compte WhatsApp
  Business existant », « votre app continue de fonctionner »). Le « SME-OS » du
  texte d'origine devient « tokoo  » sur cette surface d'interface.

### Numéro de migration — `0055` → `0058`

`0055` = Telegram, `0056`/`0057` = Catalogue V2 : la migration WhatsApp devient
**`0058_whatsapp_coexistence_dedicated_numbers.sql`**. Contenu SQL inchangé ;
noms de fichiers et références numériques mis à jour dans le code et la
migration (contrôle final : `grep` sans aucune référence obsolète dans `src/` ni
`supabase/`).

### Vérifications d'interaction avec tokoo 

- La migration `0058` **remplace trois contraintes CHECK** (`drop constraint`
  puis `add constraint`) : `provider_connections_provider_type_check`,
  `whatsapp_groups_status_check`, `subscription_payments_payment_type_check`.
  Aucune des migrations `0055`–`0057` n'y touche (seules 3 migrations diffèrent
  de l'ancêtre) et les valeurs de `provider_type` réellement utilisées par le
  code (`social`, `messaging`, `ai`) figurent toutes dans la nouvelle liste : pas
  de régression silencieuse.
- **Conflit sémantique réel, invisible dans un merge de texte, corrigé.**
  `omnichannel-publication-service.ts` (Telegram Omnichannel v3, code propre à
  tokoo ) envoyait immédiatement vers un groupe WhatsApp via
  `getMessagingProvider(orgId, "zernio")`, c'est-à-dire le profil de messagerie
  1:1 — qui, en Coexistence, **ne supporte pas l'API Groupes**. Après cette
  fusion, une publication immédiate vers un groupe depuis
  `/dashboard/marketing/nouveau` aurait échoué. Désormais : `getWhatsAppGroupsProvider`
  (numéro dédié), comme les 3 sites de `whatsapp-group-service.ts`. La
  publication *programmée* passait déjà par `createBroadcast`, donc par le bon
  fournisseur. Nouveau test (`omnichannel-publication-service.test.ts`, 3 cas :
  envoi immédiat, programmé, groupe non activé/suspendu) ; vérifié qu'il **échoue**
  si l'ancien comportement est réinjecté. Les autres appelants de
  `getMessagingProvider(..., "zernio")` (webhook `api/webhooks/zernio` : réponses
  automatiques 1:1 ; `follow-up-service`, `conversation-admin-service` : 1:1)
  restent corrects.
- `subscription-payment-service.ts` : les ajouts Telegram de #13 (alertes
  super-admin sur échec / expiration / paiement complété d'un forfait) et la
  branche `dedicated_number` de WhatsApp portent sur des zones différentes de
  `markPaymentCompleted` ; relus, pas d'interaction.

## Décisions et points à connaître

1. **Cron externe à programmer.** Aucun `vercel.json` : vos crons sont externes
   (voir `docs/DEPLOYMENT.md`). `/api/cron/process-phone-number-renewals` existe
   mais **rien ne le déclenche** tant qu'il n'est pas programmé (toutes les 1 à 4
   h, même `CRON_SECRET`) — sans lui, aucun numéro loué n'est relancé ni repris.
   Nouvelle section 4quater de `docs/DEPLOYMENT.md` + ligne dans la checklist.
2. **Prix du numéro** : affiché sur `/admin/numbers`, **modifié depuis
   `/admin/addons`** (valeur de repli 5 000 FCFA). Documenté tel quel.
3. **Marque « SME-OS »** : les chaînes restantes ont été renommées dans un second
   temps — voir l'addendum en fin de rapport.
4. **Alerte Telegram super-admin** : un paiement de numéro dédié n'en déclenche
   pas, comme les paiements d'add-on (seul le paiement de forfait le fait).
   Comportement laissé tel quel ; à ajouter si vous voulez être alerté.
5. **Docs** : `docs/DATABASE.md` (ligne `0058`, avec l'avertissement « remplace
   trois contraintes, à appliquer une seule fois »), `docs/DEPLOYMENT.md`.
6. **`supabase/CHECK_MIGRATIONS_0055_0061.sql`** (lecture seule) : dit lesquelles
   des migrations `0055`–`0058` sont déjà appliquées sur une base. **À exécuter
   avant d'appliquer quoi que ce soit** — `0056` et `0058` ne sont pas
   idempotentes (`create table` / `create policy` / contraintes).

## Vérification

- `npm run typecheck` : 0 erreur.
- `npm run lint` : 0 erreur (1 warning préexistant, `no-img-element` sur
  `omnichannel-publication-composer.tsx`).
- `npm run test` : **665/665 tests verts**, 59 fichiers (639 en #14 : +2 test de
  non-régression des redirections, +15 venant de la 2ᵉ livraison Catalogue V2,
  +6 `notification-service`, +3 `omnichannel-publication-service`). Un message d'erreur de mock
  (`getNotificationProvider` absent du mock de `registry`) s'affiche pendant
  `subscription-payment-service.test.ts` sans faire échouer de test : bruit
  préexistant (test inchangé par cette fusion, lié à l'appel Telegram ajouté en
  #13, qui ne lève jamais).
- `npm run build` : **83/83 pages générées**, succès (82 en #14 + la route cron).
  Même procédure qu'en #12/#13/#14 : `next/font/google` nécessite
  `fonts.googleapis.com`, hors de l'allowlist réseau du bac à sable → stub
  temporaire de `fonts.ts` et `layout.tsx` + variables Supabase factices, fichiers
  **restaurés à l'identique avant livraison** (`cmp` vérifié).
- Diff contre l'arbre d'avant #15 : 7 fichiers nouveaux (dont ce rapport), 27
  modifiés, 0 supprimé — uniquement ceux décrits ci-dessus.

## Non vérifié

- **Aucune exécution contre une vraie base Supabase** : les migrations
  `0055` à `0058` n'ont été appliquées à aucun Postgres.
- **Aucun parcours réel** de la Coexistence (onboarding Zernio/Meta), de la
  connexion d'un numéro dédié, du paiement du loyer via NotchPay
  (`dedicated_number`), ni du cron de relance/reprise. Ce lot n'apportait aucun
  test propre ; seuls la compilation, le lint, les tests existants et le build
  le couvrent.
- Les écrans dashboard (photos par lot, import CSV, cartes Canaux) n'ont été
  validés ni dans un navigateur ni sur données réelles.
- Le test d'interaction WhatsApp/Telegram s'appuie sur des mocks : il prouve que le
  bon fournisseur est appelé, pas qu'un message part réellement vers un groupe.

## Ordre de mise en ligne recommandé

1. Exécuter `supabase/CHECK_MIGRATIONS_0055_0061.sql`.
2. Appliquer, **dans l'ordre**, uniquement les migrations dont la colonne vaut
   `false` : `0055` → `0056` → `0057` → `0058`.
3. Déployer le code.
4. Programmer le cron `/api/cron/process-phone-number-renewals`.

Livré en zip du projet complet (`node_modules`, `.next` et
`tsconfig.tsbuildinfo` exclus).

---

## Addendum — passage SME-OS → tokoo  (version `15b`)

Suite à votre accord sur la question posée à la fin de #15. **62 remplacements de
la chaîne exacte `SME-OS` dans 34 fichiers**, casse exacte volontairement (les
noms d'hôte en minuscules, `sme-os.app`, ne sont donc pas touchés).

### Ce qui change pour vos utilisateurs

| Où | Avant | Après |
|---|---|---|
| Email d'invitation d'équipe (objet + corps) | « … sur SME-OS » | « … sur tokoo  » |
| Description envoyée à NotchPay (vue par le payeur) | « Abonnement SME-OS — forfait … », « Add-on SME-OS : … », « SME-OS — Numéro WhatsApp dédié … » | idem avec tokoo  |
| Notification d'échéance d'abonnement | « … continuer à utiliser SME-OS » | tokoo  |
| Messages « pays indisponible / bientôt / liste d'attente » | « … sur SME-OS » | tokoo  |
| `/dashboard/channels` (numéro dédié) | « l'équipe SME-OS », « que SME-OS m'en fournisse un » | tokoo  |
| Titre YouTube par défaut (publication sans texte) | « Publication SME-OS » | « Publication tokoo  » |
| Profil Zernio (nom de repli si l'entreprise n'a pas de nom, description) | « SME-OS … » | tokoo  |
| Expéditeur d'email **par défaut** (`EMAIL_FROM_ADDRESS`) | `SME-OS <onboarding@resend.dev>` | `tokoo  <onboarding@resend.dev>` |

Plus : commentaires de code, `globals.css`, `tailwind.config.ts`, `.env.example`,
`README.md` et 9 documents `docs/*.md` (docs vivantes).

### Décision — liens « Site propulsé par tokoo  »

Le texte affiché disait déjà « tokoo  » sur toutes les vitrines et landings
tenant, mais le lien pointait en dur vers `https://sme-os.app`. Il pointe
désormais vers `NEXT_PUBLIC_APP_URL` (URL publique de la plateforme, déjà
utilisée ailleurs pour les liens absolus). Raison : le domaine réel de tokoo 
n'est pas connu du dépôt et diffère selon le déploiement ; cette variable est la
seule source correcte partout. **Conséquence : `NEXT_PUBLIC_APP_URL` doit être
l'URL publique de la plateforme en production** (sinon le lien retombe sur
`http://localhost:3000`, valeur par défaut).

### ⚠️ À faire de votre côté

- **`EMAIL_FROM_ADDRESS` dans Vercel** : si la variable est définie
  explicitement (par exemple copiée depuis l'ancien `.env.example`), elle
  l'emporte sur le nouveau défaut et les emails continueront de partir sous
  « SME-OS ». La mettre à jour, avec un domaine d'envoi vérifié chez Resend.

### Volontairement non modifié

- **Noms d'hôte** `tenant.sme-os.app`, `monsalon.sme-os.app`, etc. : commentaires,
  fixtures de tests et un exemple de `docs/DEPLOYMENT.md`. Ce sont des exemples ;
  je n'ai pas de domaine de remplacement fiable à y mettre.
- **Clé `localStorage` `sme-os:install-banner-dismissed-at`** (bannière
  « Installer l'application ») : invisible ; la renommer referait apparaître la
  bannière chez tous ceux qui l'ont fermée.
- **Nom de cache du service worker** `sme-os-shell-v1` : invisible, aucun gain.
- **Exemple de nom de bot** `smeos_partenaires_bot` (commentaire de `env.ts` et
  `.env.example`).
- **Migrations SQL** : historique appliqué (commentaires, dont un `comment on
  table` de `0015`) — on ne réécrit pas une migration déjà exécutée.
- **Rapports et notes historiques** (`RAPPORT_*.md`, `NOTES_*.md`,
  `COMPARAISON_MASTER_PROMPT.md`, `docs/RELEASE_NOTES_2026-09-16.md`) : instantanés
  datés.
- **`docs/MVP_SCOPE.md`, ligne 7** : « audit master prompt SME-OS » désigne un
  document nommé, pas le produit.

### Vérification (après ce passage)

`typecheck` 0 erreur ; `lint` 0 erreur (même warning préexistant) ; **665/665
tests** ; **build 83/83 pages** (stub de polices temporaire, restauré à
l'identique) ; aucune occurrence de `https://sme-os.app` dans la sortie du build.
Aucun test ne dépendait des chaînes renommées (un mock de `onboarding-service.test.ts`
a été renommé de façon cohérente).

