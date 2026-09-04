# Rapport — Lot L : Équipe, configuration IA, écrans CRM & commandes

## 1. Ce qui a été fait

### Partie 1 — Gestion d'équipe

- **`domain/ports/email-provider.ts`** — nouveau port (aucun fournisseur
  d'email n'existait, confirmé par `00_CONVENTIONS_COMMUNES_V3.md`).
- **`infrastructure/providers/email/resend/{types,client,adapter}.ts`** —
  intégration Resend **vérifiée sur `resend.com/docs`** (base URL, auth
  `Bearer`, payload `POST /emails`, forme des erreurs) avec la même
  rigueur que Zernio/NotchPay — voir `docs/EMAIL_INTEGRATION.md`, qui
  documente aussi une limitation opérationnelle réelle et confirmée :
  sans domaine vérifié dans le compte Resend, seule l'adresse du
  titulaire du compte peut recevoir un email (`*@resend.dev`).
- **`infrastructure/providers/email/console-log/adapter.ts`** — repli
  explicite (jamais un crash, jamais un faux succès) quand
  `RESEND_API_KEY` est absente.
- **`registry.ts::getEmailProvider()`** — sélectionne l'un ou l'autre.
- **`supabase/migrations/0033_team_invitations.sql`** — table
  `team_invitations`, token 256 bits, index partiel garantissant une
  seule invitation `pending` par (org, email), RLS owner/admin.
- **`application/services/team-service.ts`** — `inviteMember`,
  `acceptInvitation`, `listMembers`, `listPendingInvitations`,
  `revokeInvitation`, `updateMemberRole`, `removeMember`.
- **`/dashboard/team`** (nouveau) + **`/invite/accept`** (nouveau, hors
  dashboard) + modifications de **`/login`** et **`/auth/callback`** pour
  que le flux d'acceptation fonctionne réellement de bout en bout pour un
  utilisateur qui n'a pas encore de compte (voir section 3, point 2).

### Partie 2 — Configuration IA

- **`application/services/ai-config-service.ts`** — `getAiConfig`,
  `updateAiConfig`. Valide `provider`/`fallback_provider` contre
  `AI_PROVIDER_NAMES` (nouvelle constante exportée de `registry.ts`,
  source unique de vérité, utilisée à la fois par la validation et par le
  menu déroulant de l'UI).
- **`/dashboard/ai`** (nouveau) — vocabulaire non technique
  ("Qui répond aux clients", "Longueur maximale des réponses"...) ;
  `model` n'est PAS un champ éditable (voir section 3, point 3).

### Partie 3 — Écrans CRM & commandes

- **`lead-service.ts`** — ajout de `listLeadsForOrg` (pagination
  `.range()`, filtre par statut) et `updateLeadStatus` (action rapide de
  l'écran, journalise un `lead_events` de type `STATUS_CHANGED`).
- **`order-service.ts`** — ajout de `listOrdersForOrg` (même pattern) et
  `getOrderDetail` (`order_items` + total + client).
- **`/dashboard/leads`** (nouveau) — liste paginée, filtre par statut
  (onglets), score IA affiché, changement de statut en ligne.
- **`/dashboard/orders`** (nouveau) + **`/dashboard/orders/[id]`**
  (nouveau, détail) — liste paginée, filtre par statut, et actions
  "Marquer comme terminée"/"Annuler" réutilisant
  `markOrderCompleted`/`cancelOrder` (déjà construits, jamais exposés
  dans aucune UI avant ce lot).

### Nav

`dashboard/layout.tsx` : "Clients", "Commandes", "Assistant IA", "Équipe"
ajoutés.

## 2. Ce qui a été vérifié/testé

- **`npx tsc --noEmit`** : ✅ 0 erreur sur l'ensemble du projet.
- **`npx vitest run`** : ✅ **262/262 tests passants**, 30 fichiers — les
  227 tests annoncés comme état de départ (cahier V3) + **35 nouveaux**
  répartis sur 4 fichiers :
  - `team-service.test.ts` (15 tests) : refus du rôle owner par
    invitation ; invitation créée même si l'email échoue (jamais
    bloquant) ; révocation de l'ancienne invitation pending avant d'en
    créer une nouvelle ; `acceptInvitation` refuse accepted/revoked/
    expirée (et marque bien `expired` en base) ; chemin nominal complet ;
    **un Admin ne peut jamais toucher un Owner** (`updateMemberRole` ET
    `removeMember`) ; protection du dernier Owner ; résolution d'email
    tolérante aux pannes de l'API Admin.
  - `ai-config-service.test.ts` (8 tests) : refus provider/fallback
    inconnu, refus fallback == provider, refus température/longueur hors
    bornes, dérivation correcte du modèle, plafond à 10 objectifs.
  - `lead-service.test.ts` (7 tests) : pagination `.range()`, filtre par
    statut, mapping du contact, idempotence de `updateLeadStatus`.
  - `order-service.test.ts` (5 tests) : pagination, mapping, détail avec
    articles, `NotFoundError` si absente.
- **`npx next lint`** : ✅ aucun warning/erreur.
- **`npx next build`** : ❌ échoue dans cet environnement précis,
  identique au constat déjà fait pour le Lot F — le sandbox réseau bloque
  `fonts.googleapis.com`, sans rapport avec le code de ce lot (erreur
  strictement liée à `next/font`, avant toute compilation applicative). À
  relancer dans un environnement avec accès réseau complet.

## 3. Décisions et corrections notables

1. **`LEAD_STATUSES` réels, pas ceux du cahier.** Le cahier citait
   `new/contacted/interested/customer/lost`, qui ne correspond à AUCUNE
   valeur de l'enum `lead_status` réellement défini en base
   (`0003_crm.sql` : `visitor, lead, qualified, opportunity, customer,
   lost`). Vérifié contre la migration, pas deviné — `/dashboard/leads`
   utilise l'enum réel.

2. **Le flux d'acceptation d'invitation ne fonctionnait pas "tel quel"
   pour un nouvel utilisateur — corrigé, pas juste construit en
   isolation.** `acceptInvitation(token, userId)` seule ne suffit pas :
   `/auth/callback` redirigeait TOUJOURS vers `/onboarding` pour un
   utilisateur sans organisation, ce qui aurait fait créer sa PROPRE
   organisation à un utilisateur invité au lieu de rejoindre celle qui
   l'a invité. Corrigé en bout en bout : `/login` accepte et propage un
   `next`, `/auth/callback` le relit (validé contre l'open-redirect :
   chemin relatif uniquement) et redirige en priorité vers
   `/invite/accept?token=...`. Sans ce correctif, la fonctionnalité
   "inviter quelqu'un" aurait semblé marcher en test isolé mais aurait
   échoué pour son cas d'usage principal (une personne qui n'a jamais eu
   de compte) — exactement le genre de rendu partiel que le cahier V3
   demande d'éviter.

3. **`model` n'est jamais un champ de formulaire.** Le cahier interdit
   d'afficher "model" brut mais ne dit pas explicitly s'il faut le
   masquer ou le traduire. Choix : le dériver automatiquement du
   provider choisi via `DEFAULT_MODEL_BY_PROVIDER` (nouvelle constante,
   `registry.ts`, seule source de vérité), cohérent avec la philosophie
   déjà présente dans `claude-adapter.ts`/`mistral-adapter.ts`
   ("ne pas figer un nom de modèle en dur ici, les noms de modèles
   évoluent") — évite de demander au commerçant de choisir entre des
   identifiants de modèles qu'il n'a aucune raison de connaître.

4. **Bug latent corrigé dans `registry.ts::getAIProvider`** (pré-existant,
   hors du périmètre littéral du cahier, mais rendu atteignable PAR ce
   lot) : le provider de secours réutilisait `config.model` — le modèle
   du provider PRINCIPAL — au lieu d'un modèle de sa propre famille.
   Invisible tant qu'aucune UI ne permettait de configurer un
   `fallback_provider` différent du principal (seule voie possible avant
   ce lot : SQL direct). `/dashboard/ai` rend ce cas courant ; corrigé
   pour utiliser `DEFAULT_MODEL_BY_PROVIDER[fallback_provider]`.

5. **`countOwners`/protection du dernier Owner** — extension au-delà du
   texte littéral du cahier ("un Admin ne peut jamais toucher un Owner")
   mais servant directement son intention : empêche AUSSI un Owner de se
   retirer/rétrograder lui-même s'il est le dernier, ce qui rendrait
   l'organisation orpheline. `updateMemberRole` et `removeMember`
   vérifient tous deux ce cas.

6. **`requireMembership` appelé dans les Server Actions, pas dans
   `team-service.ts`** — cohérent avec la convention déjà établie
   (Lot F, `whatsapp-group-service.ts`) plutôt qu'une double vérification
   dupliquée. Seule la règle "rôle de la CIBLE" (owner intouchable par un
   admin), qui a besoin d'une lecture DB que l'appelant n'a pas, vit dans
   le service.

7. **Objectifs IA en zone de texte (une ligne = un objectif)**, pas une
   liste dynamique avec boutons ajouter/supprimer en JS. Interprétation
   raisonnable de "liste éditable de phrases" — reste 100% server-rendered
   sans state client, cohérent avec le reste du dashboard.

## 4. TODO explicite (nécessite un accès réel à un compte de production)

- **Resend** : `RESEND_API_KEY` + domaine vérifié + `EMAIL_FROM_ADDRESS`
  à configurer avant que les invitations partent réellement vers un
  destinataire arbitraire (voir `docs/EMAIL_INTEGRATION.md`, section
  "Avant la mise en production"). Jusque-là, le lien d'invitation reste
  garanti et affiché pour un partage manuel — la fonctionnalité n'est pas
  bloquée, seule la commodité "email automatique" l'est.
- **`next build`** non vérifié de bout en bout dans cet environnement
  (sandbox réseau sans accès à Google Fonts) — voir section 2.
