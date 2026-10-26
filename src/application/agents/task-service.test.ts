import { describe, expect, it } from "vitest";
import { createTaskService, describeSchedule, parseDoualaDateTime, validateTaskInput, MAX_ACTIVE_TASKS, type TaskAdminRepository, type TaskRecord } from "./task-service";

const NOW = new Date("2026-10-23T08:00:00Z");

function repo(initial: TaskRecord[] = []) {
  const rows = [...initial];
  const r: TaskAdminRepository = {
    list: async () => rows, get: async (_t, id) => rows.find((x) => x.id === id) ?? null, countActive: async () => rows.filter((x) => x.enabled).length,
    insert: async (row) => { const rec: TaskRecord = { id: `t${rows.length + 1}`, title: row.title, instruction: row.instruction, kind: row.kind, intervalSeconds: row.intervalSeconds, nextRunAt: row.nextRunAt, enabled: true, lastRunAt: null, lastStatus: null, createdBy: row.createdBy }; rows.push(rec); return { id: rec.id }; },
    setEnabled: async (_t, id, enabled, next) => { const x = rows.find((y) => y.id === id); if (!x) return false; x.enabled = enabled; if (next) x.nextRunAt = next; return true; },
    remove: async (_t, id) => { const i = rows.findIndex((y) => y.id === id); if (i < 0) return false; rows.splice(i, 1); return true; },
  };
  return { r, rows };
}
const rec = (over: Partial<TaskRecord> = {}): TaskRecord => ({ id: "x", title: "t", instruction: "ii", kind: "interval", intervalSeconds: 3600, nextRunAt: "2026-10-23T10:00:00Z", enabled: true, lastRunAt: null, lastStatus: null, createdBy: "u", ...over });

describe("tâches planifiées", () => {
  it("l'heure est celle de Douala (UTC+1) ; dates impossibles refusées", () => {
    expect(parseDoualaDateTime("2026-10-24T08:00").toISOString()).toBe("2026-10-24T07:00:00.000Z");
    expect(() => parseDoualaDateTime("2026-02-31T08:00")).toThrow();
    expect(() => parseDoualaDateTime("demain 8h")).toThrow();
  });

  it("validation : futur obligatoire, bornes de consigne, répétition ≥ 1 h", () => {
    const ok = { title: "Résumé", instruction: "Résume les commandes", firstRunAt: "2026-10-24T08:00" };
    expect(validateTaskInput(ok, NOW).kind).toBe("once");
    expect(validateTaskInput({ ...ok, repeatEveryHours: 24 }, NOW)).toMatchObject({ kind: "interval", intervalSeconds: 86400 });
    expect(() => validateTaskInput({ ...ok, firstRunAt: "2026-10-23T08:30" }, NOW)).toThrow(/futur/);
    expect(() => validateTaskInput({ ...ok, firstRunAt: "2028-01-01T08:00" }, NOW)).toThrow(/un an/);
    expect(() => validateTaskInput({ ...ok, repeatEveryHours: 0 }, NOW)).toThrow();
    expect(() => validateTaskInput({ ...ok, instruction: "ok" }, NOW)).toThrow();
    expect(() => validateTaskInput({ ...ok, instruction: "x".repeat(1001) }, NOW)).toThrow();
  });

  it("limite de tâches actives, et la création enregistre le créateur", async () => {
    const { r, rows } = repo(Array.from({ length: MAX_ACTIVE_TASKS }, (_, i) => rec({ id: `a${i}` })));
    const svc = createTaskService({ repo: r, now: () => NOW });
    await expect(svc.create({ tenantId: "t", userId: "u" }, { title: "x", instruction: "Fais ceci", firstRunAt: "2026-10-24T08:00" })).rejects.toThrow(/Limite/);
    rows.pop();
    const created = await svc.create({ tenantId: "t", userId: "u9" }, { title: "x", instruction: "Fais ceci", firstRunAt: "2026-10-24T08:00" });
    expect(rows.find((x) => x.id === created.id)!.createdBy).toBe("u9");
  });

  it("reprise sans rattrapage : une échéance passée repart d'après l'intervalle", async () => {
    const { r, rows } = repo([rec({ id: "p", enabled: false, nextRunAt: "2026-10-01T00:00:00Z", intervalSeconds: 86400 })]);
    await createTaskService({ repo: r, now: () => NOW }).resume("t", "p");
    expect(rows[0]!.enabled).toBe(true);
    expect(new Date(rows[0]!.nextRunAt).getTime()).toBe(NOW.getTime() + 86400_000);
  });

  it("pause / suppression d'une tâche inconnue : erreur claire", async () => {
    const svc = createTaskService({ repo: repo().r, now: () => NOW });
    await expect(svc.pause("t", "nope")).rejects.toThrow(/introuvable/);
    await expect(svc.remove("t", "nope")).rejects.toThrow(/introuvable/);
  });

  it("libellés de fréquence", () => {
    expect(describeSchedule({ kind: "interval", intervalSeconds: 86400 })).toBe("tous les jours");
    expect(describeSchedule({ kind: "interval", intervalSeconds: 3 * 3600 })).toBe("toutes les 3 heures");
    expect(describeSchedule({ kind: "once", intervalSeconds: null })).toBe("une seule fois");
  });
});
