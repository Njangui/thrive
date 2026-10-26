/**
 * Routage des tâches IA et barème de crédits — logique pure (aucun accès réseau/base).
 *
 *  - niveau `simple`  → Mistral Small (rapide, peu coûteux)
 *  - niveau `complex` → Gemini 2.5 Flash (réponses longues, analyses lourdes)
 *
 * Le crédit consommé dépend de la TÂCHE (barème ci-dessous), puis d'un
 * supplément proportionnel aux tokens réellement utilisés quand la tâche
 * dépasse le forfait de tokens inclus (voir `tokenSurchargeCredits`).
 */
export type AITaskKind =
  | "customer_reply" // réponse à un client (WhatsApp, site…)
  | "comment_draft" // brouillon de réponse à un commentaire
  | "classification" // classement / extraction courte
  | "follow_up" // relance client
  | "long_form" // texte long (fiche produit détaillée, newsletter)
  | "analysis" // analyse de données (ventes, clients, stock)
  | "report" // rapport / synthèse multi-sources
  | "agent_chat"; // assistant de pilotage (outils, raisonnement)

export type AITier = "simple" | "complex";

export interface TaskPolicy {
  tier: AITier;
  /** Crédits de base débités AVANT l'appel (réservation atomique). */
  credits: number;
}

/** Barème par tâche. Modifier ici — source unique. */
export const TASK_POLICY: Record<AITaskKind, TaskPolicy> = {
  customer_reply: { tier: "simple", credits: 1 },
  comment_draft: { tier: "simple", credits: 1 },
  classification: { tier: "simple", credits: 1 },
  follow_up: { tier: "simple", credits: 1 },
  long_form: { tier: "complex", credits: 2 },
  analysis: { tier: "complex", credits: 3 },
  agent_chat: { tier: "complex", credits: 3 },
  report: { tier: "complex", credits: 5 },
};

/** Au-delà de ce volume d'entrée (caractères), une tâche « simple » passe au niveau complexe. */
export const COMPLEX_INPUT_CHARS = 8_000;
/** Tokens inclus dans le crédit de base ; chaque tranche supplémentaire coûte 1 crédit. */
export const INCLUDED_TOKENS = 4_000;
export const TOKENS_PER_EXTRA_CREDIT = 4_000;
export const MAX_EXTRA_CREDITS = 5;

export function routeTask(task: AITaskKind, opts: { inputChars?: number } = {}): TaskPolicy {
  const base = TASK_POLICY[task];
  if (base.tier === "simple" && (opts.inputChars ?? 0) > COMPLEX_INPUT_CHARS) {
    return { tier: "complex", credits: Math.max(base.credits, TASK_POLICY.long_form.credits) };
  }
  return base;
}

/** Crédits supplémentaires dus pour une consommation réelle de `totalTokens` (0 si dans le forfait). */
export function tokenSurchargeCredits(totalTokens: number): number {
  if (!Number.isFinite(totalTokens) || totalTokens <= INCLUDED_TOKENS) return 0;
  return Math.min(MAX_EXTRA_CREDITS, Math.ceil((totalTokens - INCLUDED_TOKENS) / TOKENS_PER_EXTRA_CREDIT));
}
