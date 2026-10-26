import { buildOpsTools } from "./ops-tools";
import { defaultOpsServices } from "./ops-services";

export type { ToolDef, ToolCtx, RiskLevel, ToolPreview } from "./ops-contract";
export { OPS_PERMISSIONS, hasPermission, assertPermission, type OpsPermission } from "./role-matrix";
export { buildOpsTools } from "./ops-tools";
export type { OpsServices } from "./ops-services";

/** Outils Opérations branchés sur les vrais services — à enregistrer dans le registre d'outils de C1. */
export function getOpsTools() {
  return buildOpsTools(defaultOpsServices());
}
