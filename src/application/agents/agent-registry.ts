/**
 * Registre d'agents. Un agent est un RÔLE (prompt, outils, niveau de modèle,
 * budget). Un sous-agent est exposé à l'orchestrateur comme un OUTIL nommé
 * `agent.<nom>` ; profondeur maximale 2 (orchestrateur = 0).
 */
import type { AgentDef } from "./contracts";
import { AgentError } from "./errors";
import type { ToolRegistryImpl } from "./tool-registry";
import { toLlmName } from "./tool-schema";

export const MAX_AGENT_DEPTH = 2;
export const AGENT_TOOL_PREFIX = "agent.";
const AGENT_NAME = /^[a-z][a-z0-9_]*$/;

export interface AgentRegistry {
  register(agent: AgentDef): void;
  get(name: string): AgentDef | undefined;
  list(): AgentDef[];
}

export function createAgentRegistry(): AgentRegistry {
  const agents = new Map<string, AgentDef>();
  return {
    register(agent) {
      if (!AGENT_NAME.test(agent.name)) throw new AgentError("registry_invalid", `Nom d'agent invalide : ${agent.name}`);
      if (agents.has(agent.name)) throw new AgentError("registry_invalid", `Agent déjà enregistré : ${agent.name}`);
      if (!agent.promptVersion.trim()) throw new AgentError("registry_invalid", `${agent.name} : promptVersion requise`);
      if (agent.budget.maxSteps < 1 || agent.budget.maxCredits < 1) {
        throw new AgentError("registry_invalid", `${agent.name} : budget invalide (maxSteps et maxCredits >= 1)`);
      }
      agents.set(agent.name, agent);
    },
    get: (name) => agents.get(name),
    list: () => [...agents.values()],
  };
}

/**
 * Vérifie le graphe d'agents : outils connus, noms exposables, pas de cycle,
 * profondeur <= MAX_AGENT_DEPTH. À appeler une fois tous les périmètres
 * enregistrés (au démarrage et en test). Renvoie la liste des problèmes.
 */
export function validateAgentGraph(agents: AgentRegistry, tools: ToolRegistryImpl): string[] {
  const problems: string[] = [];
  for (const agent of agents.list()) {
    for (const toolName of agent.tools) {
      try {
        toLlmName(toolName);
      } catch {
        problems.push(`${agent.name} : nom d'outil non exposable (${toolName})`);
        continue;
      }
      if (toolName.startsWith(AGENT_TOOL_PREFIX)) {
        if (!agents.get(toolName.slice(AGENT_TOOL_PREFIX.length))) problems.push(`${agent.name} : sous-agent inconnu (${toolName})`);
      } else if (!tools.get(toolName)) {
        problems.push(`${agent.name} : outil inconnu (${toolName})`);
      }
    }
  }

  const depthOf = (name: string, path: string[]): number => {
    if (path.includes(name)) {
      problems.push(`cycle d'agents : ${[...path, name].join(" -> ")}`);
      return 0;
    }
    const agent = agents.get(name);
    if (!agent) return 0;
    const children = agent.tools.filter((t) => t.startsWith(AGENT_TOOL_PREFIX)).map((t) => t.slice(AGENT_TOOL_PREFIX.length));
    return children.length === 0 ? 0 : 1 + Math.max(...children.map((child) => depthOf(child, [...path, name])));
  };
  for (const agent of agents.list()) {
    const depth = depthOf(agent.name, []);
    if (depth > MAX_AGENT_DEPTH) problems.push(`${agent.name} : profondeur ${depth} > ${MAX_AGENT_DEPTH}`);
  }
  return [...new Set(problems)];
}
