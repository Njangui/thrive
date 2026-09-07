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

export interface AIStructuredRequest<TSchema = unknown> extends AITextRequest {
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

export interface AIProvider {
  readonly providerName: string;

  generateText(request: AITextRequest): Promise<AITextResponse>;

  generateStructuredOutput<T = unknown>(
    request: AIStructuredRequest,
  ): Promise<{ data: T; raw: AITextResponse }>;

  classify(request: AIClassifyRequest): Promise<AIClassifyResponse>;
}
