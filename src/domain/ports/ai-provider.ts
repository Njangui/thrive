/**
 * AIProvider — port métier (section 8).
 *
 * AIService (application layer) appelle uniquement cette interface.
 * Jamais d'appel direct à un SDK Mistral/Anthropic/OpenAI en dehors de
 * src/infrastructure/providers/ai/*.
 */

export interface AITextRequest {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AITextResponse {
  text: string;
  provider: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface AIStructuredRequest<_TSchema = unknown> extends AITextRequest {
  /** Description JSON-schema-like de la sortie attendue */
  outputSchemaDescription: string;
}

export interface AIClassifyRequest {
  text: string;
  labels: string[];
}

export interface AIClassifyResponse {
  label: string;
  confidence: number;
}

/**
 * Conversation à outils (noyau agentique, C1/P2). Les noms d'outils sont
 * transmis tels quels : l'appelant garantit `^[a-zA-Z0-9_-]{1,64}$`.
 */
export interface AIToolSpec {
  name: string;
  description: string;
  /** JSON Schema (objet) des paramètres. */
  parameters: Record<string, unknown>;
}

export interface AIToolCall {
  id: string;
  name: string;
  /** Arguments déjà analysés ; `undefined` si `argumentsError` est renseigné. */
  arguments?: unknown;
  /** JSON illisible renvoyé par le modèle : l'appelant le lui signale. */
  argumentsError?: string;
}

export type AIChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: AIToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface AIChatRequest {
  systemPrompt: string;
  messages: AIChatMessage[];
  tools?: AIToolSpec[];
  maxTokens?: number;
  temperature?: number;
}

export interface AIChatResponse {
  text: string;
  toolCalls: AIToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "other";
  provider: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface AIProvider {
  readonly providerName: string;

  /**
   * Optionnel (rétro-compatible) : implémenté par les trois adapters
   * (Mistral, OpenAI, Claude). Requis par le runtime d'agents.
   */
  chat?(request: AIChatRequest): Promise<AIChatResponse>;

  generateText(request: AITextRequest): Promise<AITextResponse>;

  generateStructuredOutput<T = unknown>(
    request: AIStructuredRequest,
  ): Promise<{ data: T; raw: AITextResponse }>;

  classify(request: AIClassifyRequest): Promise<AIClassifyResponse>;
}
