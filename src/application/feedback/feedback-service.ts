/**
 * Retours utilisateurs et résultats observés (P5). Aucun contenu de message
 * n'est stocké dans les résultats ; le commentaire libre est facultatif,
 * borné à 500 caractères et JAMAIS exporté.
 */
import { z } from "zod";
import { AgentError } from "@/application/agents/errors";
import type { Actor } from "@/application/agents/contracts";

/** UUID au format canonique (Zod 4 impose les bits de version RFC ; Postgres accepte tout uuid). */
const UuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const FeedbackInputSchema = z.object({
  runId: UuidSchema,
  rating: z.union([z.literal(1), z.literal(-1)]),
  reasonCode: z.enum(["wrong_info", "tone", "incomplete", "too_slow", "unsafe", "other"]).optional(),
  comment: z.string().trim().max(500).optional(),
});
export type FeedbackInput = z.infer<typeof FeedbackInputSchema>;

export const OutcomeKinds = [
  "draft_sent", "draft_edited", "draft_discarded", "suggestion_accepted", "suggestion_rejected", "action_approved", "action_rejected",
] as const;
export type OutcomeKind = (typeof OutcomeKinds)[number];

export interface FeedbackRepository {
  record(input: { tenantId: string; runId: string; actorId: string; rating: 1 | -1; reasonCode?: string; comment?: string }):
    Promise<"recorded" | "run_not_found" | "forbidden">;
  recordOutcome(input: { tenantId: string; runId?: string; actorId?: string; kind: OutcomeKind; toolName?: string; meta?: Record<string, string | number | boolean> }): Promise<void>;
}

export function createFeedbackService(repo: FeedbackRepository) {
  return {
    async submitFeedback(actor: Actor, raw: unknown) {
      // Un client final (canal storefront) n'évalue pas les agents internes.
      if (actor.channel === "customer" || actor.channel === "scheduler") throw new AgentError("feedback_invalid", "Canal non autorisé");
      const parsed = FeedbackInputSchema.safeParse(raw);
      if (!parsed.success) throw new AgentError("feedback_invalid", "Retour invalide");
      const { runId, rating, reasonCode, comment } = parsed.data;
      return repo.record({
        tenantId: actor.tenantId, runId, actorId: actor.userId, rating,
        reasonCode: rating === -1 ? reasonCode : undefined, comment: comment || undefined,
      });
    },

    async recordOutcome(actor: Actor, input: { kind: OutcomeKind; runId?: string; toolName?: string; meta?: Record<string, string | number | boolean> }) {
      if (!OutcomeKinds.includes(input.kind)) throw new AgentError("feedback_invalid", "Type de résultat inconnu");
      if (input.runId && !UuidSchema.safeParse(input.runId).success) throw new AgentError("feedback_invalid", "Run invalide");
      if (input.meta && Object.values(input.meta).some((v) => typeof v === "string" && v.length > 100)) {
        throw new AgentError("feedback_invalid", "Métadonnées trop longues (pas de contenu libre)");
      }
      await repo.recordOutcome({ tenantId: actor.tenantId, actorId: actor.userId, ...input });
    },
  };
}
