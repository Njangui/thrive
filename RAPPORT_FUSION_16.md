# Rapport de fusion #16 — fichiers modifiés du 19/09 + Freemium, sur tokoo -fusionne-15b

Fait suite à `RAPPORT_FUSION_15.md` (dont l'addendum décrit le passage
SME-OS → tokoo ). Deux archives reçues :

1. **`thrive-fichiers-modifies__1_.zip`** — 78 fichiers accompagnés d'un
   `CHANGELOG_2026-09-19.md` : correctifs (crédits IA consommés sans IA
   configurée, FAQ jamais déclenchée, notifications sans son, « Score IA » →
   « Score d'engagement »), CSP / Permissions-Policy, et nouveautés
   (messagerie : pièces jointes et messages vocaux ; **vidéos du catalogue**
   hébergées chez Zernio 7 jours ; publication Telegram/YouTube d'une vidéo ;
   page **Analytics vitrine** ; nouveau logo, cache du service worker en v2).
2. **`thrive-main-freemium.zip`** — arbre complet (515 fichiers) dont
   **18 fichiers** propres au lot **Freemium** : un plan permanent
   « Discover » (gratuit) remplace la période d'essai ; grille Discover /
   Starter (15 000 FCFA) / Pro (30 000 FCFA).

## Méthode

**Fichiers modifiés.** Aucune base n'était fournie. J'ai comparé chaque fichier
reçu aux trois versions que je pouvais reconstituer (fusion #13 d'origine, zip
de la fusion #14, arbre actuel) : la version dont il s'écarte le moins est
**systématiquement celle du zip de la fusion #14** (exemple : les pages
d'édition produit/service s'en écartent de 10–11 lignes, contre 54 pour l'arbre
actuel et 129–282 pour la fusion #13). Ces fichiers ont donc été produits **à
partir de `tokoo -fusionne-14.zip`**, sans les correctifs de redirection ni la
2ᵉ livraison Catalogue V2 de #15. Base des fusions à trois voies = ce zip.

**Freemium.** L'archive contient le lot WhatsApp Coexistence déjà fusionné en
#15 ; base = l'archive WhatsApp (reconstituée en #15), ce qui isole exactement
les 18 fichiers Freemium.

Les deux livraisons touchent des **fichiers disjoints** (intersection vide).
Outil : `git merge-file`, fichier par fichier, statut consigné.

| Livraison | Repris tels quels (ours = base) | Fusion 3 voies sans conflit | Conflits | Nouveaux | Autres |
|---|---|---|---|---|---|
| Modifiés du 19/09 (78) | 38 | 9 | **0** | 22 | 7 binaires (logo), 2 migrations |
| Freemium (18) | 13 | 4 | **0** | — | 1 migration |

Aucun conflit textuel. **Le contrôle a donc porté sur le sens**, pas sur le
texte — voir « Vérifications d'interaction ».

## Numérotation des migrations

`0058` (mêmes numéros que WhatsApp Coexistence) et `0056` (déjà Catalogue V2)
collisionnent à nouveau. Ordre retenu (les trois sont indépendantes entre elles,
sauf que `0060` cite la table de `0059`) :

| Numéro | Fichier | Origine |
|---|---|---|
| 0055 | `telegram_publications` | Telegram v3 (#13) |
| 0056 · 0057 | `service_images_and_specifications` · `promotion_deadline` | Catalogue V2 (#14) |
| 0058 | `whatsapp_coexistence_dedicated_numbers` | WhatsApp (#15) |
| **0059** | `catalog_videos` | ex-`0058` de la livraison du 19/09 |
| **0060** | `landing_analytics` | ex-`0059` de la livraison du 19/09 |
| **0061** | `freemium_plan` | ex-`0056` de Freemium |

Les références dans le code, les docs et les en-têtes SQL sont mises à jour
(motif `(?<!\d)…(?!\d)`, qui couvre aussi `0055_xxx` — l'erreur de #14 ne se
reproduit pas) ; contrôle final par `grep` : aucune référence obsolète.

## Vérifications d'interaction

- **`MediaType`** (`media-service.ts`) : les trois lots ajoutent chacun une
  valeur — `service` (Catalogue V2), `telegram-inbox` (Telegram v3),
  `message-attachment` (pièces jointes). Les trois sont présentes.
- **`notification-service.ts`** : les routes de #13 (`telegram_publication`),
  #15 (`phone_number`) et les modifications du 19/09 coexistent ; le test
  `notification-service.test.ts` de #15 passe toujours.
- **Publication vers un groupe WhatsApp** (`omnichannel-publication-service.ts`) :
  malgré les modifications du 19/09 sur ce fichier, l'envoi immédiat passe
  toujours par `getWhatsAppGroupsProvider` (correction de #15) ; son test passe.
- **Contrainte SQL `analytics_events_event_type_check`** (`0060`) : la migration
  la recrée avec une liste fermée ; c'est le genre d'endroit où un type
  d'événement oublié serait refusé *silencieusement* (`trackEvent` ne lève
  jamais). Vérifié : les 9 valeurs SQL sont exactement celles de
  `ANALYTICS_EVENT_TYPES` (`analytics-service.ts`) ; aucune autre migration ne
  touche cette contrainte. Le lien est documenté dans `docs/DATABASE.md`.
- **Freemium — insertions d'entitlements** : `plan_entitlements.entitlement_key`
  est un `text` libre (pas d'enum, `0012`) et `plan_key` référence `plans(key)`
  après élargissement de `plans_key_check` : les clés insérées (dont `whatsapp`)
  ne peuvent pas être refusées par une contrainte existante.
- **Freemium — retrait du réglage « durée d'essai »** (`admin/addons`) : ne
  retire pas le formulaire du prix du numéro dédié (WhatsApp), qui reste.
- **Crédits IA** : Discover a `ai_credits = 0`. `generateAIReply`
  (`ai-response-service.ts`, livraison du 19/09) vérifie désormais la
  disponibilité de l'IA **avant** de réserver un crédit (constaté dans le code) ;
  d'après le changelog reçu, FAQ et catalogue restent actifs après une escalade
  « IA indisponible » (non relu en détail). Les deux lots vont dans le même sens.
- **`/api/notifications/unread`** (nouvelle route, interrogée toutes les ~20 s) :
  authentifiée par la session, organisation tirée des adhésions de l'utilisateur,
  aucune donnée acceptée de l'appelant.
- **Marque** : aucun nouveau « SME-OS » introduit par les deux livraisons.

## Décisions et points à connaître

1. **FAQ de la landing corrigée.** `marketing-landing.tsx` répondait à « Puis-je
   essayer avant de payer ? » par « une période d'essai gratuite » — faux depuis
   Freemium. Nouvelle réponse : offre gratuite Discover, sans limite de durée ni
   carte bancaire, passage au payant quand nécessaire. Modifiable à volonté.
2. **Vestiges de l'essai** (CGU, console admin) : traités dans un second temps,
   à votre demande — voir l'addendum en fin de rapport.
3. **Limites de plan non appliquées.** L'en-tête de `0061` le dit lui-même :
   canaux/bots Telegram, comptes YouTube multiples, taille d'équipe, quota de
   catalogue, réponse auto aux commentaires… n'ont pas de clé d'entitlement ni
   d'application dans le code. Constaté en plus : aucune des nouveautés du 19/09
   (vidéos de catalogue, analytique vitrine, pièces jointes) ne contient de
   contrôle de plan — elles sont ouvertes à Discover comme aux paliers payants.
   C'est la conséquence du périmètre des lots, pas de la fusion.
4. **Commentaire obsolète corrigé** dans `platform-settings-service.ts`
   (`trial_days` n'est plus lu ; une éventuelle ligne en base est inoffensive).
5. **Non repris de l'archive Freemium** : `package-lock.json` et
   `tsconfig.tsbuildinfo` (`package.json` est inchangé de son côté).
6. **`CHECK_MIGRATIONS_0055_0058.sql` remplacé** par
   `CHECK_MIGRATIONS_0055_0061.sql` (lecture seule ; ajoute `0059`, `0060` — y
   compris la vérification que `video_play` est autorisé par la contrainte — et
   `0061`). Les rapports #14 et #15 pointent vers le nouveau nom.
7. **Cache du service worker** : `sme-os-shell-v2` (fourni par la livraison ;
   nom interne invisible, purge automatique des anciens caches — non renommé).

## ⚠️ `0061_freemium_plan.sql` est une migration de DONNÉES

Elle ne se contente pas d'ajouter un plan : **toutes les organisations
`trialing` basculent en `free` / `active` de façon permanente**, celles sur
l'ex-palier `business` retombent sur `starter`, et les prix Starter/Pro sont
réécrits (15 000 / 30 000 FCFA). Non réversible sans sauvegarde. **À relire et à
appliquer après une sauvegarde de la base**, jamais « pour voir ».

## Vérification

- `npm run typecheck` : 0 erreur.
- `npm run lint` : 0 erreur (1 warning préexistant, `no-img-element`, désormais
  à la ligne 87 de `omnichannel-publication-composer.tsx`).
- `npm run test` : **724/724 tests verts**, 64 fichiers (665 en #15b : +59 venant
  des deux livraisons — `catalog-video-service`, `landing-analytics-service`,
  `message-attachment-service`, `remote-media`, adaptateur Telegram, FAQ,
  handoff, orchestrateur, crédits IA, plans, entitlements, onboarding…). Le test
  garde-fou des redirections passe : aucun `redirect()` avalé dans les fichiers
  apportés.
- `npm run build` : **84/84 pages générées**, succès (83 en #15b). Même
  procédure que précédemment : `next/font/google` est stubé temporairement
  (pas d'accès à Google Fonts dans le bac à sable), fichiers restaurés à
  l'identique avant livraison.
- Diff contre l'arbre d'avant #16 : 28 fichiers nouveaux (dont ce rapport), 75
  modifiés, 1 remplacé (le SQL de contrôle renommé).

## Non vérifié

- **Aucune exécution contre une vraie base** : `0059`, `0060`, `0061` (et
  `0055`–`0058`) n'ont été appliquées à aucun Postgres.
- **Rien n'a tourné en conditions réelles** : envoi de fichiers du navigateur vers
  Zernio (CORS / CSP `connect-src`, nouvelle `media-src`), messages vocaux vers
  WhatsApp/Telegram (`microphone=(self)`), publication Telegram d'une vidéo par le
  cron, lecture d'une vidéo de catalogue, son des notifications, page Analytics
  vitrine. Le changelog reçu le signale lui-même (« À faire à la main »).
- Le parcours d'inscription en freemium (création de la souscription `free`) et
  l'affichage des paliers (`/tarifs`, `/dashboard/subscription`) n'ont été
  validés que par la compilation, les tests unitaires et le build.

## À faire à la main (repris du changelog reçu)

- Remettre à zéro `used_credits` (table `ai_credit_balances`) pour rembourser
  les crédits IA consommés à tort avant le correctif.

## Ordre de mise en ligne recommandé

1. Exécuter `supabase/CHECK_MIGRATIONS_0055_0061.sql` (lecture seule).
2. **Sauvegarder la base.**
3. Appliquer, dans l'ordre, uniquement les migrations dont la colonne vaut
   `false` : `0055` → … → `0061`. Relire `0061` avant.
4. Déployer le code.
5. Programmer le cron `/api/cron/process-phone-number-renewals` (voir #15).
6. Vérifier `NEXT_PUBLIC_APP_URL` et `EMAIL_FROM_ADDRESS` (voir l'addendum de #15).

Livré en zip du projet complet (`node_modules`, `.next` et
`tsconfig.tsbuildinfo` exclus).

---

## Addendum — alignement sur le freemium (version `16b`)

Vos deux réponses : **(1)** les erreurs de la vitrine et de `/dashboard/marketing`
sont déjà réglées de votre côté — rien à modifier dans le code ; le SQL de contrôle
sert toujours à savoir lesquelles des migrations `0058`–`0061` restent à appliquer.
**(2)** « aligne » : les vestiges de l'essai (CGU, console admin) sont alignés sur le
freemium. En les parcourant, j'ai trouvé **quatre défauts réels** du périmètre Freemium
(présents dans l'archive reçue, pas introduits par la fusion) ; ils sont corrigés.

### Défauts trouvés et corrigés

1. **Aucun nouveau pays ne pouvait plus être activé.** La checklist d'activation
   (`admin-countries-service.ts`) refuse un pays dont un plan a encore son « prix par
   défaut » (`source = fallback_default`). Or le plan gratuit n'a **jamais** de ligne de
   prix par pays (`upsertCountryPrice` le refuse : il reste à 0 partout) — sa source est
   donc toujours `fallback_default` : « Prix non configurés pour : free » bloquait toute
   activation. Le plan gratuit est exclu du contrôle. Deux tests ajoutés ; vérifié par
   mutation qu'ils **échouent** avec l'ancien comportement. Sans effet sur les pays déjà
   actifs (la checklist ne s'applique qu'à l'activation).
2. **Le compteur « Abonnées (hors starter) » comptait l'inverse de la réalité.** Sa
   règle historique, `plan ≠ starter`, supposait que Starter était le plan d'entrée
   (pendant l'essai). Avec `free` comme plan d'entrée, il comptait les organisations
   **gratuites** comme abonnées et **ignorait les clients Starter**, qui paient.
   Nouvelle règle, extraite en fonction pure testée (`summarizeSubscriptions`, 7 tests) :
   abonnée = abonnement **actif** sur un plan **payant** (un `past_due` ou `cancelled` ne
   compte plus : le chiffre dit qui paie maintenant). La carte « En période d'essai »
   devient « Offre gratuite » ; le donut passe de Actives / En essai / Suspendues /
   Autres à **Offre payante / Offre gratuite / Suspendues / Autres** (toujours
   mutuellement exclusif, somme = nombre d'organisations).
3. **Le cron d'échéances chargeait toutes les lignes du plan gratuit** à chaque passage
   (elles n'ont pas d'échéance et sont désormais la majorité), et les comptait dans
   `skipped`. Le plan gratuit est exclu dès la requête (`.neq("plan_key", "free")`).
   Le message d'expiration ne parle plus de « période d'essai » : « Votre abonnement est
   arrivé à échéance sans paiement. Renouvelez-le depuis Mon abonnement pour conserver
   votre offre, ou repassez à l'offre gratuite. » Deux tests ajoutés (filtre + message).
4. **Le seed de démo créait un abonnement « business »**, palier retiré du modèle actif
   (`0061` le ramène à `starter`) avec des dates d'essai. Il crée maintenant un abonnement
   **Pro** actif, sans dates d'essai, avec une échéance à 30 jours.

### Alignements

- **CGU, §3** : « Période d'essai, abonnement et paiement » devient « Offre gratuite,
  abonnements et paiement » — offre gratuite sans limite de durée ni carte bancaire,
  fonctionnalités par offre renvoyées à la page tarifs, retour possible à l'offre
  gratuite à tout moment. Les `[À COMPLÉTER — …]` d'origine sont conservés (périodicité
  des abonnements) et un nouveau est ajouté pour les conséquences d'un défaut de
  paiement. **C'est un brouillon rédigé par un développeur, pas un avis juridique : à
  faire relire.** « Dernière mise à jour : [À COMPLÉTER — date] » est laissé tel quel.
- **Console admin — liste des entreprises** : le badge dit « Offre gratuite » (et non
  « Abonnement actif ») pour le plan gratuit ; le plan s'affiche par son **nom** au lieu
  de sa clé ; « Essai jusqu'au : — » (toujours vide en freemium) devient « Échéance » :
  « Aucune (offre gratuite) » ou la date de fin de période pour un abonnement payant.
  Libellés dans `src/lib/subscription-display.ts` (8 tests). Le statut `trialing`
  s'affiche « Essai (hérité) ».
- **Docs** : `docs/PRICING_MODEL.md` réécrit (l'ancienne grille Starter 9 900 / Business
  19 900 / Pro 39 900 avec essai était fausse) : principe freemium, grille réelle de
  `0061`, prix par pays réservés aux plans payants, limites non appliquées ;
  `docs/country-engine.md` corrigé (checklist d'activation).

### Volontairement inchangé

- **Repli « sans ligne d'abonnement → starter / `trialing` »** (`plans-repository.ts`,
  copié en batch dans les services admin) : c'est du comportement d'**entitlements**,
  pas un libellé, et le lot Freemium l'a conservé. Conséquence à connaître : une
  organisation sans aucune ligne d'abonnement (créée avant Lot B) obtient les droits
  Starter sans payer. Il n'en existe probablement pas ; pour le vérifier, requête en
  lecture seule :
  `select count(*) from organizations o left join organization_subscriptions s on s.organization_id = o.id where s.organization_id is null;`
- Le traitement des lignes `trialing` héritées (cron, types, libellés) : conservé tant
  qu'une telle ligne peut exister ; la colonne `trial_end` reste en base pour
  l'historique (commentaire de `0061`). La ligne `trial_days` de `platform_settings`,
  si elle existe, est inoffensive.
- Les CTA « Commencer gratuitement » / « Essayer gratuitement » : cohérents avec une
  offre gratuite permanente.

### Vérification (après l'alignement)

`typecheck` 0 erreur ; `lint` 0 erreur (même warning préexistant) ; **743/743 tests**,
66 fichiers (724 + 19 : 2 pays, 7 vue globale, 8 libellés, 2 cron) ; **build 84/84
pages** (stub de polices temporaire, restauré à l'identique).

### Non vérifié

Les écrans admin modifiés (cartes, donut, liste des entreprises) n'ont pas été vus dans
un navigateur ; le choix de compter comme « abonnée » uniquement une organisation à
abonnement **actif** est une décision de ma part (modifiable dans
`summarizeSubscriptions`) ; le texte des CGU est un brouillon.

