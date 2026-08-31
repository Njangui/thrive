import { getAIProvider } from "@/infrastructure/providers/registry";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { buildTenantAIContext } from "./tenant-ai-context";
import { hasCreditsAvailable, consumeCredit } from "./ai-credits-service";
import { QuotaExceededError } from "@/lib/errors";
import type { AITextResponse } from "@/domain/ports/ai-provider";
import type { CatalogProductSummary } from "./catalog-service";

/**
 * FUSION (mérge de Lot B + Lot D, voir RAPPORT_FUSION.md) : ce fichier
 * portait un `// TODO(fusion, Lot D notifications)` détaillé, écrit
 * quand Lot D n'avait aucune visibilité sur un système de crédits IA
 * (snapshot arrêté à 0010_marketing_social_publishing.sql). Lot B a
 * depuis livré `hasCreditsAvailable()`/`consumeCredit()`
 * (ai-credits-service.ts, testées) — câblés ici.
 *
 * Note : contrairement au pseudo-code laissé par Lot D (qui supposait un
 * `AiCreditsExhaustedError` catché ICI avec un appel dédié à
 * `notifyOrgAdmins`), Lot B n'a PAS introduit une telle classe — il lève
 * `QuotaExceededError` (lib/errors.ts) de façon générique pour tout
 * dépassement de plan. Pas besoin d'un `notifyOrgAdmins` dédié ici non
 * plus : `conversation-orchestrator.ts` catche déjà toute erreur venue
 * de `generateAIReply` et escalade vers un humain
 * (`handoffReason: "ai_unavailable"`), et le webhook Zernio appelle déjà
 * `escalateToHuman()` dans ce cas — qui notifie déjà les admins
 * (handoff-service.ts). Ajouter une notification ici doublonnerait.
 */
export async function generateAIReply(
  organizationId: string,
  userMessage: string,
  recentProducts: CatalogProductSummary[] = [],
): Promise<AITextResponse> {
  if (!(await hasCreditsAvailable(organizationId))) {
    throw new QuotaExceededError("Crédits IA épuisés pour cette organisation.");
  }

  const { primary, fallback } = await getAIProvider(organizationId);
  const systemPrompt = await buildTenantAIContext(organizationId, recentProducts);

  let result: AITextResponse;
  try {
    result = await primary.generateText({ systemPrompt, userMessage });
  } catch (primaryError) {
    if (!fallback) throw primaryError;

    console.warn(
      `[AI fallback] org=${organizationId} provider=${primary.providerName} -> ${fallback.providerName}:`,
      primaryError,
    );

    await getSupabaseServiceClient()
      .from("audit_logs")
      .insert({
        organization_id: organizationId,
        action: "AI_PROVIDER_FALLBACK",
        entity_type: "ai_config",
        after_state: {
          from: primary.providerName,
          to: fallback.providerName,
          error: primaryError instanceof Error ? primaryError.message : String(primaryError),
        },
      });

    result = await fallback.generateText({ systemPrompt, userMessage });
  }

  // Best-effort (même logique que le reste du système de crédits, Lot B) :
  // une consommation non enregistrée ne doit jamais faire échouer une
  // réponse déjà générée et sur le point d'être envoyée au contact.
  await consumeCredit(organizationId).catch((err) =>
    console.warn(`[ai-credits] échec consumeCredit(${organizationId}):`, err),
  );

  return result;
}
