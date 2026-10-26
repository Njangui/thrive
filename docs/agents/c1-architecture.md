# C1 — Architecture du noyau agentique (P0 + P1 + P2)

État : P0 contrats, P1 registre / moteur de règles / approbations / audit, P2 runtime orchestrateur / sous-agents + traçage + coupe-circuit. À venir : P3 usage, P4 planificateur et événements, P5 feedback, P6 mémoire.

## Flux d'exécution d'un outil
```
canal (C2) --identité authentifiée--> resolveActor() --> Actor
Actor + {toolName, input}
  -> executeTool()                         (execute-tool.ts, point d'entrée UNIQUE)
     1 assertActor            sans acteur valide : refus, outil jamais appelé
     2 registry.get + input.safeParse
     3 evaluateAction         (rule-engine.ts : outil activé ? zone ? permission ? budget ? risque ?)
     4 audit "decision"       (échec d'audit => action non-lecture refusée)
     5a allow   -> tool.run(ctx) avec ctx.db = accès scopé tenant -> validation de sortie -> audit
     5b confirm -> ligne pending_actions (empreinte SHA-256) -> carte d'approbation
     5c deny    -> motif stable (jamais de détail interne)
carte -> approvePendingAction(expectedHash)   permission + non expiré + empreinte identique
                                              + step-up (C2) pour les outils sensibles
      -> executeApprovedAction()              relit les paramètres STOCKÉS, revérifie l'empreinte,
                                              passe approved -> executed (atomique : usage unique)
```

## Garanties et où elles sont imposées
| Garantie | Code | Base (migrations 0100-0102, testées sur Postgres 16) |
|---|---|---|
| `sensitive` toujours confirmé | `decide()` | `agent_settings.autonomy` : `sensitive` ≠ `confirm` refusé par CHECK |
| « oui » lié aux paramètres exacts | `approve()` (`expectedHash`), `claimForExecution()` (recalcule) | paramètres, empreinte, outil, tenant, demandeur **immuables** (trigger) |
| usage unique | `transition(approved→executed)` conditionnelle | statuts à sens unique (trigger) ; `executed` terminal |
| expiration | `expiresAt` vérifié à l'approbation ET à l'exécution | `expires_at > created_at` |
| isolation tenant des outils | `createTenantScopedDb` (filtre/marquage automatique, tables sensibles interdites en écriture) | RLS sur les 3 tables ; écriture service-role uniquement |
| audit append-only | écriture avant exécution, paramètres expurgés | trigger : UPDATE/DELETE/TRUNCATE refusés, purge via fonction service-role |

## Brancher un outil en 10 lignes
```ts
import { z } from "zod";
import { createAgentKernel } from "@/application/agents/tool-registry";

kernel.registerTool({
  name: "catalog.update_price", domain: "catalog", risk: "sensitive", permission: "catalog.price",
  description: "Change le prix d'un produit (confirmation obligatoire).",
  input: z.object({ productId: z.string().uuid(), price: z.number().nonnegative() }),
  output: z.object({ ok: z.boolean() }),
  run: async (ctx, i) => { await ctx.db.from("products").update({ price: i.price }).eq("id", i.productId); return { ok: true }; },
}, { roles: ["owner", "admin"] });
```
Règles pour les outils : jamais de client service-role (utiliser `ctx.db`), jamais d'`Actor` construit depuis un message, aucun secret dans les sorties, calculs (marges, stocks, budgets) en code/SQL.

## P2 — Runtime d'agents (`runtime.ts`)
```
runAgent({ actor, agentName, message, history?, outputSchema? })
  1 acteur valide ; agent connu ; run créé dans agent_runs (échec de traçage => refus, fail-closed)
  2 RunGate : coupe-circuit tenant/agent (fail-closed) puis limiteur Upstash (fail-open) — AVANT tout LLM
  3 pré-routeur déterministe (hook C3, orchestrateur seulement) : réponse sans LLM si une règle/FAQ répond
  4 outils exposés = outils de l'agent ∩ activés par le tenant ∩ permis à l'acteur (le LLM ne voit rien d'autre)
  5 boucle (≤ maxSteps, ≤ maxCredits) : provider.chat -> fournisseur de secours si erreur -> débit 1 unité
      pas d'outil  -> réponse finale (JSON validé si outputSchema, une relance de correction)
      appels       -> executeTool (moteur de règles) ; sous-agent = outil `agent.<nom>` (run enfant, profondeur ≤ 2)
      confirm      -> le run s'arrête en `awaiting_approval` (carte pending_actions) : l'agent ne continue pas
  6 clôture : agent_runs (statut, pas, unités, jetons) ; agent_steps immuables (modèle, version du prompt)
```
- **Sécurité** : toute sortie d'outil revient balisée `<donnees_outil … fiabilite="non_fiable">` (balise de fermeture neutralisée dans le contenu) ; le prompt système rappelle que ces contenus sont des données, jamais des instructions. Un sous-agent hérite des droits de l'humain, jamais plus ; la vitrine (`customer`) n'a aucun sous-agent.
- **Budgets** : `maxSteps` et `maxCredits` par agent ; un sous-agent est plafonné par les crédits restants du parent (`totalUnits` côté parent, `unitsUsed` propre au run pour éviter le double comptage au grand livre). Unité = 1 appel LLM réussi (neutre, aucun prix).
- **Débit** : l'unité est débitée APRÈS une réponse réussie (`ref = runId:tour`, idempotent) ; solde insuffisant => `budget_exceeded` et la réponse n'est pas exploitée. Réserve/remboursement exacts : P3.
- **Minimisation** : aucun message, réponse ni sortie d'outil n'est stocké dans `agent_runs/steps` (testé).
- **Modèles** : `small` = `ai_config.model` du tenant ; `large` = `LARGE_MODEL_BY_PROVIDER` de la même famille (**identifiants à vérifier avant production**).
- **Brancher un périmètre** : ajouter un registrar dans `src/application/agents/domains/index.ts` (`kernel.registerTool(...)`, `agents.register({...})`) ; `getAgentKernel()` valide le graphe (outils inconnus, cycles, profondeur) au démarrage. Assemblage prod : `createProductionAgentRuntime({ usage, stepUp?, hooks? })` — `usage` est obligatoire (pas de défaut « gratuit »).
- **Coupe-circuit** : `SupabaseCircuitBreakerRepository.trip/release` (par tenant ou par agent) ; le propriétaire/admin peut aussi l'armer via RLS. Les runs bloqués restent tracés.

## Dépendances et points ouverts
- **C2** : `StepUpPort` — sans lui, l'approbation d'un outil `sensitive` échoue (fail-closed, voulu). `notify()` pour pousser la carte d'approbation.
- **C3** : l'`Actor` du canal `customer` n'est pas un utilisateur : à définir avec C3 (proposition : `userId` = id du contact, `role` ignoré par le moteur pour ce canal).
- **Runs bloqués en `running`** (crash en cours d'exécution) : non traités ; le planificateur P4 les clôturera après un délai.
- **Câblage** : `SupabaseAgentSettingsRepository`, `SupabasePendingActionRepository`, `SupabaseAuditSink`, `SupabaseMembershipLoader` (`src/infrastructure/agents/`) ; la route/runtime qui les assemble arrive en P2.
- Chiffrement des `params` stockés dans `pending_actions` : non fait (accès limité par RLS au demandeur et à owner/admin) — à décider.
- Rétention (défauts proposés, **à valider avec Marc-well et à faire valider juridiquement**) : audit 12 mois, traces d'agents 90 jours ; purge via `purge_agent_audit_events`. Job de purge planifié : P4.

## Tester
`npx vitest run src/application/agents src/infrastructure/agents tests/rls-policies.test.ts`
Migrations : appliquées sur Postgres 16 (stubs `auth`/rôles Supabase) avec scénarios contraintes, triggers et RLS : `supabase/tests/c1_p1_behaviour.sql` (0100-0102) et `supabase/tests/c1_p2_behaviour.sql` (0103).

## P3 — Registre d'usage et portefeuille (migration 0104)

- **Grand livre** `usage_ledger` append-only, idempotent par `(organisation, ref, entry_type)` ; **portefeuille** `wallet_balances` par `(organisation, kind)`, jamais négatif.
- Sources de débit : le **plan** d'abord (`consume_ai_credit`), puis le **portefeuille**. Verrou consultatif par `(org, ref)` : pas de double débit en concurrence (prouvé par `supabase/tests/c1_p3_concurrency.sh`).
- Fonctions SQL (service-role uniquement) : `usage_charge`, `usage_reserve`/`usage_commit`/`usage_release`/`usage_refund`, `wallet_topup`, `wallet_topup_settle`.
- TS : `src/application/usage/` (`usage-service`, `topup-service`) ; dépôts Supabase dans `src/infrastructure/usage/`. Le runtime est **fail-closed** : échec du registre => run `failed` / `usage_unavailable`.
- **Recharges** : le crédit n'est accordé qu'après `verifyPayment` auprès du provider (jamais sur le seul webhook). `handlePaymentWebhook` délègue à `confirmWalletTopupFromWebhook` quand aucune référence d'abonnement ne correspond.
- **Aucun prix en dur** : le montant payé et le nombre d'unités sont fournis par l'appelant (modèle de prix v2 non décidé).
- Alerte solde bas : anti-spam en SQL (`low_balance_alerted_at`), callback `onLowBalance` best-effort.
- Points ouverts : `getPaymentProvider` ignore l'organisation (provider global) ; seuil d'alerte par défaut à décider ; réconciliation périodique des recharges `pending` à planifier en P4.

## P4 — Planificateur, événements, hygiène (migrations 0105, 0106)

- **Outbox `domain_events`** (0105) : émission idempotente par `(organisation, type, dedupe_key)` ; dispatcher « au moins une fois » (`claim_domain_events` en `FOR UPDATE SKIP LOCKED`, bail repris s'il expire) ; échec => attente exponentielle (30 s × 2^n, plafond 1 h) puis `dead` après N tentatives (jamais perdu, jamais purgé automatiquement). Service-role uniquement, RLS sans politique. Les handlers par type se branchent dans `EVENT_HANDLERS` (`src/infrastructure/agents/agents-tick.ts`) et doivent être idempotents. Les types d'événements s'ajoutent à `OutboxEventMap` (contracts.ts).
- **Planificateur `scheduled_tasks`** (0106) : `once` ou `interval` (≥ 300 s). La tâche s'exécute avec les droits **actuels de son créateur** (canal `scheduler`) ; créateur retiré de l'organisation => désactivation immédiate. Prochaine échéance toujours dans le futur (pas de rattrapage en rafale) ; désactivation automatique après 5 échecs consécutifs. `confirm`/`sensitive` restent soumis à approbation humaine (`awaiting_approval` n'est pas un échec). Lecture réservée à owner/admin, écriture service-role.
- **Hygiène** : `close_stuck_agent_runs` (runs `running` trop anciens => `failed`/`stuck_timeout`, jamais `awaiting_approval`) ; `purge_agent_runs` / `purge_domain_events` (jamais `running`, `awaiting_approval`, ni événements non terminés ; date minimale J-1). **Aucune purge sans durée configurée** : `AGENT_RUN_RETENTION_DAYS`, `AGENT_EVENT_RETENTION_DAYS` (absentes => rien n'est purgé) ; `AGENT_STUCK_RUN_SECONDS` (défaut 1800). Le journal d'audit n'est pas purgé ici.
- **Route** `/api/cron/agents-tick` (`verifyCronAuth`) : dispatcher + planificateur + hygiène, étapes isolées. Fréquence conseillée : 5 min. Les crons existants ne sont pas modifiés.
- Tests SQL : `supabase/tests/c1_p4_behaviour.sql`, `c1_p4_concurrency.sh` (200 événements / 20 dispatchers : aucun doublon ; 50 émissions simultanées : 1 ligne).
- Points ouverts : durées de rétention (juridique, loi 2024/017) ; création/édition des tâches planifiées (outil/écran + audit) à brancher avec C2/C3 ; ajout de la route au planificateur d'hébergement (`vercel.json` non modifié).

## P5 — Retours, consentements, export, évaluation (migration 0107)

- **`feedback_events`** : une note (+1/−1, raison codée, commentaire ≤ 500 car.) par `(run, auteur)`, réécrite si l'auteur change d'avis. Seul le demandeur du run ou un owner/admin peut noter ; lecture : l'auteur ou owner/admin ; écriture : service-role via `record_feedback`. Un client (`customer`) ou le planificateur ne note pas.
- **`outcome_events`** (append-only) : ce que l'humain fait du résultat (brouillon envoyé/édité/jeté, suggestion acceptée/refusée, action approuvée/rejetée). Aucun contenu : `meta` borné (2 000 car., valeurs texte ≤ 100).
- **`training_consent_events`** (append-only) : **opt-in strict**, sans événement `granted` = pas de consentement ; seul un **owner**, depuis le tableau de bord, accorde ou retire (vérifié en TS **et** en SQL), décision auditée, version de politique enregistrée, retrait immédiat.
- **Export** (`training-export.ts`) : désactivé par défaut ; exige `AGENT_TRAINING_EXPORT_ENABLED=true`, `AGENT_EXPORT_PSEUDONYM_SECRET` (≥ 32 car.) et un consentement actif ; `training_export_rows` ne renvoie rien sans consentement (double filtre). Sortie : ni commentaire, ni utilisateur, ni organisation, ni contenu ; run pseudonymisé par HMAC propre à l'organisation ; date réduite au jour.
- **Indicateurs** (`feedback-metrics.ts`) : satisfaction et principales raisons par agent × version de prompt.
- **Évaluation** (`agents/evaluation/`) : `runEvaluation(cas, executor)` ; jeu de sécurité en CI avec modèle scripté (injection client, action sensible même pour le propriétaire, vendeur sans droit, outil inventé). Le même jeu peut être rejoué avec un vrai modèle (exécution manuelle, à ne pas lancer en CI).
- Suppression d'un run : retours et résultats conservés (`run_id` NULL) ; suppression d'une organisation : tout part en cascade.
- **À valider juridiquement** (loi 2024/017) : base légale et information des utilisateurs avant de proposer le consentement ; durée de conservation des retours/résultats (aucune purge automatique pour l'instant) ; commentaires libres susceptibles de contenir des données personnelles ; transfert éventuel hors du Cameroun si l'export est utilisé.
- Hors périmètre ici : écrans/endpoints de collecte (C2/C3), aucun entraînement de modèle.

## P6 — Mémoire d'entreprise et embeddings (migration 0108)

- **Port** `EmbeddingPort` (`src/domain/ports/embedding.ts`) ; adaptateur Mistral (`mistral-embed`, 1024 dimensions — **à vérifier** dans la doc Mistral). Dimension validée à chaque réponse (un vecteur de mauvaise taille n'est jamais stocké), timeout 15 s, messages d'erreur sans texte ni clé.
- **`tenant_memory`** (pgvector) : `kind` (fact/preference/faq/decision), contenu ≤ 2 000 car. immuable (archiver puis recréer), hash SHA-256 du contenu normalisé (dédoublonnage), index HNSW cosinus, expiration facultative, quota par organisation (500 actives par défaut), lecture RLS owner/admin/manager, **écriture service-role uniquement** via `memory_upsert` (verrou par organisation), recherche `memory_search` toujours bornée à l'organisation, actifs et non expirés.
- **Service** `createMemoryService` : refuse tout texte ressemblant à un secret (clés, jetons, JWT, mots de passe, numéros de carte valides au contrôle de Luhn) **avant** envoi au fournisseur ; canal `customer` exclu (la zone non fiable n'alimente jamais la mémoire) ; doublon => ni embedding ni débit ; chaque embedding est compté au registre d'usage (`kind: ai`, idempotent) ; effacement définitif réservé owner/admin sur le tableau de bord.
- **Outils** `memory.search` / `memory.remember` / `memory.forget` (`domains/memory.ts`), non branchés par défaut : `domainRegistrars.push(createMemoryRegistrar(createProductionMemoryService({ usage })))`. Les résultats restent balisés `non_fiable` par le runtime : la mémoire est une donnée, jamais une instruction.
- **Seuil de similarité** par défaut 0,3 : **à calibrer** avec le jeu d'évaluation (module H) sur de vraies données ; changer de modèle d'embedding impose une migration (dimension) et un ré-embedding complet.
- **À valider** : activation de l'extension `vector` sur le projet Supabase (non testable ici : testé sur Postgres 16 local avec pgvector ; le schéma d'installation de l'extension peut différer — Supabase utilise souvent `extensions`, d'où `search_path = public, extensions` dans les fonctions) ; **juridique (loi 2024/017)** : les textes mémorisés ou recherchés sont envoyés à Mistral (transfert à un tiers, hors Cameroun) — information des utilisateurs, base légale, éventuelle exclusion de données personnelles de clients ; durée de conservation (purge `memory_purge` disponible, non planifiée tant que les durées ne sont pas décidées).
- Tests : `supabase/tests/c1_p6_behaviour.sql` (isolation, quota, seuil, expiration, archivage, immutabilité, RLS, cascade), tests TS (garde-fou, adaptateur, service, outils).
