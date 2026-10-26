/**
 * Tâches planifiées créées depuis le chat. Une tâche s'exécute plus tard avec les droits de son CRÉATEUR (voir scheduler.ts)
 * et reste soumise à la politique de validation : ce qui demande une validation produit une carte, jamais une action silencieuse.
 * Garde-fous de coût et de dérive : au plus 10 tâches actives par entreprise, répétition minimale d'une heure,
 * consigne de 1000 caractères max, dates dans le futur proche (1 an), agent fixe (`assistant`).
 */
import { AppError } from "@/lib/errors";

export const MAX_ACTIVE_TASKS = 10;
export const MIN_REPEAT_HOURS = 1;
export const MAX_REPEAT_HOURS = 24 * 31;
export const TASK_AGENT = "assistant";
/** Douala : UTC+1 toute l'année (pas d'heure d'été). */
const DOUALA_OFFSET_MS = 60 * 60 * 1000;

export interface TaskRecord {
  id: string; title: string | null; instruction: string; kind: "once" | "interval"; intervalSeconds: number | null;
  nextRunAt: string; enabled: boolean; lastRunAt: string | null; lastStatus: string | null; createdBy: string;
}

export interface TaskAdminRepository {
  list(tenantId: string): Promise<TaskRecord[]>;
  countActive(tenantId: string): Promise<number>;
  insert(row: { tenantId: string; createdBy: string; title: string; instruction: string; kind: "once" | "interval"; intervalSeconds: number | null; nextRunAt: string }): Promise<{ id: string }>;
  setEnabled(tenantId: string, id: string, enabled: boolean, nextRunAt?: string): Promise<boolean>;
  remove(tenantId: string, id: string): Promise<boolean>;
  get(tenantId: string, id: string): Promise<TaskRecord | null>;
}

const bad = (message: string) => new AppError(message, 400, "validation");

/** « AAAA-MM-JJTHH:mm » en heure de Douala -> instant UTC. */
export function parseDoualaDateTime(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw bad("Date attendue au format AAAA-MM-JJTHH:mm (heure de Douala).");
  const [, y, mo, d, h, mi] = m.map(Number) as number[];
  const utc = Date.UTC(y!, mo! - 1, d!, h!, mi!) - DOUALA_OFFSET_MS;
  const date = new Date(utc);
  if (Number.isNaN(date.getTime()) || date.getUTCMonth() !== mo! - 1) throw bad("Date invalide.");
  return date;
}

export interface CreateTaskInput { title: string; instruction: string; firstRunAt: string; repeatEveryHours?: number }

export function validateTaskInput(input: CreateTaskInput, now: Date): { title: string; instruction: string; kind: "once" | "interval"; intervalSeconds: number | null; nextRunAt: Date } {
  const title = input.title.trim(), instruction = input.instruction.trim();
  if (title.length < 1 || title.length > 80) throw bad("Le titre doit faire 1 à 80 caractères.");
  if (instruction.length < 5 || instruction.length > 1000) throw bad("La consigne doit faire 5 à 1000 caractères.");
  const next = parseDoualaDateTime(input.firstRunAt);
  if (next.getTime() < now.getTime() + 60_000) throw bad("La première exécution doit être dans le futur.");
  if (next.getTime() > now.getTime() + 366 * 86_400_000) throw bad("La première exécution ne peut pas dépasser un an.");
  const hours = input.repeatEveryHours;
  if (hours === undefined) return { title, instruction, kind: "once", intervalSeconds: null, nextRunAt: next };
  if (!Number.isInteger(hours) || hours < MIN_REPEAT_HOURS || hours > MAX_REPEAT_HOURS) throw bad(`La répétition doit être de ${MIN_REPEAT_HOURS} heure(s) à ${MAX_REPEAT_HOURS} heures.`);
  return { title, instruction, kind: "interval", intervalSeconds: hours * 3600, nextRunAt: next };
}

export function describeSchedule(t: Pick<TaskRecord, "kind" | "intervalSeconds">): string {
  if (t.kind === "once" || !t.intervalSeconds) return "une seule fois";
  const h = t.intervalSeconds / 3600;
  return h === 24 ? "tous les jours" : h === 168 ? "toutes les semaines" : h === 1 ? "toutes les heures" : `toutes les ${h} heures`;
}

export function createTaskService(deps: { repo: TaskAdminRepository; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  return {
    list: (tenantId: string) => deps.repo.list(tenantId),
    async create(actor: { tenantId: string; userId: string }, input: CreateTaskInput): Promise<{ id: string; nextRunAt: string }> {
      const v = validateTaskInput(input, now());
      if ((await deps.repo.countActive(actor.tenantId)) >= MAX_ACTIVE_TASKS) throw bad(`Limite de ${MAX_ACTIVE_TASKS} tâches actives atteinte : mettez-en une en pause ou supprimez-en une.`);
      const r = await deps.repo.insert({ tenantId: actor.tenantId, createdBy: actor.userId, title: v.title, instruction: v.instruction, kind: v.kind, intervalSeconds: v.intervalSeconds, nextRunAt: v.nextRunAt.toISOString() });
      return { id: r.id, nextRunAt: v.nextRunAt.toISOString() };
    },
    async pause(tenantId: string, id: string): Promise<void> {
      if (!(await deps.repo.setEnabled(tenantId, id, false))) throw new AppError("Tâche introuvable.", 404, "not_found");
    },
    async resume(tenantId: string, id: string): Promise<void> {
      const t = await deps.repo.get(tenantId, id);
      if (!t) throw new AppError("Tâche introuvable.", 404, "not_found");
      if (!t.enabled && (await deps.repo.countActive(tenantId)) >= MAX_ACTIVE_TASKS) throw bad(`Limite de ${MAX_ACTIVE_TASKS} tâches actives atteinte.`);
      // Jamais de rattrapage en rafale : une échéance passée repart d'après l'intervalle (une fois pour « une seule fois »).
      let next: string | undefined;
      if (new Date(t.nextRunAt).getTime() <= now().getTime()) next = new Date(now().getTime() + (t.intervalSeconds ?? 300) * 1000).toISOString();
      await deps.repo.setEnabled(tenantId, id, true, next);
    },
    async remove(tenantId: string, id: string): Promise<void> {
      if (!(await deps.repo.remove(tenantId, id))) throw new AppError("Tâche introuvable.", 404, "not_found");
    },
  };
}
export type TaskService = ReturnType<typeof createTaskService>;
