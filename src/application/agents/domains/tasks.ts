/**
 * Domaine « Tâches planifiées » (étape 5) : demander à l'assistant de faire quelque chose plus tard ou régulièrement
 * (« chaque matin à 8 h, résume les commandes de la veille »).
 *
 * La tâche s'exécute avec les droits de son créateur et la politique de validation de l'entreprise : une action qui
 * demande validation devient une carte livrée dans le fil « Tâches planifiées ». Créer une tâche est `confirmAlways`
 * (on délègue de l'autorité dans le temps) et une tâche déjà en cours ne peut PAS en créer d'autres.
 */
import { z } from "zod";
import type { Actor, Role, ToolCtx, ToolDef, ToolPreview } from "../contracts";
import { AgentError } from "../errors";
import { describeSchedule, MAX_REPEAT_HOURS, MIN_REPEAT_HOURS, type TaskService } from "../task-service";
import type { DomainRegistrar } from "./index";

const uuid = z.string().uuid();
const short = (max: number) => z.string().trim().min(1).max(max);
const noAmount = async () => 0;
export const TASK_ROLES: readonly Role[] = ["owner", "admin"];
type AnyTool = ToolDef<any, unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any -- registre hétérogène

function requireInteractive(actor: Actor): void {
  if (actor.channel === "customer") throw new AgentError("actor_required", "Un client ne peut pas utiliser les outils de gestion");
  if (actor.channel === "scheduler") throw new AgentError("invalid_input", "Une tâche planifiée ne peut pas gérer les tâches planifiées.");
}

export function buildTaskTools(getService: () => TaskService): { tool: AnyTool; roles: readonly Role[] }[] {
  const def = <I, O>(d: Omit<ToolDef<I, O>, "domain" | "permission"> & { permission?: string }) => ({
    roles: TASK_ROLES,
    tool: { permission: "tasks.manage", ...d, domain: "tasks", run: async (ctx: ToolCtx, input: I) => { requireInteractive(ctx.actor); return d.run(ctx, input); } } as unknown as AnyTool,
  });
  const create = z.object({
    title: short(80), instruction: z.string().trim().min(5).max(1000),
    firstRunAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Format attendu : AAAA-MM-JJTHH:mm (heure de Douala)"),
    repeatEveryHours: z.number().int().min(MIN_REPEAT_HOURS).max(MAX_REPEAT_HOURS).optional(),
  });
  return [
    def({
      name: "tasks.list", description: "Liste les tâches planifiées : titre, fréquence, prochaine exécution, état, dernier résultat.",
      input: z.object({}), risk: "read",
      run: async (ctx) => ({
        tasks: (await getService().list(ctx.actor.tenantId)).map((t) => ({ id: t.id, title: t.title, schedule: describeSchedule(t), nextRunAt: t.nextRunAt, active: t.enabled, lastStatus: t.lastStatus })),
      }),
    }),
    def({
      name: "tasks.create", description: `Planifie une consigne pour l'assistant, une fois ou à répéter (toutes les ${MIN_REPEAT_HOURS} à ${MAX_REPEAT_HOURS} heures). Date en heure de Douala. La tâche agit avec VOS droits et vos règles de validation. Demande toujours une validation.`,
      input: create, risk: "write_reversible", confirmAlways: true,
      preview: async (_c: { actor: Actor }, i: z.infer<typeof create>): Promise<ToolPreview> => ({
        title: "Planifier une tâche", summary: `« ${i.title} » — ${describeSchedule({ kind: i.repeatEveryHours ? "interval" : "once", intervalSeconds: i.repeatEveryHours ? i.repeatEveryHours * 3600 : null })}, dès le ${i.firstRunAt.replace("T", " à ")}`,
        details: [{ label: "Consigne", value: i.instruction }, { label: "Première exécution", value: i.firstRunAt.replace("T", " ") }, { label: "Répétition", value: i.repeatEveryHours ? `toutes les ${i.repeatEveryHours} h` : "aucune" }, { label: "Droits", value: "Les vôtres : les actions sensibles ou soumises à validation vous seront proposées." }],
      }),
      run: async (ctx, i: z.infer<typeof create>) => getService().create({ tenantId: ctx.actor.tenantId, userId: ctx.actor.userId }, i),
    }),
    def({
      name: "tasks.pause", description: "Met une tâche planifiée en pause (reprise possible).",
      input: z.object({ taskId: uuid }), risk: "write_reversible", amountOf: noAmount,
      run: async (ctx, i: { taskId: string }) => { await getService().pause(ctx.actor.tenantId, i.taskId); return { active: false }; },
    }),
    def({
      name: "tasks.resume", description: "Réactive une tâche planifiée en pause.",
      input: z.object({ taskId: uuid }), risk: "write_reversible", amountOf: noAmount,
      run: async (ctx, i: { taskId: string }) => { await getService().resume(ctx.actor.tenantId, i.taskId); return { active: true }; },
    }),
    def({
      name: "tasks.delete", description: "Supprime une tâche planifiée.",
      input: z.object({ taskId: uuid }), risk: "write_reversible", amountOf: noAmount,
      run: async (ctx, i: { taskId: string }) => { await getService().remove(ctx.actor.tenantId, i.taskId); return { deleted: true }; },
    }),
  ];
}

export function createTasksRegistrar(getService: () => TaskService = defaultTaskService): DomainRegistrar {
  return ({ kernel }) => {
    for (const { tool, roles } of buildTaskTools(getService)) kernel.registerTool(tool, { roles });
  };
}

/** Branchement par défaut : le service Supabase n'est chargé qu'à la première utilisation (même principe que les autres domaines). */
export function defaultTaskService(): TaskService {
  const svc = () => import("@/infrastructure/agents/task-service-factory").then((m) => m.getTaskService());
  return {
    list: async (t) => (await svc()).list(t),
    create: async (a, i) => (await svc()).create(a, i),
    pause: async (t, id) => (await svc()).pause(t, id),
    resume: async (t, id) => (await svc()).resume(t, id),
    remove: async (t, id) => (await svc()).remove(t, id),
  };
}
