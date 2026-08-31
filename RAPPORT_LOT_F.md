# Rapport — Lot F : Groupes WhatsApp & diffusion groupée

## 1. Ce qui a été fait

### Vérification API (avant tout code — cahier, point de vigilance n°1)

Les 3 questions posées par le cahier ont été vérifiées sur
`docs.zernio.com` (31 août 2026), jamais devinées. Détail complet et
citations dans **`docs/ZERNIO_INTEGRATION.md`, section "Groupes
WhatsApp"**. Résumé :

| Question du cahier | Verdict |
|---|---|
| Lister les groupes | **SUPPORTÉ** — `GET /whatsapp/wa-groups`, paginé. Ne renvoie que `{id, subject, createdAt}` (pas de nombre de participants). Indisponible en mode Coexistence. |
| Envoyer un message dans un groupe | **PARTIEL, jamais à froid** — passe par l'API Inbox standard (`conversationId`), mais celui-ci n'est créé "automatiquement" par Zernio que **quand un message de groupe est REÇU**. Aucun cold-start documenté pour un groupe. |
| Webhook événements de groupe (nouveaux membres...) | **NON SUPPORTÉ** — absent de la liste complète des événements webhook Zernio. |

Conséquence assumée dans tout le code ci-dessous : la diffusion est câblée
**de bout en bout** (modèle de données, quota, UI, cron, retry) mais ne
peut pas réellement délivrer tant qu'un futur lot ne branche pas la
réception des messages de groupe (explicitement **hors scope** du cahier
Lot F) pour peupler `whatsapp_groups.zernio_conversation_id`. Chaque cible
échoue alors avec un message clair plutôt qu'un faux succès simulé —
c'est le comportement demandé explicitement par le cahier pour ce cas de
figure ("construisez quand même le modèle de données... n'inventez pas un
faux envoi qui semblerait fonctionner").

### Fichiers créés

- `supabase/migrations/0018_whatsapp_groups.sql` — 4 tables
  (`whatsapp_groups`, `group_broadcasts`, `group_broadcast_targets`,
  `group_broadcast_products`), RLS standard, index, triggers `updated_at`.
- `src/application/services/whatsapp-group-service.ts` — cœur métier :
  lecture/connexion/déconnexion/synchronisation des groupes, création/
  annulation/relance de diffusions, traitement cron. Voir l'en-tête du
  fichier pour le rappel de la contrainte API.
- `src/application/services/whatsapp-group-service.test.ts` — 13 tests.
- `src/app/api/cron/process-broadcasts/route.ts` — point d'entrée cron
  externe (protégé par `CRON_SECRET`).
- `src/app/dashboard/groups/page.tsx` — UI complète (groupes connectés,
  groupes disponibles à connecter, formulaire de diffusion, historique).
- `src/app/dashboard/groups/broadcasts/[id]/page.tsx` — détail d'une
  diffusion (statut par groupe ciblé, message d'erreur explicite).

### Fichiers modifiés

- `src/domain/ports/messaging-provider.ts` — ajout de `WhatsAppGroupSummary`
  et de `listWhatsAppGroups?()` (méthode **optionnelle** sur le port : tous
  les providers n'ont pas de notion de "groupe").
- `src/infrastructure/providers/messaging/zernio/{types,client,adapter}.ts`
  — implémentation réelle de la lecture des groupes (pagination par
  curseur, retry léger sur 5xx uniquement, jamais sur 4xx).
- `src/application/services/plans-repository.ts` — `countOrganizationRows`
  accepte un 3e paramètre optionnel `statusIn` (rétrocompatible : aucun
  autre appelant ne le passe, comportement inchangé en son absence).
- `src/application/services/entitlements-service.ts` —
  `CUMULATIVE_TABLE_BY_KEY` associe désormais `whatsapp_groups` à
  `activeStatuses: ["connected"]` (voir "Hypothèses" ci-dessous).
- `src/application/services/entitlements-service.test.ts` — assertion
  mise à jour pour refléter ce nouvel appel (documenté inline).
- `src/lib/env.ts`, `.env.example` — `CRON_SECRET` (optionnel).
- `src/app/dashboard/layout.tsx` — lien de navigation "Groupes WhatsApp".
- `docs/ZERNIO_INTEGRATION.md`, `docs/DEPLOYMENT.md`, `docs/DATABASE.md` —
  documentation à jour (section groupes, procédure cron, schéma).

## 2. Ce qui a été vérifié/testé

- **`npx tsc --noEmit`** : ✅ aucune erreur, sur l'ensemble du projet
  (pas seulement les fichiers touchés).
- **`npx vitest run`** : ✅ **121/121 tests passants**, 17 fichiers — les
  13 nouveaux tests de `whatsapp-group-service.test.ts` couvrent :
  - le critère d'acceptation central : 10 produits × 4 groupes → **4**
    `group_broadcast_targets` (jamais 40) ;
  - la déduplication de produits/groupes envoyés en double ;
  - le refus **avant tout accès DB** pour chaque validation (produits/
    groupes vides, date passée, date invalide) ;
  - le refus IDOR si un groupe/produit ciblé n'appartient pas à l'org ou
    n'est plus connecté, sans aucune écriture ;
  - le quota `whatsapp_groups` vérifié en un seul appel atomique sur tout
    le lot de connexion, jamais N vérifications séquentielles ;
  - le no-op silencieux (pas de double comptage quota) pour un groupe déjà
    connecté ;
  - `formatGroupBroadcastMessage` (fonction pure).
  Tous les tests préexistants du projet (121 au total avant ce lot moins
  les 13 nouveaux, donc 108) passent toujours à l'identique.
- **`npx next lint`** : ✅ aucun warning/erreur.
- **`npx next build`** : ❌ **échoue dans cet environnement précis**, mais
  uniquement à cause du sandbox réseau qui bloque `fonts.googleapis.com`
  (Next essaie de télécharger les polices Google au build) — erreur
  strictement identique pour n'importe quelle modification, y compris
  aucune. Le `typecheck` + `lint` + `test` couvrent la correction du code;
  je vous recommande de relancer `npm run build` dans un environnement
  avec accès réseau complet avant déploiement pour lever le doute.

## 3. Hypothèses prises (à valider si elles ne conviennent pas)

1. **Connexion/déconnexion distincte de la diffusion.** Le cahier ne
   détaille pas explicitement comment un groupe passe de "visible côté
   Zernio" à "connecté" (`whatsapp_groups`). J'ai interprété
   `syncGroupsFromZernio` comme un **rafraîchissement** des groupes déjà
   connectés (cohérent avec "rafraîchir la liste connue"), et ajouté
   `listAvailableGroupsFromZernio` + `connectGroups`/`connectGroup` comme
   l'action explicite de connexion — nécessaire pour que le critère
   d'acceptation ("tente de connecter un 4e groupe... refus explicite")
   ait un point d'entrée concret. `disconnectGroup` (soft, jamais de
   suppression) complète naturellement ce cycle.

2. **`createBroadcast` ne réapplique PAS `canUseFeature("whatsapp_groups",
   groupIds.length)` comme le suggérait littéralement le cahier.** Cette
   fonction cible des groupes **déjà connectés** (donc déjà comptés au
   moment de leur connexion) — réappliquer ce contrôle avec la sémantique
   cumulative existante (`used + requested <= limit`) aurait bloqué à tort
   toute diffusion dès qu'une organisation est à son quota de groupes
   connectés, même en ciblant des groupes déjà légitimement connectés. À
   la place, `createBroadcast` vérifie que chaque groupe/produit ciblé
   **appartient réellement à l'organisation et est toujours `connected`**
   (garde IDOR/intégrité, testée). Le quota reste appliqué où il a un sens
   réel : à la connexion (`connectGroups`).

3. **`countOrganizationRows` étendu (rétrocompatible)** pour ne compter
   que les groupes `status = 'connected'` contre le quota — sinon
   déconnecter un groupe ne libérerait jamais son quota (le compteur
   générique compte historiquement TOUTES les lignes de la table). Un seul
   appelant réel existait (`entitlements-service.ts`), mis à jour en
   conséquence ; son test a été ajusté avec justification inline.

4. **Fuseau horaire unique (Afrique/Douala, UTC+1, sans heure d'été)**
   pour interpréter le champ `datetime-local` du formulaire de diffusion.
   Cohérent avec le marché cible du produit (PME camerounaises) et avec la
   simplification déjà faite ailleurs dans le projet
   (`marketing-service.ts` traite aussi ses horodatages "naïfs" avec une
   convention fixe). L'heure est explicitement labellisée "heure du
   Cameroun" dans l'UI pour éviter toute ambiguïté.

5. **Rôles autorisés** : `["owner", "admin", "manager"]` pour toutes les
   actions de ce lot (connecter/déconnecter un groupe, créer/annuler/
   relancer une diffusion) — cohérent avec les pages `products`/
   `appointments` existantes ; le cahier ne précisait pas de rôles.

6. **`/api/cron/process-broadcasts` et `CRON_SECRET` sont entièrement
   nouveaux.** Le cahier supposait un pattern de cron déjà en place pour
   les publications sociales programmées — en réalité,
   `marketing-service.ts` délègue tout le timing à Zernio lui-même
   (`POST /posts` avec `scheduledAt`), il n'existait aucun cron applicatif
   à imiter. La route et sa protection par secret partagé sont donc
   introduites par ce lot (voir `docs/DEPLOYMENT.md`, section 4bis).

7. **`participant_count` reste `NULL`** pour tous les groupes (Zernio ne
   le renvoie pas via `GET /whatsapp/wa-groups`) — colonne posée pour un
   enrichissement futur, jamais fabriquée. L'UI affiche "—" plutôt qu'un
   chiffre inventé.

## 4. TODO explicite / limites connues

- **[NOT_SUPPORTED confirmé]** Aucune diffusion vers un groupe **jamais
  contacté** ne pourra aboutir tant qu'un lot futur ne construit pas la
  réception des messages de groupe (webhook `message.received`, déjà
  générique côté Zernio) pour peupler `zernio_conversation_id` —
  explicitement hors scope de ce cahier Lot F. Le code, le schéma et l'UI
  sont prêts à l'accueillir sans nouvelle migration.
- Le nombre de participants par groupe n'est pas disponible via l'API de
  listing Zernio — si Zernio l'ajoute un jour (ou expose un endpoint
  dédié), `syncGroupsFromZernio` est le seul endroit à modifier.
- Pas de pagination UI sur l'historique des diffusions (limité aux 200
  plus récentes côté service) — suffisant en V1 pour le volume attendu
  d'une PME, à revisiter si besoin.
- `next build` non vérifié de bout en bout dans cet environnement
  (sandbox réseau sans accès à Google Fonts) — voir section 2.
