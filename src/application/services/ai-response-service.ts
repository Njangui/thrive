import { getAIProvider } from "@/infrastructure/providers/registry";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { buildTenantAIContext } from "./tenant-ai-context";
import { consumeCredit, releaseCredit } from "./ai-credits-service";
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
 *
 * CORRECTIF Lot 3 (audit master prompt §30/§71) : le crédit est
 * maintenant RÉSERVÉ atomiquement AVANT l'appel LLM (plus
 * hasCreditsAvailable() suivi d'un consumeCredit() best-effort après
 * coup — cette séquence check-then-act laissait une fenêtre où deux
 * requêtes concurrentes passaient toutes les deux le check, généraient
 * TOUTES LES DEUX une réponse payante, avant que la comptabilité ne
 * s'aperçoive du dépassement). Si la génération échoue malgré tout
 * (primary ET fallback), le crédit réservé est remboursé — jamais
 * consommé pour une génération qui n'a pas réellement eu lieu (section 30).
 */
export async function generateAIReply(
  organizationId: string,
  userMessage: string,
  recentProducts: CatalogProductSummary[] = [],
): Promise<AITextResponse> {
  const reservation = await consumeCredit(organizationId);
  if (!reservation.success) {
    throw new QuotaExceededError("Crédits IA épuisés pour cette organisation.");
  }

  const { primary, fallback } = await getAIProvider(organizationId);
  const systemPrompt = await buildTenantAIContext(organizationId, recentProducts);

  let result: AITextResponse;
  try {
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
  } catch (generationError) {
    // Ni primary ni fallback n'ont abouti : aucune génération n'a
    // réellement eu lieu, le crédit réservé ne doit pas rester consommé.
    await releaseCredit(organizationId);
    throw generationError;
  }

  return result;
}
