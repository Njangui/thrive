/**
 * Réglages d'agents par tenant (table `agent_settings`, migrations 0100 + 0195).
 *
 * Le propriétaire choisit, outil par outil, ce qui s'exécute SEUL, ce qui demande sa validation
 * et ce qui est INTERDIT — avec des seuils de montant et trois profils prêts à l'emploi.
 * Les garde-fous fixes (voir `rule-engine.ts`) ne dépendent JAMAIS de ces réglages.
 */
import type { ToolDef } from "./contracts";

/** auto = exécuté seul (journalisé) ; confirm = carte d'approbation ; deny = outil indisponible. */
export type ToolMode = "auto" | "confirm" | "deny";

export interface ToolPolicy {
  mode: ToolMode;
  /** Pour mode `auto` : au-dessus de ce montant (devise de l'entreprise), validation exigée. */
  autoMaxAmount?: number;
}

export type AgentProfile = "prudent" | "balanced" | "autonomous" | "custom";
export const AGENT_PROFILES: readonly AgentProfile[] = ["prudent", "balanced", "autonomous", "custom"] as const;

export interface AgentSettings {
  tenantId: string;
  /** null = tous les outils disponibles (la validation reste le défaut) ; liste = seuls ces outils. */
  enabledTools: string[] | null;
  /** Conservé pour compatibilité (0100). Le profil le remplace quand il est défini. */
  autonomy: { write_reversible: "allow" | "confirm" };
  budget: { maxUnitsPerAction?: number };
  profile: AgentProfile;
  /** Exceptions par outil (`domaine.action` -> politique). Prioritaires sur le profil. */
  toolPolicies: Record<string, ToolPolicy>;
}

export interface AgentSettingsRepository {
  get(tenantId: string): Promise<AgentSettings | null>;
  upsert(settings: AgentSettings, updatedBy: string): Promise<void>;
}

/**
 * Plafond par défaut (audit A1) : une action dont le coût estimé dépasse ce nombre d'unités exige
 * une confirmation même en mode auto. Le plafond quotidien/mensuel est porté par le solde de crédits
 * IA du forfait (réservation atomique, voir 0189) ; cette valeur borne chaque action.
 */
export const DEFAULT_MAX_UNITS_PER_ACTION = 10;

/** Profils : mode par défaut des écritures réversibles et seuil de montant en mode auto. */
export const PROFILE_DEFAULTS: Record<Exclude<AgentProfile, "custom">, { writeMode: ToolMode; autoMaxAmount?: number }> = {
  prudent: { writeMode: "confirm" },
  balanced: { writeMode: "auto", autoMaxAmount: 50_000 },
  autonomous: { writeMode: "auto", autoMaxAmount: 500_000 },
};

export function defaultAgentSettings(tenantId: string): AgentSettings {
  return { tenantId, enabledTools: null, autonomy: { write_reversible: "confirm" }, budget: {}, profile: "prudent", toolPolicies: {} };
}

/** Un outil est disponible s'il n'est ni exclu par la liste, ni interdit par sa politique. */
export function isToolEnabled(settings: AgentSettings, tool: Pick<ToolDef<unknown, unknown>, "name">): boolean {
  if (settings.toolPolicies[tool.name]?.mode === "deny") return false;
  return settings.enabledTools === null || settings.enabledTools.includes(tool.name);
}

/** Politique effective d'une écriture réversible : exception de l'outil, sinon profil, sinon compatibilité 0100. */
export function effectiveWritePolicy(settings: AgentSettings, toolName: string): ToolPolicy {
  const own = settings.toolPolicies[toolName];
  if (own) return own;
  if (settings.profile !== "custom") {
    const p = PROFILE_DEFAULTS[settings.profile];
    return { mode: p.writeMode, autoMaxAmount: p.autoMaxAmount };
  }
  return { mode: settings.autonomy.write_reversible === "allow" ? "auto" : "confirm" };
}
