import { buildTenantAIContext } from "./tenant-ai-context";
import { runAITask } from "./ai-metering";
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
 * maintenant RÉSERVÉ atomiquement AVANT l'appel LLM (mais APRÈS la
 * vérification que l'IA est réellement disponible pour ce tenant — voir
 * le correctif de sept. 2026 dans `generateAIReply`) (plus
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
  // Contexte (lecture DB, gratuit) construit avant toute réservation de crédit. `runAITask` vérifie
  // ensuite que l'IA est disponible, route vers le bon modèle (réponse client = niveau simple),
  // réserve les crédits de la tâche, gère le repli, le remboursement et le journal de tokens.
  const systemPrompt = await buildTenantAIContext(organizationId, recentProducts);
  return runAITask({
    organizationId,
    task: "customer_reply",
    inputChars: systemPrompt.length + userMessage.length,
    call: (provider) => provider.generateText({ systemPrompt, userMessage }),
  });
}
