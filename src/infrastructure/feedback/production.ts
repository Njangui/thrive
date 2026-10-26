/** Assemblage de production de P5. L'export reste DÉSACTIVÉ tant que l'environnement ne l'active pas explicitement. */
import type { AuditSink } from "@/application/agents/audit";
import { createConsentService } from "@/application/feedback/consent-service";
import { createFeedbackService } from "@/application/feedback/feedback-service";
import { createTrainingExporter } from "@/application/feedback/training-export";
import {
  createSupabaseConsentRepository,
  createSupabaseFeedbackRepository,
  createSupabaseTrainingExportRepository,
} from "./supabase-feedback-repositories";

export const createProductionFeedbackService = () => createFeedbackService(createSupabaseFeedbackRepository());
export const createProductionConsentService = (audit: AuditSink) =>
  createConsentService({ repo: createSupabaseConsentRepository(), audit });

export function createProductionTrainingExporter() {
  return createTrainingExporter({
    repo: createSupabaseTrainingExportRepository(),
    consents: createSupabaseConsentRepository(),
    enabled: process.env.AGENT_TRAINING_EXPORT_ENABLED === "true",
    secret: process.env.AGENT_EXPORT_PSEUDONYM_SECRET,
  });
}
