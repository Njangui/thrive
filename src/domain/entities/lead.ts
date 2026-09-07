import { z } from "zod";

export const LeadStatusSchema = z.enum([
  "visitor",
  "lead",
  "qualified",
  "opportunity",
  "customer",
  "lost",
]);

export type LeadStatus = z.infer<typeof LeadStatusSchema>;

export const LeadSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
  status: LeadStatusSchema,
  source: z.string().nullable(),
  intent: z.string().nullable(),
  budgetEstimate: z.number().nullable(),
  score: z.number().min(0).max(100).nullable(),
  scoreReason: z.string().nullable(),
  scoreModel: z.string().nullable(),
  assignedUserId: z.string().uuid().nullable(),
  lastContactAt: z.string().nullable(),
  nextFollowUpAt: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Lead = z.infer<typeof LeadSchema>;

/**
 * Résultat d'un calcul de score — section 12 : ne jamais présenter un score
 * sans sa raison ni le modèle qui l'a produit (FACT vs ESTIMATION, section 26).
 */
export const LeadScoreResultSchema = z.object({
  score: z.number().min(0).max(100),
  reason: z.string(),
  model: z.string(), // ex: 'rule-based-v1' ou 'mistral-small-latest'
  computedAt: z.string(),
});

export type LeadScoreResult = z.infer<typeof LeadScoreResultSchema>;
