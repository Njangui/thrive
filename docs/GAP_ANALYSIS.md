# PROJECT GAP ANALYSIS
Comparaison entre le scaffold déjà construit (sous le 1ᵉʳ master prompt, orienté
plateforme multi-tenant générique) et la nouvelle vision produit (2ᵉ master
prompt, orienté catalogue → landing → WhatsApp → réseaux sociaux, ROI-first).

**Décision actée avec le fondateur** : on garde la stack déjà posée
(Next.js + TypeScript + Supabase + Vercel), on adapte le **scope**. Ce
document ne remet donc pas en cause l'architecture technique, seulement le
périmètre fonctionnel et le modèle de données métier.

---

## A. Ce qui existe déjà

- Multi-tenant : `organizations`, `profiles`, `memberships` (rôles enum), RLS
  via `is_member_of_org()`, `tenant_domains`, `tenant_modules`.
- CRM : `contacts`, `leads` (pipeline riche : visitor→lead→qualified→
  opportunity→customer→lost), `lead_events`, `follow_up_tasks`,
  `conversations` (handoff_status), `messages`.
- Revenue/Finance light : `orders`, `order_items`, `payments`,
  `expense_categories`, `expenses`, `receivables`.
- Inventory minimal : `products` (org, name, sku, prix, stock, is_active —
  PAS le modèle catalogue complet), `inventory_movements`, `appointments`.
- Providers : ports `MessagingProvider` / `AIProvider` / `PaymentProvider` /
  `StorageProvider` / `NotificationProvider` ; `ZernioAdapter` (messaging
  WhatsApp uniquement) ; adapters IA Mistral/Claude/OpenAI ;
  `ProviderRegistry`, `secrets-resolver`.
- Pipeline webhook Zernio : signature → idempotence (`webhook_events`) →
  normalisation (`mapper.ts`) → `conversation-service` → **appel IA direct**.
- `tenant_ai_context`, `ai-response-service` (fallback loggé), `handoff-service`.

## B. Ce qui fonctionne (structurellement — **rien n'a encore été exécuté**,
aucun `npm install`/build/test n'a eu lieu ; à vérifier en toute fin de
session comme convenu)

Code cohérent en lecture, types stricts, RLS posée sur toutes les tables,
séparation ports/adapters respectée nulle part contournée.

## C. Ce qui est cassé / risqué

- Aucun bug identifié à la lecture, mais **rien n'est testé**.
- Format exact des payloads webhook Zernio non confirmé (TODO déjà noté).
- `order_items.product_id` référence un `products` encore minimal (corrigé
  ci-dessous).

## D. Ce qui manque (gaps majeurs vs doc 2)

1. **Catalogue complet** (section 9 doc 2) : categories, products enrichis
   (slug, description, compare_at_price, status DRAFT/ACTIVE/OUT_OF_STOCK/
   INACTIVE, images, public_url), services, product_images.
2. **FAQ** (section 18) : table + résolution SANS appel LLM.
3. **Business Data** complet (section 8) : téléphone, WhatsApp, adresse,
   horaires, réseaux sociaux, logo — `organizations` n'a que le minimum.
4. **Conversation Orchestrator** (section 17) : le webhook actuel appelle
   l'IA directement. C'est une **violation du principe central du doc 2**
   (section 45 : cost control, règles → FAQ → catalogue → data → LLM en
   dernier recours ; section 15 : PRODUCT_DISCOVERY ne doit pas déclencher
   un LLM). **C'est le refactor le plus important de ce lot.**
5. **Notifications** persistées (table) — le TODO existant n'écrit rien.
6. **Revenues manuelles** (section 26) — actuellement seul `payments` existe
   (lié à une commande) ; doc 2 veut aussi un enregistrement manuel de
   revenu, indépendant d'une commande.
7. **Social Publishing** (sections 28-32) : `SocialPublishingProvider`,
   adapter Zernio social, `social_campaigns`/`social_posts`/
   `social_post_targets`, sélection multiple produits, programmation,
   analytics de publication. Rien n'existe.
8. **Landing dynamique** (section 12) : aucune route `/produits/:slug` ni
   page vitrine alimentée par le catalogue.
9. **Import CSV en masse** (section 11).
10. **Contexte conversationnel court** (section 21) : résolution de
    référence ("celle à 25 000") — pas de mémoire structurée aujourd'hui.

## E. Ce qui doit être refactorisé

- **Webhook Zernio** : insérer l'orchestrateur (règles → FAQ → catalogue →
  business data → IA) AVANT tout appel `generateAIReply`.
- `products` : ALTER (ajout slug/description/category_id/compare_at_price/
  status, suppression de `is_active` au profit de `status`).
- `tenant_modules` : le set de modules doit refléter le doc 2, pas le doc 1
  (voir F).

## F. Ce qui doit être abandonné (ne sera PAS construit, conforme aux
exclusions explicites section 6 du doc 2)

- Module `automation` (moteur trigger/condition/action générique) — posé
  dans le doc 1, jamais implémenté au-delà du nom de colonne. **Retiré.**
- Module `ai_insights` — idem, explicitement hors MVP doc 2. **Retiré.**
- Website Engine générique (templates/sections configurables façon
  page-builder, doc 1 section 19-20) — remplacé par une landing dynamique
  simple alimentée par le catalogue (doc 2 section 12), sans éditeur
  drag-and-drop.
- Paiement intégré (CinetPay/NotchPay) — le port `PaymentProvider` reste
  dans le code (ne coûte rien, n'est appelé nulle part), mais aucun adapter
  concret ni UI ne sera construit en V1 (doc 2 section 24, explicite).

## G. Ce qui est conservé tel quel

- Fondation multi-tenant + RLS (`organizations`/`memberships` = équivalent
  fonctionnel de `businesses`/`business_members` du doc 2 — **on ne
  renomme pas**, pur churn sans valeur ajoutée pour un schéma déjà
  RLS-testé conceptuellement).
- CRM (contacts/conversations/messages), pipeline `leads` (plus riche que
  le NEW/LEAD/CUSTOMER/LOST du doc 2, mais compatible — le pipeline enrichi
  peut se réduire à ces 4 états pour l'affichage si besoin, sans perte).
- Revenue/Finance light — très aligné avec doc 2 section 26/27, seul
  ajout nécessaire : table `revenues` pour les entrées manuelles.
- Fondation providers/adapters Zernio + IA Gateway — exactement le pattern
  demandé section 31/37 du doc 2 (SocialPublishingProvider viendra en plus,
  pas en remplacement).
- `handoff-service` — sémantique compatible avec AI_ACTIVE/HUMAN_ACTIVE/
  CLOSED du doc 2 (mapping : `ai`→AI_ACTIVE, `pending_human`/`human`→
  HUMAN_ACTIVE, `resolved`→CLOSED). Pas de renommage DB, juste ce mapping
  documenté.

## H. Schéma de données — delta proposé (implémenté dans cette session)

`categories`, `products` (ALTER), `product_images`, `services`, `faqs`,
`organizations` (ALTER — champs business data), `notifications`,
`revenues`. Voir `supabase/migrations/0008_catalog_faq_business.sql`.

## I. Architecture proposée

Inchangée (hexagonale : domain/application/infrastructure). Ajout d'un
`ConversationOrchestrator` en couche application, qui devient le seul point
d'entrée entre le webhook et le reste du système (FAQ/catalogue/business
data en premier, IA en dernier recours, jamais l'inverse).

## J. Intégration Zernio proposée (delta)

Ajouter `SocialPublishingProvider` (port) + `ZernioSocialAdapter` — **prévu
pour un prochain bloc**, pas dans cette session (voir section P). Avant
implémentation réelle : revérifier sur docs.zernio.com les capacités
exactes de social posting/scheduling/analytics — ne pas supposer leur
existence par extrapolation depuis l'API messaging déjà utilisée.

## K. Architecture WhatsApp

Pipeline webhook inchangé jusqu'à la normalisation. Après normalisation :
`ConversationOrchestrator` décide (FAQ / PRODUCT_DISCOVERY / PRODUCT_QUERY /
BUSINESS_INFO / AI / HUMAN) avant tout envoi de réponse.

## L. Architecture Conversation Orchestrator (nouveau, cette session)

```
MESSAGE_RECEIVED
   ↓
ConversationOrchestrator.route(message, businessId)
   ↓
1. FAQ (correspondance mots-clés, pas de LLM)
2. PRODUCT_DISCOVERY (regex/mots-clés : "produits", "catalogue", "montrez"...)
3. BUSINESS_INFO (horaires, adresse, contact — depuis organizations)
4. Sinon → AI (contexte borné : dernier message + FAQ/produits pertinents)
5. Si IA peu confiante / mots-clés sensibles → HUMAN_HANDOFF
```

## M. Architecture IA

Inchangée dans son mécanisme (ports/adapters/fallback loggé), mais **son
déclenchement change** : dernier maillon de l'orchestrateur, jamais le
premier. Contexte enrichi avec le produit spécifique mentionné si
`PRODUCT_QUERY` a été détecté, pas juste le prompt système générique.

## N. Architecture Finance (delta)

Ajout `revenues` (entrée manuelle, section 26) + génération automatique
d'une ligne `revenues` quand une commande passe à `completed` (logique en
couche application — `order-service` — pas de trigger DB, pour rester
testable et explicite).

## O. Architecture Marketing

Reportée au bloc suivant (voir P) — nécessite le catalogue fonctionnel
d'abord (le catalogue est la source de vérité que Marketing consomme,
section 30 doc 2).

## P. Plan d'implémentation par blocs (doc 2 section 56 : "travaille par
blocs cohérents")

**Ce bloc (maintenant)** : DB delta (catalogue/FAQ/business data/
notifications/revenues), révision `tenant_modules`, `ConversationOrchestrator`
+ `FAQResolver` + `CatalogResolver`, branchement dans le webhook Zernio.

**Bloc suivant** : Landing dynamique (`/produits/:slug`), Product Discovery
formaté pour WhatsApp (section 15), gestion stock → OUT_OF_STOCK auto.

**Bloc d'après** : Social Publishing (Zernio) + campagnes + sélection
multiple + programmation.

**Dernier bloc avant tests/build** : import CSV, analytics publications,
contexte conversationnel court.

**Tout à la fin (comme convenu)** : `npm install`, `tsc --noEmit`, tests,
build.

## Q. Risques techniques

- Format Zernio (messaging ET social) non confirmé contre la doc officielle
  réelle — reste un TODO explicite partout où c'est pertinent.
- Redesign de `products` en cours de session (avant tout seed/usage réel) —
  risque faible, aucune donnée en jeu.
- Résolution de référence conversationnelle ("celle à 25 000") non triviale
  — reportée, pas bloquante pour la boucle centrale.

## R. Risques business

- Tentation de garder vivants des morceaux du doc 1 (automation, ai_insights)
  "puisqu'ils sont déjà à moitié là" — décision prise : abandonnés
  explicitement (section F), conforme à la discipline ROI du doc 2.

## S. Complexité par module (estimation qualitative)

| Module | Complexité | Statut |
|---|---|---|
| Catalogue | Moyenne | Ce bloc |
| FAQ | Faible | Ce bloc |
| Orchestrator | Moyenne-Haute | Ce bloc |
| Landing | Moyenne | Bloc suivant |
| Social Publishing | Haute (dépend de Zernio) | Bloc 3 |
| Analytics publications | Faible-Moyenne | Bloc 4 |
| Import CSV | Faible | Bloc 4 |

## T. Critères d'acceptation

Repris tels quels du doc 2 : scénario bout-en-bout section 58, import 100
produits section 59, finance section 60, sécurité multi-tenant section 61.
Aucun critère nouveau inventé ici.
