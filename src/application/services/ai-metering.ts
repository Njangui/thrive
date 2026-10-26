import type { AIChatResponse, AIProvider, AITextResponse } from "@/domain/ports/ai-provider";
import { routeTask, tokenSurchargeCredits, type AITaskKind, type AITier } from "@/domain/ai-routing";
import { getAIProvider } from "@/infrastructure/providers/registry";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { QuotaExceededError } from "@/lib/errors";
import { consumeCredit, releaseCredit } from "./ai-credits-service";

type UsageCarrier = Pick<AITextResponse | AIChatResponse, "provider" | "model" | "usage">;

/** Journalise les tokens réels d'un appel (best-effort : ne bloque jamais la réponse). */
export async function recordTokenUsage(
  organizationId: string,
  entry: { task: AITaskKind | string; tier: AITier; response: UsageCarrier | undefined; creditsCharged: number },
): Promise<void> {
  try {
    const r = entry.response;
    if (!r) return;
    const { error } = await getSupabaseServiceClient().from("ai_token_usage").insert({
      organization_id: organizationId,
      task: String(entry.task).slice(0, 60),
      tier: entry.tier,
      provider: r.provider,
      model: r.model,
      input_tokens: r.usage?.inputTokens ?? 0,
      output_tokens: r.usage?.outputTokens ?? 0,
      credits_charged: entry.creditsCharged,
    });
    if (error) console.error(`recordTokenUsage(${organizationId}):`, error.message);
  } catch (error) {
    console.error(`recordTokenUsage(${organizationId}) ignoré:`, error);
  }
}

/** Facturation du supplément de tokens APRÈS l'appel. Ne lève jamais ; renvoie les crédits réellement débités. */
export async function chargeTokenSurcharge(organizationId: string, task: string, response: UsageCarrier | undefined): Promise<number> {
  const total = (response?.usage?.inputTokens ?? 0) + (response?.usage?.outputTokens ?? 0);
  const extra = tokenSurchargeCredits(total);
  if (extra <= 0) return 0;
  try {
    const out = await consumeCredit(organizationId, extra, `ai_${task}_tokens`, { totalTokens: total });
    return out.success ? extra : 0; // solde insuffisant : le service a déjà été rendu, on ne reprend rien
  } catch (error) {
    console.error(`chargeTokenSurcharge(${organizationId}) ignoré:`, error);
    return 0;
  }
}

/**
 * Exécute une tâche IA de bout en bout : routage (simple/complexe), réservation atomique des
 * crédits de la tâche AVANT l'appel, repli sur le second fournisseur, remboursement si rien
 * n'a été généré, supplément selon les tokens réels, puis journal de consommation.
 */
export async function runAITask<T extends { usage?: UsageCarrier["usage"]; provider?: string; model?: string } | { raw: UsageCarrier }>(args: {
  organizationId: string;
  task: AITaskKind;
  inputChars?: number;
  call: (provider: AIProvider) => Promise<T>;
}): Promise<T> {
  const { organizationId, task } = args;
  const route = routeTask(task, { inputChars: args.inputChars });

  // L'IA doit être réellement disponible avant de réserver quoi que ce soit.
  const { primary, fallback } = await getAIProvider(organizationId, route.tier);

  const reservation = await consumeCredit(organizationId, route.credits, `ai_${task}`, { task, tier: route.tier });
  if (!reservation.success) throw new QuotaExceededError("Crédits IA épuisés pour cette organisation.");

  let result: T;
  try {
    try {
      result = await args.call(primary);
    } catch (primaryError) {
      if (!fallback) throw primaryError;
      console.warn(`[AI fallback] org=${organizationId} task=${task} ${primary.providerName} -> ${fallback.providerName}:`, primaryError);
      try {
        await getSupabaseServiceClient().from("audit_logs").insert({
          organization_id: organizationId,
          action: "AI_PROVIDER_FALLBACK",
          entity_type: "ai_config",
          after_state: { task, from: primary.providerName, to: fallback.providerName, error: primaryError instanceof Error ? primaryError.message : String(primaryError) },
        });
      } catch {
        /* l'audit ne doit jamais bloquer la réponse */
      }
      result = await args.call(fallback);
    }
  } catch (error) {
    await releaseCredit(organizationId, route.credits);
    throw error;
  }

  const carrier = ("raw" in result ? (result as { raw: UsageCarrier }).raw : (result as unknown as UsageCarrier)) as UsageCarrier;
  const extra = await chargeTokenSurcharge(organizationId, task, carrier);
  await recordTokenUsage(organizationId, { task, tier: route.tier, response: carrier, creditsCharged: route.credits + extra });
  return result;
}

/** Synthèse de consommation (jauge/tableau de bord) sur les `days` derniers jours. */
export async function getTokenUsageSummary(organizationId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await getSupabaseServiceClient()
    .from("ai_token_usage")
    .select("task, tier, provider, model, input_tokens, output_tokens, credits_charged")
    .eq("organization_id", organizationId)
    .gte("created_at", since)
    .limit(5000);
  if (error) throw new Error(`Lecture ai_token_usage: ${error.message}`);
  const byTask: Record<string, { calls: number; inputTokens: number; outputTokens: number; credits: number }> = {};
  for (const row of data ?? []) {
    const t = (byTask[row.task as string] ??= { calls: 0, inputTokens: 0, outputTokens: 0, credits: 0 });
    t.calls += 1;
    t.inputTokens += row.input_tokens as number;
    t.outputTokens += row.output_tokens as number;
    t.credits += row.credits_charged as number;
  }
  const totals = Object.values(byTask).reduce(
    (acc, t) => ({ calls: acc.calls + t.calls, inputTokens: acc.inputTokens + t.inputTokens, outputTokens: acc.outputTokens + t.outputTokens, credits: acc.credits + t.credits }),
    { calls: 0, inputTokens: 0, outputTokens: 0, credits: 0 },
  );
  return { days, byTask, totals };
}
