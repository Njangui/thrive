/**
 * Réglages de l'assistant : lecture pour l'écran et enregistrement validé.
 * Seuls le propriétaire et les administrateurs modifient ; les outils « sensibles » ne peuvent jamais passer en automatique
 * (garde-fou fixe) : l'écran ne le propose pas et l'enregistrement le refuse de toute façon.
 */
import type { Role, ToolDef } from "./contracts";
import { AppError } from "@/lib/errors";
import {
  AGENT_PROFILES, defaultAgentSettings, PROFILE_DEFAULTS,
  type AgentProfile, type AgentSettings, type AgentSettingsRepository, type ToolMode, type ToolPolicy,
} from "./settings";

export type ToolInfo = Pick<ToolDef<unknown, unknown>, "name" | "domain" | "description" | "risk" | "confirmAlways">;

export const PROFILE_LABELS: Record<Exclude<AgentProfile, "custom">, { label: string; help: string }> = {
  prudent: { label: "Prudent", help: "L'assistant demande votre validation avant chaque modification. Les consultations sont libres." },
  balanced: { label: "Équilibré", help: "Les petites modifications courantes s'exécutent seules (jusqu'à 50 000 par action) ; au-dessus, il demande." },
  autonomous: { label: "Autonome", help: "Les modifications courantes s'exécutent seules jusqu'à 500 000 par action. Les actions sensibles restent à valider." },
};

/** Garde-fous fixes affichés tels quels : indépendants de tout réglage. */
export const FIXED_GUARDRAILS: string[] = [
  "Remboursements, annulations de commande et changements de prix : toujours validés par vous, avec votre PIN.",
  "Suppression de données, changement de rôles et de droits : toujours validés.",
  "Message écrit à un client au nom de l'entreprise : toujours validé, texte montré avant l'envoi.",
  "Envoi à plus de 20 destinataires d'un coup : toujours validé.",
  "Abonnement, domaine et paiements : jamais modifiés sans validation renforcée.",
  "Une action dont le coût en crédits IA dépasse le plafond par action demande votre accord.",
];

export function canEditAssistantSettings(role: Role): boolean {
  return role === "owner" || role === "admin";
}

export interface ToolPolicyRow {
  tool: string;
  domain: string;
  label: string;
  risk: "write_reversible" | "sensitive";
  /** Jamais automatique (action sensible ou message client). */
  alwaysAsk: boolean;
  /** "" = suit le profil. */
  mode: ToolMode | "";
  autoMaxAmount?: number;
}

export interface AssistantSettingsView {
  profile: AgentProfile;
  rows: ToolPolicyRow[];
}

const firstSentence = (text: string) => (text.split(/(?<=\.)\s/)[0] ?? text).replace(/\.$/, "");

export function buildSettingsView(settings: AgentSettings, tools: ToolInfo[]): AssistantSettingsView {
  const rows: ToolPolicyRow[] = tools
    .filter((t): t is ToolInfo & { risk: "write_reversible" | "sensitive" } => t.risk !== "read")
    .map((t) => {
      const own = settings.toolPolicies[t.name];
      return { tool: t.name, domain: t.domain, label: firstSentence(t.description), risk: t.risk, alwaysAsk: t.risk === "sensitive" || t.confirmAlways === true, mode: (own?.mode ?? "") as ToolMode | "", autoMaxAmount: own?.autoMaxAmount };
    })
    .sort((a, b) => a.domain.localeCompare(b.domain) || a.tool.localeCompare(b.tool));
  return { profile: settings.profile, rows };
}

export interface SettingsFormInput {
  profile: string;
  /** Par outil : mode ("" = profil) et seuil optionnel (texte saisi). */
  tools: Record<string, { mode: string; max?: string }>;
}

/** Valide le formulaire. Toute valeur inconnue est refusée (jamais ignorée en silence vers « plus permissif »). */
export function parseSettingsForm(input: SettingsFormInput, tools: ToolInfo[]): { profile: AgentProfile; toolPolicies: Record<string, ToolPolicy> } {
  if (!AGENT_PROFILES.includes(input.profile as AgentProfile) || input.profile === "custom") throw new AppError("Profil inconnu.", 400, "validation");
  const byName = new Map(tools.map((t) => [t.name, t]));
  const toolPolicies: Record<string, ToolPolicy> = {};
  for (const [name, value] of Object.entries(input.tools)) {
    const tool = byName.get(name);
    if (!tool || tool.risk === "read") throw new AppError("Outil inconnu.", 400, "validation");
    if (value.mode === "") continue;
    if (value.mode !== "auto" && value.mode !== "confirm" && value.mode !== "deny") throw new AppError("Mode inconnu.", 400, "validation");
    if (value.mode === "auto" && (tool.risk === "sensitive" || tool.confirmAlways)) throw new AppError("Une action sensible ou un message client ne peut pas s'exécuter automatiquement.", 400, "validation");
    const policy: ToolPolicy = { mode: value.mode };
    const raw = (value.max ?? "").trim();
    if (value.mode === "auto" && raw !== "") {
      const amount = Number(raw.replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(amount) || amount < 0) throw new AppError("Le seuil doit être un nombre positif.", 400, "validation");
      policy.autoMaxAmount = amount;
    }
    toolPolicies[name] = policy;
  }
  return { profile: input.profile as Exclude<AgentProfile, "custom">, toolPolicies };
}

export async function loadAssistantSettings(repo: AgentSettingsRepository, tenantId: string): Promise<AgentSettings> {
  return (await repo.get(tenantId)) ?? defaultAgentSettings(tenantId);
}

export async function saveAssistantSettings(deps: { repo: AgentSettingsRepository; tools: ToolInfo[] }, actor: { tenantId: string; userId: string; role: Role }, input: SettingsFormInput): Promise<AgentSettings> {
  if (!canEditAssistantSettings(actor.role)) throw new AppError("Réservé au propriétaire et aux administrateurs.", 403, "authorization");
  const parsed = parseSettingsForm(input, deps.tools);
  const current = await loadAssistantSettings(deps.repo, actor.tenantId);
  const next: AgentSettings = { ...current, profile: parsed.profile, toolPolicies: parsed.toolPolicies, autonomy: { write_reversible: PROFILE_DEFAULTS[parsed.profile as Exclude<AgentProfile, "custom">].writeMode === "auto" ? "allow" : "confirm" } };
  await deps.repo.upsert(next, actor.userId);
  return next;
}

/* ------------------------------ Journal ------------------------------ */

export interface JournalRow { id: string; createdAt: string; tool: string; event: string; decision: string | null; reason: string | null; channel: string; risk: string }
export interface JournalEntry { id: string; createdAt: string; label: string; tone: "ok" | "wait" | "stop"; channel: string; sensitive: boolean }

const CHANNELS: Record<string, string> = { dashboard: "tableau de bord", telegram: "Telegram", whatsapp: "WhatsApp", scheduler: "tâche planifiée", customer: "vitrine" };

/** Traduit une ligne d'audit en phrase lisible. Les lectures et décisions internes « allow » ne sont pas montrées. */
export function toJournalEntry(row: JournalRow, labelOf: (tool: string) => string): JournalEntry | null {
  const what = labelOf(row.tool);
  const base = { id: row.id, createdAt: row.createdAt, channel: CHANNELS[row.channel] ?? row.channel, sensitive: row.risk === "sensitive" };
  switch (row.event) {
    case "executed": return row.risk === "read" ? null : { ...base, label: `Fait : ${what}`, tone: "ok" };
    case "approval_requested": return { ...base, label: `En attente de votre validation : ${what}`, tone: "wait" };
    case "approved": return { ...base, label: `Validé : ${what}`, tone: "ok" };
    case "rejected": return { ...base, label: `Refusé : ${what}`, tone: "stop" };
    case "expired": return { ...base, label: `Expiré sans réponse : ${what}`, tone: "stop" };
    case "failed": return { ...base, label: `Échec : ${what}`, tone: "stop" };
    case "decision": return row.decision === "deny" ? { ...base, label: `Bloqué : ${what}`, tone: "stop" } : null;
    default: return null;
  }
}
