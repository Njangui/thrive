/**
 * Noyau partagé (singleton par processus) : C2 à C5 y enregistrent leurs
 * outils et leurs agents. L'enregistrement se fait dans `domains/index.ts`
 * (une fonction par périmètre) ; `getAgentKernel()` l'exécute une seule fois.
 */
import { createAgentRegistry, validateAgentGraph, type AgentRegistry } from "./agent-registry";
import { AgentError } from "./errors";
import { createAgentKernel, type AgentKernel } from "./tool-registry";
import { domainRegistrars } from "./domains";

export interface SharedAgentKernel {
  kernel: AgentKernel;
  agents: AgentRegistry;
}

let shared: SharedAgentKernel | null = null;

export function getAgentKernel(): SharedAgentKernel {
  if (shared) return shared;
  const kernel = createAgentKernel();
  const agents = createAgentRegistry();
  for (const register of domainRegistrars) register({ kernel, agents });
  const problems = validateAgentGraph(agents, kernel.registry);
  if (problems.length > 0) {
    throw new AgentError("registry_invalid", `Graphe d'agents invalide : ${problems.join(" ; ")}`);
  }
  shared = { kernel, agents };
  return shared;
}

/** Tests uniquement. */
export function resetAgentKernelForTests(): void {
  shared = null;
}
