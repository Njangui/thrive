/**
 * Un registrar par périmètre. Chaque Claude ajoute SA ligne dans la PR qui
 * livre ses outils (et sa ligne dans docs/agents/ROLE_TOOL_MATRIX.md).
 *
 *   import { registerOperations } from "./operations";   // C2
 *   export const domainRegistrars = [registerOperations, ...];
 */
import type { AgentRegistry } from "../agent-registry";
import type { AgentKernel } from "../tool-registry";

export type DomainRegistrar = (shared: { kernel: AgentKernel; agents: AgentRegistry }) => void;

import { createTasksRegistrar } from "./tasks";
import { createSiteRegistrar } from "./site";
import { createProspectingRegistrar } from "./prospecting";
import { assistantRegistrar } from "./assistant";
import { createAdminRegistrar } from "./admin";
import { createCommerceRegistrar } from "./commerce";
import { createMarketingRegistrar } from "./marketing";
import { createOperationsRegistrar } from "./operations";

/** Un registrar par périmètre, exécuté une fois par `getAgentKernel()`. */
export const domainRegistrars: DomainRegistrar[] = [createOperationsRegistrar(), createCommerceRegistrar(), createMarketingRegistrar(), createAdminRegistrar(), createTasksRegistrar(), createSiteRegistrar(), createProspectingRegistrar(), assistantRegistrar];
