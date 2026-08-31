import type {
  AIClassifyRequest,
  AIClassifyResponse,
  AIProvider,
  AIStructuredRequest,
  AITextRequest,
  AITextResponse,
} from "@/domain/ports/ai-provider";

/**
 * Adapter Mistral — provider AI par défaut du MVP (le moins cher / le plus
 * pertinent pour un premier déploiement, à valider selon les coûts réels).
 * Le modèle exact utilisé vient de `ai_config.model` (par tenant), jamais
 * hardcodé ici — voir section 9.
 */
export class MistralAdapter implements AIProvider {
  readonly providerName = "mistral";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = "https://api.mistral.ai/v1",
  ) {}

  async generateText(request: AITextRequest): Promise<AITextResponse> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userMessage },
        ],
        max_tokens: request.maxTokens ?? 512,
        temperature: request.temperature ?? 0.4,
      }),
    });

    if (!res.ok) {
      throw new Error(`Mistral generateText failed (${res.status}): ${await res.text()}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";

    return {
      text,
      provider: this.providerName,
      model: this.model,
      usage: data.usage
        ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
        : undefined,
    };
  }

  async generateStructuredOutput<T = unknown>(
    request: AIStructuredRequest,
  ): Promise<{ data: T; raw: AITextResponse }> {
    const raw = await this.generateText({
      ...request,
      systemPrompt: `${request.systemPrompt}\n\nRéponds UNIQUEMENT en JSON valide respectant ce format : ${request.outputSchemaDescription}. Aucun texte hors du JSON.`,
    });

    try {
      return { data: JSON.parse(raw.text) as T, raw };
    } catch {
      throw new Error("MistralAdapter: sortie non-JSON reçue pour une requête structurée");
    }
  }

  async classify(request: AIClassifyRequest): Promise<AIClassifyResponse> {
    const raw = await this.generateStructuredOutput<{ label: string; confidence: number }>({
      systemPrompt:
        "Tu classes un texte parmi une liste de labels fournie. Choisis le label le plus pertinent.",
      userMessage: `Texte: "${request.text}"\nLabels possibles: ${request.labels.join(", ")}`,
      outputSchemaDescription: '{ "label": string, "confidence": number entre 0 et 1 }',
    });
    return raw.data;
  }
}
