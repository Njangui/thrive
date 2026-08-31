# Rapport de livraison — Lot B : Plans, Entitlements & Feature Gating

## 1. Écarts constatés entre le cahier des charges et le code livré

Avant d'écrire du code, vérification systématique de l'existant (règle
`00_CONVENTIONS_COMMUNES.md`, section "Intégration entre équipes
parallèles"). Deux écarts importants trouvés :

### 1.1 Le système de crédits IA n'existe pas dans le code fourni

Le cahier Lot B affirme : *"Un système de crédits IA est déjà construit
et fonctionnel : `supabase/migrations/0012_ai_credits.sql` (...) +
`ai-credits-service.ts` (...). Déjà branché dans `ai-response-service.ts`
(...) et `conversation-orchestrator.ts` (...). Ne recréez pas ce
système."*

Vérifié par recherche exhaustive (`grep -rni "credit"` sur tout le
dépôt, `ls supabase/migrations/` — dernière migration existante :
`0010_marketing_social_publishing.sql`) : **rien de tout cela n'existe**.
`ai-response-service.ts` (43 lignes) ne contient aucune logique de
crédits ; `conversation-orchestrator.ts` n'a pas de raison d'escalade
`ai_credits_exhausted` dans son schéma `HandoffReasonSchema`.

**Décision prise** : recréer un socle réel (migration + service), pas un
stub muet, car `canUseFeature('ai_credits', ...)` — la fonction centrale
demandée par ce lot — en dépend structurellement pour être autre chose
qu'un mock. Documenté en tête de chaque fichier concerné.

**Ce qui n'a volontairement PAS été fait** (hors périmètre Lot B, cf.
section "Enforcement" du cahier qui ne demande d'exemple d'intégration
que dans `marketing-service.ts`) : brancher le blocage réel dans
`ai-response-service.ts`/`conversation-orchestrator.ts`, ni ajouter
`ai_credits_exhausted` à `HandoffReasonSchema` (domain, fichier partagé
— risque de conflit avec l'équipe qui possède réellement ces fichiers,
probablement le "Lot A" évoqué comme partageant le contrat
`canUseFeature`). **Recommandation** : l'équipe qui possède
`ai-response-service.ts` doit appeler `hasCreditsAvailable(orgId)` avant
d'invoquer l'IA et `consumeCredit(orgId)` après une réponse réussie —
les deux fonctions existent et sont testées.

### 1.2 Le "master prompt produit" (doc 2) n'a pas été fourni

Le cahier demande de reprendre "les limites exactes du master prompt,
section 34" et l'UX exacte de la "section 78". Seuls
`00_CONVENTIONS_COMMUNES.md`, `02_LOT_B_plans_entitlements.md` et le
code source ont été transmis. `docs/GAP_ANALYSIS.md` du projet confirme
l'existence de ce document ("le scaffold déjà construit sous le 1ᵉʳ
master prompt...") mais ne le contient pas.

**Décision prise** : plutôt que d'inventer des chiffres présentés comme
officiels, utiliser des **valeurs placeholder clairement marquées**
(commentaires `⚠️` en tête de migration), regroupées dans un seul bloc
SQL pour qu'un remplacement soit un diff d'une seule section. **Ne pas
merger le seed placeholder en production sans validation.**

| Clé                  | Starter | Business | Pro        |
|----------------------|--------:|---------:|-----------:|
| `whatsapp_groups`    | 3       | 10       | -1 (illimité) |
| `broadcast_contacts` | 50      | 100      | 200        |
| `ai_credits`         | 150     | 500      | 1500       |
| `social_accounts`    | 1       | 3        | 6          |
| `facebook_messenger` | 0       | 1        | 1          |
| `instagram_messages` | 0       | 1        | 1          |
| `linkedin`           | 0       | 0        | 1          |
| `tiktok`             | 0       | 0        | 1          |

Prix (`price_fcfa`) : Starter 0 / Business 15000 / Pro 35000 —
également placeholder. La page `/dashboard/subscription` a été écrite
sans connaître le texte exact de la section 78 ; structure et
vocabulaire non technique respectés, mais la copie exacte reste à
comparer au master prompt.

## 2. Ce qui a été construit

### Schéma (`supabase/migrations/`)
- `0011_ai_credits.sql` — `ai_credit_balances`, `ai_usage_events` (+RLS).
  Numéroté 0011 et non 0012 comme dans le cahier : le code livré
  s'arrête à 0010 (pas de 0011-0013 déjà pris), renumérotation autorisée
  par la convention commune en cas de collision à la fusion.
- `0012_plans_entitlements.sql` — `plans`, `plan_entitlements`,
  `organization_subscriptions` (+RLS +seed placeholder).

### Application (`src/application/services/`)
- **`plans-repository.ts`** (nouveau) — accès bas niveau partagé entre
  `entitlements-service.ts` et `ai-credits-service.ts` (évite un import
  circulaire entre les deux, cf. §3). Ne lève jamais pour une ligne
  absente.
- **`ai-credits-service.ts`** (nouveau, cf. §1.1) — `getCreditStatus`,
  `hasCreditsAvailable`, `consumeCredit`, `initializeCreditBalance`,
  `grantCredits`, signatures conformes au cahier.
- **`entitlements-service.ts`** (nouveau) — `canUseFeature(organizationId,
  entitlementKey, requestedAmount = 1)`, signature exacte du cahier.
  `evaluateEntitlement()` exportée séparément (fonction pure) pour un
  test exhaustif sans DB.
- **`subscription-service.ts`** (nouveau) — agrège l'usage
  (`canUseFeature` sur les 8 clés) pour le dashboard ; une seule source
  de vérité entre ce que voit le commerçant et ce qui est appliqué.
- **`onboarding-service.ts`** (modifié) — `createOrganization` crée
  désormais l'abonnement `starter`/`trialing`/14 jours puis initialise
  les crédits IA depuis ce plan.
- **`marketing-service.ts`** (modifié) — exemple d'enforcement demandé
  par le cahier : `createCampaignFromProducts` vérifie `social_accounts`
  (nombre de comptes distincts ciblés par la campagne) **avant tout
  accès DB**. Absence de ligne `plan_entitlements` = illimité (ne casse
  pas les tenants de démo).

### UI (`src/app/dashboard/`)
- **`subscription/page.tsx`** (nouveau) — jauges d'usage, checklist de
  fonctionnalités, countdown d'essai, comparaison des 3 plans.
  Vocabulaire non technique.
- **`layout.tsx`** (modifié, +1 ligne) — ajout du lien de navigation
  "Mon abonnement".

### Erreurs (`src/lib/errors.ts`, modifié)
- Ajout de `QuotaExceededError` (403, kind `"quota"`), extension
  additive du type `kind` — vérifié qu'aucun `switch`/comparaison
  exhaustive sur `kind` n'existe ailleurs dans le code (donc aucun
  risque de casser une exhaustivité TypeScript existante).

### Choix de conception notables
- **`social_accounts` n'est pas cumulatif.** Il n'existe aucune table
  "comptes sociaux connectés" dans le code fourni (`provider_connections`
  est une ligne par `(org, provider_type, provider_name)`, pas par
  compte Facebook/Instagram/TikTok individuel). Plutôt que de deviner ce
  modèle de données (appartenant probablement à un autre lot), la clé
  est traitée en mode "par action" : le nombre de comptes **distincts
  ciblés par une opération donnée** (ex: une campagne) est comparé à la
  limite du plan. C'est ce qui est vérifié dans `marketing-service.ts`.
- **Deux natures de limites**, exactement comme demandé par le cahier :
  cumulatif (`whatsapp_groups`, `ai_credits` — `used` = compte réel) vs
  "par action"/booléen (tout le reste — `used=0`, seule compte
  `requestedAmount` vs `limit`). Une seule fonction pure
  (`evaluateEntitlement`) gère les deux cas.
- **`whatsapp_groups`** : compte les lignes de la table `whatsapp_groups`
  si elle existe, retourne `used: 0` sinon (elle n'existe pas encore
  dans ce code — probablement un autre lot), exactement comme demandé.

## 3. Hypothèses prises

1. Les chiffres du seed (`plan_entitlements`, `price_fcfa`) sont des
   placeholders, pas les valeurs officielles (§1.2).
2. `ai-credits-service.ts` a été recréé en implémentation réelle, pas en
   stub permissif, malgré la convention par défaut qui suggère un stub
   pour une dépendance d'une autre équipe — justifié par le fait que
   c'est le cœur même de ce que ce lot doit "rattacher à un vrai plan".
   Si une autre équipe a produit ce fichier en parallèle, réconcilier à
   la fusion plutôt qu'appliquer les deux migrations `ai_credit_balances`.
3. `social_accounts` traité en mode "par action" plutôt que cumulatif
   (§2, "Choix de conception"), faute d'un modèle de données existant
   pour "comptes connectés".
4. `organizations.status/plan/trial_start/trial_end` (migration 0001)
   restent en place mais ne sont plus consultés pour le gating —
   `organization_subscriptions` (Lot B) est la nouvelle source de
   vérité. Personne d'autre dans le code fourni ne lit ces colonnes.
5. Le blocage réel de l'IA sur crédits épuisés n'est PAS câblé dans
   `ai-response-service.ts`/`conversation-orchestrator.ts` (§1.1) — hors
   périmètre explicite de ce lot, recommandation laissée pour l'équipe
   qui possède ces fichiers.
6. `consumeCredit`/`grantCredits` font une lecture-puis-écriture, pas un
   incrément SQL atomique (documenté dans le code) — acceptable au
   volume actuel (V1), à durcir si la concurrence devient réelle.

## 4. Tests écrits

- `entitlements-service.test.ts` — `evaluateEntitlement` (pure,
  exhaustif : illimité, dans la limite, pile à la limite, au-dessus,
  mode "par action") + `canUseFeature` (délégation `ai_credits`, comptage
  cumulatif, clé sans configuration = illimité, tenant sans abonnement
  ne plante pas — les deux critères d'acceptation explicites du cahier).
- `ai-credits-service.test.ts` — `getCreditStatus` (calcul du solde,
  illimité, jamais négatif, fallback tenant sans ligne), `hasCreditsAvailable`,
  `consumeCredit` (rejet montant invalide, init à la volée),
  `initializeCreditBalance` (résolution depuis le plan vs montant
  explicite), `grantCredits` (ajout, cas illimité).
- `marketing-service.test.ts` (complété) — le nouveau garde-fou : refus
  **avant tout accès DB** si le quota est dépassé, déduplication des
  comptes ciblés plusieurs fois. Tests existants (`addHoursToNaiveIso`)
  conservés inchangés.

Pattern de mock suivi : mocker les modules importés
(`./plans-repository`, `./ai-credits-service`, `./entitlements-service`)
plutôt que le client Supabase brut, cohérent avec
`conversation-orchestrator.test.ts` (fichier de référence cité par
`00_CONVENTIONS_COMMUNES.md`). Pour `ai-credits-service.test.ts`, qui
touche directement Supabase, un petit client factice minimal a été
écrit dans le fichier de test (pas de nouvelle dépendance).

Aucun test n'a été ajouté pour `plans-repository.ts` ni pour
`onboarding-service.ts` : aucun fichier existant du projet ne teste
directement une fonction qui ne fait qu'orchestrer des appels Supabase
(le pattern établi teste soit du pur, soit un service qui mocke ses
propres dépendances) — cohérent avec l'existant plutôt qu'une nouvelle
convention introduite unilatéralement.

## 5. Vérifications — typecheck / test / lint

**⚠️ Ni `npm run typecheck`, ni `npm test`, ni `npm run lint` n'ont pu
être exécutés tels quels dans cet environnement** : `node_modules/`
n'est pas présent dans l'archive fournie, et l'accès réseau est bloqué
(`npm install` échoue avec `403 Forbidden` sur `registry.npmjs.org`).
Je le signale explicitement plutôt que de prétendre l'avoir vérifié.

Ce qui a été fait à la place, à titre de vérification partielle :

- **Typecheck best-effort** : `tsc` global (v6.0.3, le projet pin
  5.4.5 — écart de version à garder en tête) lancé avec `--noEmit
  --skipLibCheck -p tsconfig.json` sur l'ensemble du projet. Sans
  `node_modules`, ~590 erreurs de résolution de module apparaissent
  (`next`, `react`, `vitest`, `@supabase/supabase-js` introuvables) —
  attendu, pas informatif en soi. **Filtré aux seuls fichiers créés/modifiés :**
  `entitlements-service.ts`, `ai-credits-service.ts`, `subscription-service.ts`,
  `onboarding-service.ts` et `errors.ts` ressortent avec **zéro erreur**,
  même en comptant le bruit de résolution de modules. Les seules erreurs
  restantes (`plans-repository.ts` : 3× "implicit any" sur des lignes
  `.map`/`.filter` ; `dashboard/subscription/page.tsx` et `layout.tsx` :
  JSX "implicitly any" + un faux positif sur la prop `key`) sont du même
  type, sur le même genre de ligne, que des erreurs identiques trouvées
  sur du code **préexistant non touché** par ce lot (ex: `tenant-landing.tsx`
  a exactement la même erreur "prop `key`" ; `marketing-service.ts:86`,
  ligne préexistante non modifiée, a le même "implicit any" sur un `.map`)
  — signe fort qu'il s'agit d'un artefact de l'absence de `node_modules`
  (types de `SupabaseClient`/React non résolus) plutôt que d'une régression
  introduite par ce lot.
- **Lint** : aucun ESLint disponible dans l'environnement (pas
  d'installation globale, pas de réseau) — non vérifié du tout, à faire
  côté CI/environnement de développement réel.
- **Tests** : écrits (voir §4) mais **non exécutés** — `vitest` n'est
  pas installé. Relecture manuelle ligne à ligne de chaque test contre
  l'implémentation correspondante pour limiter le risque d'erreur.

**Recommandation concrète** : dans un environnement avec accès réseau,
lancer simplement `npm install && npm run typecheck && npm test && npm run lint`
à la racine du projet fusionné — c'est la vérification qui manque avant
un merge en confiance.

## 6. Hors scope (rappel du cahier)

- Paiement réel (CinetPay/NotchPay) — seule la structure (`status`,
  `current_period_end`) est posée.
- Changement de plan en libre-service — la page `/dashboard/subscription`
  affiche la comparaison mais le bouton d'upgrade est un message
  informatif ("bientôt disponible"), pas une action.
- Super Admin (Lot C) — `grantCredits()` est exposée et testée ; changer
  `plan_key` se fait directement en DB comme prévu par le cahier.
