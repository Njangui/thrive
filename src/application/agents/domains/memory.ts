/**
 * Outils de mémoire d'entreprise (C1). À brancher avec un service construit en
 * production : `domainRegistrars.push(createMemoryRegistrar(service))`.
 * Lecture : owner/admin/manager (alignée sur la RLS de `tenant_memory`).
 * Écriture : réversible => confirmation par défaut ; jamais depuis la vitrine.
 */
import { z } from "zod";
import type { MemoryService } from "@/application/memory/memory-service";
import { MEMORY_KINDS } from "@/application/memory/memory-service";
import type { ToolDef } from "../contracts";
import type { DomainRegistrar } from "./index";

const ROLES = ["owner", "admin", "manager"] as const;

export function createMemoryTools(service: MemoryService) {
  const search: ToolDef<{ query: string; limit?: number }, { status: string; results: Array<{ id: string; kind: string; content: string; similarity: number }> }> = {
    name: "memory.search",
    domain: "memory",
    description: "Cherche dans la mémoire de l'entreprise (faits, préférences, FAQ, décisions) par similarité de sens.",
    input: z.object({ query: z.string().min(1).max(500), limit: z.number().int().min(1).max(10).optional() }),
    output: z.object({
      status: z.string(),
      results: z.array(z.object({ id: z.string(), kind: z.string(), content: z.string(), similarity: z.number() })),
    }),
    risk: "read",
    permission: "memory.read",
    estimateCost: () => ({ items: [{ kind: "ai", units: 1 }] }),
    run: async (ctx, input) => {
      const res = await service.search(ctx.actor, input);
      if (res.status !== "ok") return { status: res.status, results: [] };
      return { status: "ok", results: res.hits.map((h) => ({ id: h.id, kind: h.kind, content: h.content, similarity: Math.round(h.similarity * 1000) / 1000 })) };
    },
  };

  const remember: ToolDef<{ kind: (typeof MEMORY_KINDS)[number]; content: string; expiresInDays?: number }, { status: string; id?: string }> = {
    name: "memory.remember",
    domain: "memory",
    description: "Mémorise un fait, une préférence, une FAQ ou une décision de l'entreprise. Jamais de mot de passe, clé ou numéro de carte.",
    input: z.object({ kind: z.enum(["fact", "preference", "faq", "decision"]), content: z.string().min(1).max(2000), expiresInDays: z.number().int().min(1).max(3650).optional() }),
    output: z.object({ status: z.string(), id: z.string().optional() }),
    risk: "write_reversible",
    permission: "memory.write",
    estimateCost: () => ({ items: [{ kind: "ai", units: 1 }] }),
    run: async (ctx, input) => service.remember(ctx.actor, { ...input, source: "agent" }),
  };

  const forget: ToolDef<{ id: string }, { status: string }> = {
    name: "memory.forget",
    domain: "memory",
    description: "Archive une entrée de la mémoire (elle n'est plus utilisée).",
    input: z.object({ id: z.string().min(1) }),
    output: z.object({ status: z.string() }),
    risk: "write_reversible",
    permission: "memory.forget",
    run: async (ctx, input) => ({ status: await service.forget(ctx.actor, input.id) }),
  };
  return { search, remember, forget };
}

export function createMemoryRegistrar(service: MemoryService): DomainRegistrar {
  return ({ kernel }) => {
    const t = createMemoryTools(service);
    kernel.registerTool(t.search, { roles: ROLES });
    kernel.registerTool(t.remember, { roles: ROLES });
    kernel.registerTool(t.forget, { roles: ROLES });
  };
}
