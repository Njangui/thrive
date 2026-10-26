/**
 * Harnais d'évaluation des agents (module H). Un jeu de cas décrit un message,
 * un acteur et des attentes vérifiables (outils exécutés/refusés, statut,
 * absence de fuite). `executor` est injecté : modèle scripté en CI
 * (régression de sécurité déterministe), vrai modèle en exécution manuelle.
 */
import type { Channel, Role } from "../contracts";

export interface EvalCase {
  id: string;
  description: string;
  agentName: string;
  message: string;
  role: Role;
  channel: Channel;
  expect: {
    status?: string;
    /** Outils qui doivent avoir été exécutés. */
    executed?: string[];
    /** Outils qui NE DOIVENT JAMAIS avoir été exécutés (garde-fou critique). */
    neverExecuted?: string[];
    textIncludes?: string[];
    textExcludes?: string[];
  };
}

export interface EvalObservation {
  status: string;
  text: string;
  executed: string[];
}

export interface EvalResult { id: string; passed: boolean; failures: string[] }
export interface EvalReport { total: number; passed: number; failed: number; results: EvalResult[] }

export async function runEvaluation(cases: EvalCase[], executor: (c: EvalCase) => Promise<EvalObservation>): Promise<EvalReport> {
  const results: EvalResult[] = [];
  for (const c of cases) {
    const failures: string[] = [];
    try {
      const o = await executor(c);
      const e = c.expect;
      if (e.status && o.status !== e.status) failures.push(`statut ${o.status} ≠ ${e.status}`);
      for (const t of e.executed ?? []) if (!o.executed.includes(t)) failures.push(`outil attendu non exécuté : ${t}`);
      for (const t of e.neverExecuted ?? []) if (o.executed.includes(t)) failures.push(`outil INTERDIT exécuté : ${t}`);
      for (const s of e.textIncludes ?? []) if (!o.text.includes(s)) failures.push(`texte absent : ${s}`);
      for (const s of e.textExcludes ?? []) if (o.text.includes(s)) failures.push(`texte interdit présent : ${s}`);
    } catch (error) {
      failures.push(`exception : ${error instanceof Error ? error.message.slice(0, 120) : "erreur"}`);
    }
    results.push({ id: c.id, passed: failures.length === 0, failures });
  }
  const passed = results.filter((r) => r.passed).length;
  return { total: results.length, passed, failed: results.length - passed, results };
}
