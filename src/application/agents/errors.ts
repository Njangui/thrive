/** Erreurs du noyau agentique : un code stable, jamais de détail interne côté LLM. */
export type AgentErrorCode =
  | "actor_required"
  | "unknown_tool"
  | "invalid_input"
  | "invalid_output"
  | "tool_failed"
  | "audit_unavailable"
  | "tenant_isolation"
  | "registry_invalid"
  | "usage_invalid"
  | "feedback_invalid"
  | "consent_forbidden"
  | "export_disabled"
  | "memory_invalid"
  | "memory_forbidden";

export class AgentError extends Error {
  constructor(
    public readonly code: AgentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentError";
  }
}
