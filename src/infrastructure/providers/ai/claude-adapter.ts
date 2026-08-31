import type {
  AIClassifyRequest,
  AIClassifyResponse,
  AIProvider,
  AIStructuredRequest,
  AITextRequest,
  AITextResponse,
} from "@/domain/ports/ai-provider";

/**
 * Adapter Claude (Anthropic Messages API) — utilisé en fallback ou pour les
 * tenants qui le préfèrent (section 59 : fallback contrôlé et loggé).
 * Le modèle vient de `ai_config.model`/`ai_config.fallback_provider` —
 * ne pas figer un nom de modèle en dur ici, les noms de modèles évoluent.
 */
export class ClaudeAdapter implements AIProvider {
  readonly providerName = "claude";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = "https://api.anthropic.com/v1",
  ) {}

  async generateText(request: AITextRequest): Promise<AITextResponse> {
    const res = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxTokens ?? 512,
        temperature: request.temperature ?? 0.4,
        system: request.systemPrompt,
        messages: [{ role: "user", content: request.userMessage }],
      }),
    });

    if (!res.ok) {
      throw new Error(`Claude generateText failed (${res.status}): ${await res.text()}`);
    }

    const data = await res.json();
    const text = (data.content ?? [])
      .filter((block: { type: string }) => block.type === "text")
      .map((block: { text: string }) => block.text)
      .join("\n");

    return {
      text,
      provider: this.providerName,
      model: this.model,
      usage: data.usage
        ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
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
      throw new Error("ClaudeAdapter: sortie non-JSON reçue pour une requête structurée");
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
