import type { ZodType } from "zod";
import type { AgentActor } from "@/application/channels/actor";

/**
 * Contrat d'outil de l'agent Opérations — MIROIR LOCAL de l'esquisse de C1
 * (`src/application/agents/contracts.ts`, contexte commun §5). À remplacer par
 * `export type { RiskLevel, ToolDef, ToolCtx } from "../contracts"` quand C1 livre ;
 * seuls les champs marqués « EXTENSION » sont des propositions à intégrer au contrat.
 */
export type RiskLevel = "read" | "write_reversible" | "sensitive";

export interface ToolCtx {
  actor: AgentActor;
  /** Horloge injectable (tests, planificateur). */
  now: () => Date;
}

/** Aperçu lisible d'une action pour la carte d'approbation — rédigé par le CODE, jamais par le LLM. */
export interface ToolPreview {
  title: string;
  summary: string;
  details: { label: string; value: string }[];
}

export interface ToolDef<I = unknown, O = unknown> {
  name: string;
  domain: string;
  description: string;
  input: ZodType<I>;
  risk: RiskLevel;
  /** Permission requise (voir role-matrix.ts). */
  permission: string;
  run: (ctx: ToolCtx, input: I) => Promise<O>;
  /** Montant de l'action (devise de l'entreprise), calculé par le code : sert aux seuils « auto jusqu'à X » du propriétaire. */
  amountOf?: (ctx: { actor: { tenantId: string } }, input: I) => Promise<number | undefined>;
  /** EXTENSION proposée : aperçu pour la carte d'approbation (outils `sensitive`). */
  preview?: (ctx: ToolCtx, input: I) => Promise<ToolPreview>;
}
