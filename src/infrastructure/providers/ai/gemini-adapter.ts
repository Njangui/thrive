import type {
  AIChatRequest,
  AIChatResponse,
  AIClassifyRequest,
  AIClassifyResponse,
  AIProvider,
  AIStructuredRequest,
  AITextRequest,
  AITextResponse,
} from "@/domain/ports/ai-provider";
import { openAICompatibleChat } from "./openai-compatible-chat";

/**
 * Adapter Gemini via l'endpoint de compatibilité OpenAI de Google
 * (https://ai.google.dev/gemini-api/docs/openai) :
 * base `https://generativelanguage.googleapis.com/v1beta/openai`, en-tête
 * `Authorization: Bearer <clé>`, chemin `/chat/completions`, appels d'outils pris en charge.
 * Le modèle vient de la configuration (GEMINI_MODEL, défaut `gemini-2.5-flash`).
 */
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

/** Gemini entoure souvent le JSON de ```json … ``` : on retire la clôture avant l'analyse. */
export function stripJsonFence(text: string): string {
  const m = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (m?.[1] ?? text).trim();
}

export class GeminiAdapter implements AIProvider {
  readonly providerName = "gemini";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = GEMINI_BASE_URL,
  ) {}

  chat(request: AIChatRequest): Promise<AIChatResponse> {
    return openAICompatibleChat({ label: "Gemini", baseUrl: this.baseUrl, apiKey: this.apiKey, model: this.model, request });
  }

  async generateText(request: AITextRequest): Promise<AITextResponse> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userMessage },
        ],
        // Gemini 2.5 « réfléchit » avant de répondre : ces tokens comptent dans la limite de sortie.
        max_tokens: request.maxTokens ?? 1024,
        temperature: request.temperature ?? 0.4,
      }),
    });
    if (!res.ok) throw new Error(`Gemini generateText failed (${res.status}): ${await res.text()}`);

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    return {
      text,
      provider: this.providerName,
      model: this.model,
      usage: data.usage ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens } : undefined,
    };
  }

  async generateStructuredOutput<T = unknown>(request: AIStructuredRequest): Promise<{ data: T; raw: AITextResponse }> {
    const raw = await this.generateText({
      ...request,
      systemPrompt: `${request.systemPrompt}\n\nRéponds UNIQUEMENT en JSON valide respectant ce format : ${request.outputSchemaDescription}. Aucun texte hors du JSON.`,
    });
    try {
      return { data: JSON.parse(stripJsonFence(raw.text)) as T, raw };
    } catch {
      throw new Error("GeminiAdapter: sortie non-JSON reçue pour une requête structurée");
    }
  }

  async classify(request: AIClassifyRequest): Promise<AIClassifyResponse> {
    const out = await this.generateStructuredOutput<{ label: string; confidence: number }>({
      systemPrompt: "Tu classes un texte parmi une liste de labels fournie. Choisis le label le plus pertinent.",
      userMessage: `Texte: "${request.text}"\nLabels possibles: ${request.labels.join(", ")}`,
      outputSchemaDescription: '{ "label": string, "confidence": number entre 0 et 1 }',
    });
    return out.data;
  }
}
