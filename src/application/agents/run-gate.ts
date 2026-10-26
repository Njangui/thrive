/**
 * Coupe-circuit (par tenant ou par agent) et limites de débit, évalués AVANT
 * tout appel LLM. Le coupe-circuit échoue FERMÉ (erreur base => refus) ;
 * le limiteur de débit échoue OUVERT s'il est indisponible (même posture que
 * `src/lib/rate-limit.ts` : défense en profondeur, jamais un point de panne).
 */
export type GateResult = { ok: true } | { ok: false; reason: "circuit_open" | "rate_limited" | "gate_unavailable" };

export interface RunGate {
  check(args: { tenantId: string; agentName: string; userId: string }): Promise<GateResult>;
}

export interface CircuitBreakerRepository {
  /** Vrai si un coupe-circuit actif vise le tenant entier ou cet agent. */
  isOpen(tenantId: string, agentName: string): Promise<boolean>;
  /** `agentName` null = tous les agents du tenant. */
  trip(args: { tenantId: string; agentName: string | null; trippedBy: string | null; reason: string }): Promise<void>;
  release(args: { tenantId: string; agentName: string | null; releasedBy: string }): Promise<void>;
}

export function createCircuitBreakerGate(repo: Pick<CircuitBreakerRepository, "isOpen">): RunGate {
  return {
    async check({ tenantId, agentName }) {
      try {
        return (await repo.isOpen(tenantId, agentName)) ? { ok: false, reason: "circuit_open" } : { ok: true };
      } catch (error) {
        console.error("[agents] coupe-circuit illisible, exécution refusée:", error instanceof Error ? error.message : error);
        return { ok: false, reason: "gate_unavailable" };
      }
    },
  };
}

export interface RunRateLimiter {
  /** Compte une exécution pour cette clé ; faux si la limite est dépassée. */
  hit(key: string): Promise<boolean>;
}

export function createRateLimitGate(limits: { perUser: RunRateLimiter; perTenant: RunRateLimiter }): RunGate {
  return {
    async check({ tenantId, userId }) {
      try {
        const tenantOk = await limits.perTenant.hit(`tenant:${tenantId}`);
        if (!tenantOk) return { ok: false, reason: "rate_limited" };
        const userOk = await limits.perUser.hit(`user:${tenantId}:${userId}`);
        return userOk ? { ok: true } : { ok: false, reason: "rate_limited" };
      } catch (error) {
        console.warn("[agents] limiteur de débit indisponible (ouvert):", error instanceof Error ? error.message : error);
        return { ok: true };
      }
    },
  };
}

/** Le premier refus l'emporte ; l'ordre compte (coupe-circuit avant limiteur). */
export function composeGates(...gates: RunGate[]): RunGate {
  return {
    async check(args) {
      for (const gate of gates) {
        const result = await gate.check(args);
        if (!result.ok) return result;
      }
      return { ok: true };
    },
  };
}
