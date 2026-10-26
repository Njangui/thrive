/**
 * Contrats du noyau agentique (C1, vague 0) — SOURCE DE VÉRITÉ partagée par
 * C1 à C5. Types et fonctions pures uniquement : aucune dépendance runtime,
 * aucun accès base. Tout changement passe par une PR sur CE fichier, validée
 * par les 5 périmètres (voir docs/agents/c1-contracts.md).
 *
 * Correspondance de vocabulaire : `tenantId` = `organizations.id`
 * (colonne `organization_id` partout dans la base).
 */
import type { ZodType } from "zod";
import type { MemberRole } from "@/application/services/auth-service";

/* ------------------------------------------------------------------ */
/* Acteur, canaux, zones de confiance                                  */
/* ------------------------------------------------------------------ */

export type Role = MemberRole;

export type RiskLevel = "read" | "write_reversible" | "sensitive";

export type Channel = "dashboard" | "telegram" | "whatsapp" | "scheduler" | "customer";

/**
 * Zones de confiance (principe 6). `storefront` = agent vitrine : lecture
 * seule + brouillons. `back_office` = équipe authentifiée.
 */
export type TrustZone = "back_office" | "storefront";

export function trustZoneOf(channel: Channel): TrustZone {
  return channel === "customer" ? "storefront" : "back_office";
}

/**
 * Humain (ou tâche programmée créée par un humain) au nom de qui l'agent
 * agit. Jamais construit à partir d'un contenu de message : uniquement par
 * la couche d'identité du canal (C2) ou par le planificateur (C1).
 * `extraPermissions` = clés à `true` de `memberships.extra_permissions`.
 */
export interface Actor {
  userId: string;
  tenantId: string;
  /** Adhésion (memberships.id) : requise par l'authentification renforcée et certains outils (remboursement). Optionnelle pour le planificateur. */
  membershipId?: string;
  role: Role;
  extraPermissions: string[];
  channel: Channel;
}

/* ------------------------------------------------------------------ */
/* Coûts et usage (neutres vis-à-vis des prix — principe 12)           */
/* ------------------------------------------------------------------ */

export type UsageKind = "ai" | "media" | "message" | "channel";

/** Quantité estimée par nature d'usage ; AUCUN montant monétaire ici. */
export interface CostEstimate {
  items: Array<{ kind: UsageKind; units: number; note?: string }>;
}

export interface UsageChargeInput {
  tenantId: string;
  actorId: string;
  kind: UsageKind;
  units: number;
  /** Clé d'idempotence : (tenantId, ref) identique => un seul débit. */
  ref: string;
}

export interface UsageChargeResult {
  status: "charged" | "duplicate" | "insufficient";
  ledgerId?: string;
}

export interface UsageService {
  charge(input: UsageChargeInput): Promise<UsageChargeResult>;
}

/* ------------------------------------------------------------------ */
/* Outils                                                              */
/* ------------------------------------------------------------------ */

/**
 * Requête supabase-js chaînable (`.eq`, `.order`, `await`…). Volontairement
 * non typée, comme un client supabase-js sans schéma généré : les types
 * génériques de postgrest-js ne se composent pas à travers cette façade.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TenantQuery = any;

type Row = Record<string, unknown>;

/**
 * Table d'un tenant : chaque requête est AUTOMATIQUEMENT filtrée sur le
 * tenant de l'acteur (select/update/delete) ou marquée avec lui (insert/
 * upsert, valeur contraire refusée).
 */
export interface TenantScopedTable {
  select(columns?: string, options?: { count?: "exact" | "planned" | "estimated"; head?: boolean }): TenantQuery;
  insert(values: Row | Row[], options?: { count?: "exact" | "planned" | "estimated" }): TenantQuery;
  upsert(values: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): TenantQuery;
  update(values: Row, options?: { count?: "exact" | "planned" | "estimated" }): TenantQuery;
  delete(): TenantQuery;
}

/**
 * Accès base restreint au tenant de l'acteur (implémenté par C1 :
 * `createTenantScopedDb`). Un outil n'obtient JAMAIS un client service-role
 * brut (principe 5).
 */
export interface TenantScopedDb {
  readonly tenantId: string;
  readonly __brand: "TenantScopedDb";
  from(table: string): TenantScopedTable;
}

export interface ToolCtx {
  actor: Actor;
  runId: string;
  stepId?: string;
  db: TenantScopedDb;
  usage: UsageService;
  signal?: AbortSignal;
}

/** Aperçu lisible d'une action pour la carte d'approbation — rédigé par le CODE, jamais par le modèle. */
export interface ToolPreview {
  title: string;
  summary: string;
  details: { label: string; value: string }[];
}

export interface ToolDef<I, O> {
  /** `domaine.action`, ex. `catalog.update_price`. Unique dans le registre. */
  name: string;
  domain: string;
  /** Lu par le LLM : court, factuel, en français. */
  description: string;
  input: ZodType<I>;
  /** Validation de sortie (obligatoire côté registre dès P1). */
  output?: ZodType<O>;
  risk: RiskLevel;
  /** Permission requise, `domaine.action` ; résolue via rôle + extraPermissions. */
  permission: string;
  /**
   * Atteignable depuis le canal `customer` (zone `storefront`) : lecture ou
   * brouillon inerte uniquement — le registre refuse `risk: "sensitive"`.
   * Faux par défaut : refusé pour `customer`.
   */
  storefrontSafe?: boolean;
  /**
   * Garde-fou fixe : l'action est TOUJOURS soumise à validation humaine, quels que soient les réglages du propriétaire
   * (ex. message écrit à un client au nom de l'entreprise). Ne s'applique pas à `read`.
   */
  confirmAlways?: boolean;
  estimateCost?: (input: I) => CostEstimate;
  /**
   * Dimension monétaire de l'action (devise de l'entreprise), calculée par le CODE (jamais par le modèle).
   * Absent = l'outil n'a pas de montant ; `undefined`/non résolu = montant inconnu (traité comme « au-dessus du seuil »).
   * Sert aux seuils « auto jusqu'à X » du propriétaire (voir rule-engine).
   */
  amountOf?: (ctx: { actor: Actor }, input: I) => Promise<number | undefined>;
  run: (ctx: ToolCtx, input: I) => Promise<O>;
  /** Aperçu pour la carte d'approbation (actions confirmées). Absent : titre générique + paramètres expurgés. */
  preview?: (ctx: { actor: Actor }, input: I) => Promise<ToolPreview>;
}

export interface ToolRegistry {
  register<I, O>(tool: ToolDef<I, O>): void;
  get(name: string): ToolDef<unknown, unknown> | undefined;
  listForDomain(domain: string): ToolDef<unknown, unknown>[];
}

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

export type ModelTier = "small" | "large";

export interface AgentDef {
  name: string;
  /** Version du prompt, tracée dans `agent_steps` (principe 7). */
  promptVersion: string;
  /** Description exposée à l'orchestrateur quand l'agent est un sous-agent-outil. */
  description?: string;
  systemPrompt: string;
  /** Noms d'outils (ou de sous-agents) ; l'orchestrateur ne charge jamais tout. */
  tools: string[];
  modelTier: ModelTier;
  budget: { maxSteps: number; maxCredits: number };
}

/* ------------------------------------------------------------------ */
/* Règles et approbations                                              */
/* ------------------------------------------------------------------ */

export type ActionDecision = "allow" | "confirm" | "deny";

export type EvaluationResult =
  | { decision: "allow"; reason: string }
  | { decision: "confirm"; reason: string; pendingActionId: string }
  | { decision: "deny"; reason: string };

/** Asynchrone : crée la ligne `pending_actions` quand la décision est `confirm`. */
export type EvaluateAction = (
  actor: Actor,
  tool: ToolDef<unknown, unknown>,
  input: unknown,
) => Promise<EvaluationResult>;

export type PendingActionStatus = "pending" | "approved" | "rejected" | "expired" | "executed";

export interface PendingAction {
  id: string;
  tenantId: string;
  toolName: string;
  /** SHA-256 des paramètres canonisés : l'approbation ne vaut que pour cette empreinte. */
  paramsHash: string;
  /** Paramètres expurgés, pour affichage dans la carte d'approbation. */
  paramsPreview: Record<string, unknown>;
  status: PendingActionStatus;
  requestedBy: string;
  approvedBy?: string;
  channel: Channel;
  expiresAt: string;
}

/** Implémenté par C2 (PIN, validation renforcée) ; consommé par C1. */
export interface StepUpPort {
  /** `verified: false` => l'action reste en `pending`. */
  requestStepUp(actor: Actor, pendingActionId: string): Promise<{ verified: boolean }>;
}

/* ------------------------------------------------------------------ */
/* Apprentissage                                                       */
/* ------------------------------------------------------------------ */

export type FeedbackKind = "accepted" | "edited" | "rejected";

export interface FeedbackInput {
  runId: string;
  agent: string;
  kind: FeedbackKind;
  before?: string;
  after?: string;
  outcome?: Record<string, unknown>;
}

export type RecordFeedback = (feedback: FeedbackInput) => Promise<void>;

/* ------------------------------------------------------------------ */
/* Embeddings et événements                                            */
/* ------------------------------------------------------------------ */

export interface EmbeddingPort {
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Registre des événements d'outbox (`domain_events`). Chaque périmètre ajoute
 * ses types par PR sur ce fichier. Distinct du `DomainEvent` de
 * `src/domain/events` (webhooks entrants normalisés).
 */
export interface OutboxEventMap {
  ProductChanged: { productId: string; change: "created" | "updated" | "deleted" };
}

export type OutboxEventType = keyof OutboxEventMap;

export interface EmitEventInput<T extends OutboxEventType = OutboxEventType> {
  tenantId: string;
  type: T;
  payload: OutboxEventMap[T];
  /** Idempotence : (tenantId, type, dedupeKey) unique. */
  dedupeKey?: string;
}

export type EmitEvent = <T extends OutboxEventType>(event: EmitEventInput<T>) => Promise<void>;
