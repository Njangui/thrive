/**
 * Mémoire d'entreprise (P6). Contenu = données du tenant : jamais d'instruction
 * pour l'agent (le runtime balise tout résultat d'outil comme non fiable).
 * Chaque appel qui consomme un embedding est compté au registre d'usage
 * (idempotent). Aucun contenu n'est journalisé.
 */
import { createHash, randomUUID } from "node:crypto";
import type { Actor, UsageService } from "@/application/agents/contracts";
import { AgentError } from "@/application/agents/errors";
import type { EmbeddingPort } from "@/domain/ports/embedding";
import { looksLikeSecret } from "./secret-guard";

export type MemoryKind = "fact" | "preference" | "faq" | "decision";
export const MEMORY_KINDS: readonly MemoryKind[] = ["fact", "preference", "faq", "decision"];

export interface MemoryHit {
  id: string;
  kind: MemoryKind;
  content: string;
  source: string;
  similarity: number;
}

export interface MemoryRepository {
  existsByHash(tenantId: string, hash: string): Promise<boolean>;
  upsert(input: {
    tenantId: string; kind: MemoryKind; content: string; hash: string; embedding: number[]; model: string;
    source: "user" | "agent" | "import"; createdBy: string; expiresAt: Date | null; maxActive: number;
  }): Promise<{ status: "created" | "duplicate" | "quota_exceeded"; id?: string }>;
  search(tenantId: string, embedding: number[], limit: number, minSimilarity: number): Promise<MemoryHit[]>;
  archive(tenantId: string, id: string): Promise<"archived" | "not_found">;
  erase(tenantId: string, id: string): Promise<"erased" | "not_found">;
}

export interface MemoryServiceDeps {
  repo: MemoryRepository;
  embeddings: EmbeddingPort;
  usage: UsageService;
  /** Quota d'entrées actives par organisation. */
  maxActive?: number;
  /** Similarité cosinus minimale : à calibrer avec le jeu d'évaluation. */
  minSimilarity?: number;
  newId?: () => string;
}

const MAX_CONTENT = 2000;
const MAX_QUERY = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const normalizeMemory = (text: string) => text.replace(/\s+/g, " ").trim();
export const memoryHash = (text: string) => createHash("sha256").update(normalizeMemory(text).toLowerCase()).digest("hex");

function assertWritableChannel(actor: Actor): void {
  // Un message de client (zone non fiable) ne peut jamais alimenter la mémoire de l'entreprise.
  if (actor.channel === "customer") throw new AgentError("memory_forbidden", "Canal non autorisé");
}

export function createMemoryService(deps: MemoryServiceDeps) {
  const maxActive = deps.maxActive ?? 500;
  const minSimilarity = deps.minSimilarity ?? 0.3;
  const newId = deps.newId ?? randomUUID;

  async function embedOne(text: string): Promise<number[]> {
    const [vector] = await deps.embeddings.embed([text]);
    if (!vector || vector.length !== deps.embeddings.dimensions) throw new AgentError("memory_invalid", "Embedding invalide");
    return vector;
  }

  return {
    async remember(actor: Actor, input: { kind: MemoryKind; content: string; expiresInDays?: number; source?: "user" | "agent" | "import" }) {
      assertWritableChannel(actor);
      if (!MEMORY_KINDS.includes(input.kind)) throw new AgentError("memory_invalid", "Type inconnu");
      const content = normalizeMemory(input.content ?? "");
      if (content.length < 1 || content.length > MAX_CONTENT) throw new AgentError("memory_invalid", "Contenu vide ou trop long");
      if (looksLikeSecret(content)) throw new AgentError("memory_invalid", "Le contenu ressemble à un secret : refusé");
      if (input.expiresInDays !== undefined && (!Number.isInteger(input.expiresInDays) || input.expiresInDays < 1 || input.expiresInDays > 3650)) {
        throw new AgentError("memory_invalid", "Durée de validité invalide");
      }
      const hash = memoryHash(content);
      // Doublon : ni appel au fournisseur, ni débit.
      if (await deps.repo.existsByHash(actor.tenantId, hash)) return { status: "duplicate" as const };

      const charge = await deps.usage.charge({ tenantId: actor.tenantId, actorId: actor.userId, kind: "ai", units: 1, ref: `mem:${actor.tenantId}:${hash}` });
      if (charge.status === "insufficient") return { status: "insufficient_credits" as const };

      const embedding = await embedOne(content);
      const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;
      const res = await deps.repo.upsert({
        tenantId: actor.tenantId, kind: input.kind, content, hash, embedding, model: deps.embeddings.model,
        source: input.source ?? "agent", createdBy: actor.userId, expiresAt, maxActive,
      });
      return res;
    },

    async search(actor: Actor, input: { query: string; limit?: number }): Promise<{ status: "ok"; hits: MemoryHit[] } | { status: "insufficient_credits" }> {
      if (actor.channel === "customer") throw new AgentError("memory_forbidden", "Canal non autorisé");
      const query = normalizeMemory(input.query ?? "");
      if (query.length < 1 || query.length > MAX_QUERY) throw new AgentError("memory_invalid", "Requête vide ou trop longue");
      if (looksLikeSecret(query)) throw new AgentError("memory_invalid", "La requête ressemble à un secret : refusée");
      const limit = Math.min(Math.max(Math.floor(input.limit ?? 5), 1), 10);

      const charge = await deps.usage.charge({ tenantId: actor.tenantId, actorId: actor.userId, kind: "ai", units: 1, ref: `memq:${newId()}` });
      if (charge.status === "insufficient") return { status: "insufficient_credits" };

      const embedding = await embedOne(query);
      const hits = await deps.repo.search(actor.tenantId, embedding, limit, minSimilarity);
      return { status: "ok", hits };
    },

    async forget(actor: Actor, id: string) {
      assertWritableChannel(actor);
      if (!UUID.test(id)) throw new AgentError("memory_invalid", "Identifiant invalide");
      return deps.repo.archive(actor.tenantId, id);
    },

    /** Effacement définitif (droit à l'effacement) : propriétaire ou administrateur, depuis le tableau de bord. */
    async erase(actor: Actor, id: string) {
      if (!["owner", "admin"].includes(actor.role) || actor.channel !== "dashboard") throw new AgentError("memory_forbidden", "Réservé au propriétaire ou à l'administrateur");
      if (!UUID.test(id)) throw new AgentError("memory_invalid", "Identifiant invalide");
      return deps.repo.erase(actor.tenantId, id);
    },
  };
}

export type MemoryService = ReturnType<typeof createMemoryService>;
