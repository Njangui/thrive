import type { AgentEvent, AgentRunInput, AgentRuntimePort, ApprovalOutcome, VisibleTool } from "@/domain/ports/agent-runtime-port";

/**
 * Runtime par défaut tant que C1 n'a pas livré le sien : il ne fait RIEN et le
 * dit clairement. Aucune réponse inventée.
 */
export class UnavailableAgentRuntime implements AgentRuntimePort {
  readonly name = "unavailable";
  async *run(_input: AgentRunInput): AsyncIterable<AgentEvent> {
    yield { type: "error", code: "unavailable", message: "L'assistant de pilotage n'est pas encore activé sur ce déploiement." };
  }
  async decideApproval(): Promise<ApprovalOutcome> {
    return { status: "failed", message: "Aucune action en attente : l'assistant de pilotage n'est pas activé." };
  }
  async listVisibleTools(): Promise<VisibleTool[]> {
    return [];
  }
}

let runtime: AgentRuntimePort | null = null;
/** Point d'accroche pour C1 : `registerAgentRuntime(new C1Runtime(...))` au démarrage serveur. */
export function registerAgentRuntime(next: AgentRuntimePort): void { runtime = next; }
/**
 * Activation : `AGENT_RUNTIME_ENABLED=true` branche le vrai runtime (créé à la première utilisation) ; sans cela,
 * l'assistant répond franchement qu'il n'est pas activé. Aucun mode « gratuit » : l'usage est mesuré en production.
 */
export function getAgentRuntime(): AgentRuntimePort {
  if (runtime) return runtime;
  if (process.env.AGENT_RUNTIME_ENABLED === "true") {
    // Import différé : évite de charger Supabase tant que l'assistant n'est pas activé.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { buildKernelRuntime } = require("./production-runtime") as typeof import("./production-runtime");
    runtime = buildKernelRuntime();
  } else {
    return new UnavailableAgentRuntime();
  }
  return runtime;
}
export function resetAgentRuntimeForTests(): void { runtime = null; }
