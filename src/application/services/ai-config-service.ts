import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { AI_PROVIDER_NAMES, DEFAULT_MODEL_BY_PROVIDER, type AIProviderName } from "@/infrastructure/providers/registry";
import { NotFoundError, ValidationError } from "@/lib/errors";

/**
 * Lot L, Partie 2 — Configuration IA depuis le dashboard. `model` n'est
 * délibérément PAS un champ éditable ici (cahier : vocabulaire non
 * technique, ne pas afficher "model" brut) — il est dérivé
 * automatiquement de `provider` via `DEFAULT_MODEL_BY_PROVIDER`
 * (registry.ts, seule source de vérité, jamais dupliquée ici).
 */

const MIN_MAX_TOKENS = 128;
const MAX_MAX_TOKENS = 2048;
const MAX_OBJECTIVES = 10;
const MAX_OBJECTIVE_LENGTH = 200;

export interface AiConfig {
  organizationId: string;
  enabled: boolean;
  provider: AIProviderName;
  fallbackProvider: AIProviderName | null;
  model: string;
  tone: string | null;
  language: string;
  objectives: string[];
  maxTokens: number;
  temperature: number;
  updatedAt: string;
}

export interface UpdateAiConfigInput {
  enabled: boolean;
  provider: string;
  fallbackProvider: string | null;
  tone: string;
  language: string;
  objectives: string[];
  maxTokens: number;
  temperature: number;
}

interface AiConfigRow {
  organization_id: string;
  enabled: boolean;
  provider: string;
  fallback_provider: string | null;
  model: string;
  tone: string | null;
  language: string;
  objectives: unknown;
  max_tokens: number;
  temperature: number | string;
  updated_at: string;
}

const AI_CONFIG_SELECT =
  "organization_id, enabled, provider, fallback_provider, model, tone, language, objectives, max_tokens, temperature, updated_at";

function mapRow(row: AiConfigRow): AiConfig {
  return {
    organizationId: row.organization_id,
    enabled: row.enabled,
    provider: row.provider as AIProviderName,
    fallbackProvider: (row.fallback_provider as AIProviderName | null) ?? null,
    model: row.model,
    tone: row.tone,
    language: row.language,
    objectives: Array.isArray(row.objectives) ? (row.objectives as string[]) : [],
    maxTokens: row.max_tokens,
    temperature: Number(row.temperature),
    updatedAt: row.updated_at,
  };
}

export async function getAiConfig(organizationId: string): Promise<AiConfig> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("ai_config")
    .select(AI_CONFIG_SELECT)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw new Error(`Erreur lecture configuration IA: ${error.message}`);
  if (!data) throw new NotFoundError("Configuration IA introuvable pour cette organisation.");

  return mapRow(data as AiConfigRow);
}

/**
 * Valide `provider`/`fallback_provider` contre `AI_PROVIDER_NAMES`
 * (registry.ts) — jamais une valeur arbitraire qui ferait planter
 * `getAIProvider()` au premier message entrant après cette mise à jour.
 */
export async function updateAiConfig(
  organizationId: string,
  input: UpdateAiConfigInput,
  _actorUserId: string,
): Promise<AiConfig> {
  if (!isKnownProvider(input.provider)) {
    throw new ValidationError(`Assistant "${input.provider}" inconnu.`);
  }
  const fallbackProvider = input.fallbackProvider?.trim() || null;
  if (fallbackProvider && !isKnownProvider(fallbackProvider)) {
    throw new ValidationError(`Assistant de secours "${fallbackProvider}" inconnu.`);
  }
  if (fallbackProvider && fallbackProvider === input.provider) {
    throw new ValidationError("L'assistant principal et l'assistant de secours doivent être différents.");
  }
  if (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 1) {
    throw new ValidationError("La créativité doit être un nombre entre 0 et 1.");
  }
  if (!Number.isInteger(input.maxTokens) || input.maxTokens < MIN_MAX_TOKENS || input.maxTokens > MAX_MAX_TOKENS) {
    throw new ValidationError(
      `La longueur maximale des réponses doit être un nombre entier entre ${MIN_MAX_TOKENS} et ${MAX_MAX_TOKENS}.`,
    );
  }
  const objectives = input.objectives
    .map((o) => o.trim())
    .filter(Boolean)
    .slice(0, MAX_OBJECTIVES)
    .map((o) => o.slice(0, MAX_OBJECTIVE_LENGTH));

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("ai_config")
    .update({
      enabled: input.enabled,
      provider: input.provider,
      fallback_provider: fallbackProvider,
      // Dérivé du provider, jamais un champ libre — voir en-tête du fichier.
      model: DEFAULT_MODEL_BY_PROVIDER[input.provider as AIProviderName],
      tone: input.tone.trim() || null,
      language: input.language.trim() || "fr",
      objectives,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
    })
    .eq("organization_id", organizationId)
    .select(AI_CONFIG_SELECT)
    .maybeSingle();

  if (error) throw new Error(`Impossible de mettre à jour la configuration IA: ${error.message}`);
  if (!data) throw new NotFoundError("Configuration IA introuvable pour cette organisation.");

  return mapRow(data as AiConfigRow);
}

function isKnownProvider(value: string): value is AIProviderName {
  return (AI_PROVIDER_NAMES as readonly string[]).includes(value);
}
