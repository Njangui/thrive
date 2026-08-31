import type {
  AIClassifyRequest,
  AIClassifyResponse,
  AIProvider,
  AIStructuredRequest,
  AITextRequest,
  AITextResponse,
} from "@/domain/ports/ai-provider";

/**
 * Adapter OpenAI — non activé par défaut dans le MVP (section 8 : présent
 * pour prouver que l'architecture permet d'ajouter un provider sans
 * toucher au domaine, pas parce qu'il est utilisé en V1).
 */
export class OpenAIAdapter implements AIProvider {
  readonly providerName = "openai";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = "https://api.openai.com/v1",
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
      throw new Error(`OpenAI generateText failed (${res.status}): ${await res.text()}`);
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
      throw new Error("OpenAIAdapter: sortie non-JSON reçue pour une requête structurée");
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
