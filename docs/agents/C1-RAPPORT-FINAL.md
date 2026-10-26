# C1 — Rapport final (noyau agentique, sécurité et données)

Branche `agents/c1-noyau`, migrations 0100 à 0108. Détail technique : `c1-architecture.md`, `c1-contracts.md`, `ROLE_TOOL_MATRIX.md`.

## Fait
| Phase | Contenu | Migration |
|---|---|---|
| P0 | Contrats partagés (`Actor`, `ToolDef`, `AgentDef`, `UsageService`, événements) | — |
| P1 | Registre d'outils, moteur de règles en code, approbations liées à l'empreinte, audit append-only, accès tenant | 0100-0102 |
| P2 | Runtime (boucle LLM/outils, sous-agents), traçage, coupe-circuit et limiteur, tool-calling du port IA | 0103 |
| P3 | Registre d'usage et portefeuille idempotents, recharges vérifiées auprès du provider | 0104 |
| P4 | Planificateur, outbox `domain_events`, runs bloqués, rétention | 0105-0106 |
| P5 | Retours, résultats, consentements opt-in, export pseudonymisé verrouillé, évaluation | 0107 |
| P6 | `EmbeddingPort` Mistral, mémoire d'entreprise pgvector, outils `memory.*` | 0108 |

Principes tenus : règles en code ; `sensitive` toujours confirmé ; approbation liée à l'empreinte ; l'agent hérite des droits de l'humain ; messages clients = données non fiables (jamais en mémoire) ; tout tracé ; **aucun prix en dur** ; entraînement uniquement en opt-in ; aucun secret ni contenu dans les logs.

Vérification : scénarios SQL réels (Postgres 16 + pgvector) pour chaque table (RLS, append-only, cascades) ; concurrence réelle (P3, P4) ; tests TS unitaires et d'intégration ; jeu d'évaluation de sécurité (modèle scripté) en CI. Les 7 échecs de la suite complète (`catalog-video-retention`, `fapshi/client`) existaient avant C1 et n'ont pas été touchés.

## Pas fait
- Branchements hors périmètre C1 : handlers d'événements (`EVENT_HANDLERS` vide), création/édition des tâches planifiées, écrans de retours et de consentement, enregistrement des outils `memory.*` en production (C2 à C5).
- Aucune durée de rétention appliquée par défaut ; aucun entraînement de modèle.
- Évaluation avec un vrai modèle : possible avec le même jeu, à lancer à la main.

## Risques
- pgvector et l'extension `vector` non testés sur un vrai projet Supabase (testé sur Postgres local) ; dimension 1024 de `mistral-embed` à vérifier.
- Seuil de similarité de la mémoire (0,3) non calibré.
- `getPaymentProvider` ignore l'organisation (provider global).
- Transfert de textes à Mistral (embeddings) : sous-traitant hors Cameroun.

## Questions ouvertes pour Marc-well
1. Seuils d'autonomie par défaut ; durée d'expiration des approbations.
2. Durées de rétention : journaux, audios, runs, événements, retours/résultats, mémoire.
3. `Actor` du canal `customer` (avec C3) ; chiffrement éventuel des `params` de `pending_actions`.
4. Identifiants des modèles `large` par fournisseur (à vérifier) ; modèle de prix v2.
5. **Juridique (loi 2024/017)** : base légale et information pour la rétention, le consentement d'entraînement, les commentaires libres, le transfert à Mistral, les recharges de portefeuille (volet fiscal).
