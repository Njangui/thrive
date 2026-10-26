/**
 * Registre d'outils + noyau (registre ⊕ matrice). Chaque périmètre branche
 * ses outils via `kernel.registerTool(tool, { roles })` (voir c1-architecture.md).
 */
import type { Role, ToolDef, ToolRegistry } from "./contracts";
import { AgentError } from "./errors";
import { createPermissionMatrix, type PermissionMatrix } from "./role-matrix";

const TOOL_NAME_FORMAT = /^[a-z][a-z0-9_]*\.[a-z][a-zA-Z0-9_]*$/;

export interface ToolRegistryImpl extends ToolRegistry {
  list(): ToolDef<unknown, unknown>[];
}

export function createToolRegistry(): ToolRegistryImpl {
  const tools = new Map<string, ToolDef<unknown, unknown>>();
  return {
    register<I, O>(tool: ToolDef<I, O>) {
      if (!TOOL_NAME_FORMAT.test(tool.name)) {
        throw new AgentError("registry_invalid", `Nom d'outil invalide : ${tool.name} (attendu domaine.action)`);
      }
      if (!tool.name.startsWith(`${tool.domain}.`)) {
        throw new AgentError("registry_invalid", `${tool.name} : le nom doit commencer par « ${tool.domain}. »`);
      }
      if (tools.has(tool.name)) {
        throw new AgentError("registry_invalid", `Outil déjà enregistré : ${tool.name}`);
      }
      if (!tool.description.trim()) {
        throw new AgentError("registry_invalid", `${tool.name} : description requise`);
      }
      if (tool.storefrontSafe && tool.risk === "sensitive") {
        throw new AgentError("registry_invalid", `${tool.name} : un outil sensible ne peut pas être exposé à la vitrine`);
      }
      tools.set(tool.name, tool as unknown as ToolDef<unknown, unknown>);
    },
    get: (name) => tools.get(name),
    listForDomain: (domain) => [...tools.values()].filter((tool) => tool.domain === domain),
    list: () => [...tools.values()],
  };
}

export interface AgentKernel {
  registry: ToolRegistryImpl;
  matrix: PermissionMatrix;
  registerTool<I, O>(tool: ToolDef<I, O>, access: { roles: readonly Role[] }): void;
}

export function createAgentKernel(): AgentKernel {
  const registry = createToolRegistry();
  const matrix = createPermissionMatrix();
  return {
    registry,
    matrix,
    registerTool(tool, access) {
      matrix.define(tool.permission, access.roles);
      registry.register(tool);
    },
  };
}
