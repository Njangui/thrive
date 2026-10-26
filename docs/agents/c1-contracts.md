# C1 — PR « contrats » (vague 0) : à valider par C2, C3, C4, C5

Fichier : `src/application/agents/contracts.ts` (types + `trustZoneOf`, aucun runtime).
Convention : `tenantId` = `organizations.id` (`organization_id` en base).

## Écarts par rapport à l'esquisse du contexte commun (à valider)

1. `evaluateAction` est **asynchrone** (`Promise<EvaluationResult>`) : elle crée la ligne `pending_actions` quand la décision est `confirm`. Résultat en union discriminée (`pendingActionId` présent seulement avec `confirm`).
2. `ToolDef` gagne `output?` (Zod de sortie) et `storefrontSafe?` (seuls ces outils sont atteignables depuis le canal `customer`).
3. `AgentDef` gagne `promptVersion` (traçage, principe 7) et `description?` (exposition du sous-agent comme outil).
4. `CostEstimate` = quantités par `UsageKind`, **jamais de montant** (principe 12).
5. `ToolCtx` expose `db: TenantScopedDb` (opaque, implémenté en P1) : aucun client service-role brut pour les outils.
6. `extraPermissions: string[]` = clés à `true` de `memberships.extra_permissions` (jsonb `{ "manage_ai": true }`). **Ce champ n'est lu nulle part aujourd'hui** ; C1 le branche en P1.
7. Événements d'outbox : `OutboxEventMap` + `emitEvent` (idempotent par `dedupeKey`). Chaque périmètre ajoute ses types par PR. Nom volontairement distinct du `DomainEvent` existant (webhooks entrants).
8. `StepUpPort` (C2) défini ici : `requestStepUp(actor, pendingActionId)`.

## Conventions
- Nom d'outil : `domaine.action` ; permission : `domaine.action`.
- Outil exposé à `customer` : `storefrontSafe: true` ET `risk: "read"` (ou brouillon).
- Aucun outil sans `Actor` ; `Actor` jamais construit depuis un message.

## Points hors contrat, constatés à l'audit
- `tsc --noEmit` échoue déjà sur `catalog-video-retention.test.ts` (exports `detectVideoStorageClass` / `effectiveRetentionDays` absents) : antérieur à cette PR, non touché.
- Le port `AIProvider` n'a pas de tool-calling : extension prévue en P2 (PR dédiée, fichiers partagés).
- pgvector non activé : à valider côté Supabase avant P6.
