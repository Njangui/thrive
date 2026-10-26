/**
 * Export pseudonymisé de retours pour l'amélioration des agents (P5).
 *
 * DÉSACTIVÉ PAR DÉFAUT. Trois verrous cumulés :
 *   1. l'indicateur d'environnement `AGENT_TRAINING_EXPORT_ENABLED=true` ;
 *   2. un secret de pseudonymisation d'au moins 32 caractères ;
 *   3. un consentement actif de l'organisation (relu à chaque appel, et
 *      refiltré côté SQL : sans consentement, la fonction ne renvoie rien).
 * L'export ne contient ni commentaire libre, ni identifiant d'utilisateur ou
 * d'organisation, ni contenu de message. L'identifiant de run est remplacé par
 * un HMAC propre à l'organisation (impossible de relier deux organisations).
 */
import { createHmac } from "node:crypto";
import { AgentError } from "@/application/agents/errors";
import type { ConsentRepository } from "./consent-service";

export interface ExportRow {
  runId: string;
  agentName: string;
  promptVersion: string;
  modelTier: string;
  runStatus: string;
  rating: number;
  reasonCode: string | null;
  outcomes: string[];
  createdAt: string;
}

export interface TrainingExportRepository {
  rows(tenantId: string, since: Date | null, limit: number): Promise<ExportRow[]>;
}

export interface PseudonymizedRow extends Omit<ExportRow, "runId" | "createdAt"> {
  pseudoRunId: string;
  /** Jour seulement (pas d'horodatage précis) pour limiter la ré-identification. */
  day: string;
}

export function pseudonymize(secret: string, tenantId: string, runId: string): string {
  return createHmac("sha256", secret).update(`${tenantId}:${runId}`).digest("hex").slice(0, 32);
}

export function createTrainingExporter(deps: {
  repo: TrainingExportRepository;
  consents: Pick<ConsentRepository, "has">;
  enabled: boolean;
  secret: string | undefined;
}) {
  return {
    async export(input: { tenantId: string; since?: Date; limit?: number }): Promise<PseudonymizedRow[]> {
      if (!deps.enabled) throw new AgentError("export_disabled", "Export désactivé");
      if (!deps.secret || deps.secret.length < 32) throw new AgentError("export_disabled", "Secret de pseudonymisation insuffisant");
      if (!(await deps.consents.has(input.tenantId, "feedback_export"))) throw new AgentError("export_disabled", "Aucun consentement actif");
      const limit = Math.min(Math.max(Math.floor(input.limit ?? 1000), 1), 5000);
      const rows = await deps.repo.rows(input.tenantId, input.since ?? null, limit);
      const secret = deps.secret;
      return rows.map((r) => ({
        pseudoRunId: pseudonymize(secret, input.tenantId, r.runId),
        agentName: r.agentName, promptVersion: r.promptVersion, modelTier: r.modelTier, runStatus: r.runStatus,
        rating: r.rating, reasonCode: r.reasonCode, outcomes: r.outcomes, day: r.createdAt.slice(0, 10),
      }));
    },
  };
}
