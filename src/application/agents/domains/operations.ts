/**
 * Domaine « Opérations » : enregistre les outils de gestion quotidienne (commandes, stock, produits, rendez-vous,
 * finance, contacts) dans le noyau agent, et définit l'agent principal du chat (`assistant`).
 *
 * Les outils eux-mêmes (`ops/ops-tools.ts`) restent des enveloppes typées des services existants : le chat et le tableau
 * de bord appellent la MÊME logique métier. Les rôles autorisés sont ceux de `ops/role-matrix.ts`, calqués sur les gardes
 * des écrans du tableau de bord.
 */
import type { AgentActor } from "@/application/channels/actor";
import type { Actor, ToolDef } from "../contracts";
import { AgentError } from "../errors";
import { getOpsTools } from "../ops";
import { OPS_PERMISSIONS } from "../ops/role-matrix";
import type { ToolDef as OpsToolDef } from "../ops/ops-contract";
import type { DomainRegistrar } from "./index";

/** Acteur noyau -> acteur Opérations. L'adhésion est obligatoire (authentification renforcée, remboursement). */
export function toOpsActor(actor: Actor): AgentActor {
  if (!actor.membershipId) throw new AgentError("actor_required", "Adhésion de l'acteur requise pour cet outil");
  if (actor.channel === "customer") throw new AgentError("actor_required", "Un client ne peut pas utiliser les outils de gestion");
  return {
    userId: actor.userId, tenantId: actor.tenantId, membershipId: actor.membershipId, role: actor.role, extraPermissions: actor.extraPermissions,
    // Une tâche planifiée agit au nom d'un humain : elle reste soumise à ses droits et à sa politique de validation.
    channel: actor.channel === "scheduler" ? "dashboard" : actor.channel,
  };
}

export function adaptOpsTool(tool: OpsToolDef): ToolDef<unknown, unknown> {
  const t = tool as OpsToolDef<unknown, unknown>;
  const now = () => new Date();
  return {
    name: t.name,
    domain: t.domain,
    description: t.description,
    input: t.input,
    risk: t.risk,
    permission: t.permission,
    run: (ctx, input) => t.run({ actor: toOpsActor(ctx.actor), now }, input),
    preview: t.preview ? (ctx, input) => t.preview!({ actor: toOpsActor(ctx.actor), now }, input) : undefined,
    amountOf: t.amountOf ? (ctx, input) => t.amountOf!({ actor: { tenantId: ctx.actor.tenantId } }, input) : undefined,
  };
}

export function createOperationsRegistrar(opsTools: OpsToolDef[] = getOpsTools() as unknown as OpsToolDef[]): DomainRegistrar {
  return ({ kernel }) => {
    for (const tool of opsTools) {
      const roles = (OPS_PERMISSIONS as Record<string, readonly ("owner" | "admin" | "manager" | "employee")[]>)[tool.permission];
      if (!roles) throw new AgentError("registry_invalid", `Permission Opérations inconnue : ${tool.permission}`);
      kernel.registerTool(adaptOpsTool(tool), { roles });
    }
  };
}
