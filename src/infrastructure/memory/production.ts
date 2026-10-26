/** Assemblage de production de la mémoire d'entreprise. Exige MISTRAL_API_KEY (embeddings). */
import type { UsageService } from "@/application/agents/contracts";
import { createMemoryService } from "@/application/memory/memory-service";
import { MistralEmbeddingAdapter } from "@/infrastructure/providers/embedding/mistral-embedding";
import { createSupabaseMemoryRepository } from "./supabase-memory-repository";

export function createProductionMemoryService(deps: { usage: UsageService }) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("Mémoire d'entreprise : MISTRAL_API_KEY manquante");
  return createMemoryService({
    repo: createSupabaseMemoryRepository(),
    embeddings: new MistralEmbeddingAdapter(apiKey),
    usage: deps.usage,
  });
}
