import type { EmbeddingPort } from "@/domain/ports/embedding";

const MAX_TEXTS = 16;
const MAX_CHARS = 8000;
const TIMEOUT_MS = 15_000;

/**
 * Embeddings Mistral. `mistral-embed` produit des vecteurs de 1024 dimensions
 * (À VÉRIFIER dans la documentation Mistral avant déploiement) ; la dimension
 * est validée à chaque réponse. Aucun texte n'est jamais inclus dans un message
 * d'erreur ni journalisé. Les textes quittent notre infrastructure : transfert
 * de données à un tiers (point juridique, voir docs/agents/c1-architecture.md).
 */
export class MistralEmbeddingAdapter implements EmbeddingPort {
  readonly providerName = "mistral";

  constructor(
    private readonly apiKey: string,
    readonly model = "mistral-embed",
    readonly dimensions = 1024,
    private readonly baseUrl = "https://api.mistral.ai/v1",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async embed(texts: string[], options: { signal?: AbortSignal } = {}): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (texts.length > MAX_TEXTS) throw new Error(`Embeddings : au plus ${MAX_TEXTS} textes par appel`);
    if (texts.some((t) => t.trim().length === 0 || t.length > MAX_CHARS)) throw new Error("Embeddings : texte vide ou trop long");

    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const res = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal,
    });
    if (!res.ok) throw new Error(`Mistral embeddings a échoué (${res.status})`);

    const data = (await res.json()) as { data?: Array<{ index?: number; embedding?: unknown }> };
    const items = [...(data.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (items.length !== texts.length) throw new Error("Mistral embeddings : nombre de vecteurs inattendu");
    return items.map((item) => {
      const v = item.embedding;
      if (!Array.isArray(v) || v.length !== this.dimensions || v.some((x) => typeof x !== "number" || !Number.isFinite(x))) {
        throw new Error(`Mistral embeddings : vecteur invalide (dimension attendue ${this.dimensions})`);
      }
      return v as number[];
    });
  }
}
