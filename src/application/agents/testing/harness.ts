/** Banc d'essai partagé : noyau, outils d'exemple, acteurs, dépendances en mémoire. */
import { z } from "zod";
import type { Actor, Role, StepUpPort, ToolDef, UsageService } from "../contracts";
import { createPendingActionService } from "../pending-actions";
import { createActionEvaluator } from "../rule-engine";
import { createAgentKernel } from "../tool-registry";
import { createTenantScopedDb } from "../tenant-scoped-db";
import type { RuntimeDeps } from "../execute-tool";
import { InMemoryAuditSink, InMemoryPendingRepo, InMemorySettingsRepo } from "./in-memory";
import { FakeSupabase } from "./fake-supabase";

export const TENANT_A = "tenant-a";
export const TENANT_B = "tenant-b";

export function actor(role: Role, over: Partial<Actor> = {}): Actor {
  return { userId: `user-${role}`, tenantId: TENANT_A, role, extraPermissions: [], channel: "dashboard", ...over };
}

export const listProducts: ToolDef<{ limit?: number }, { names: string[] }> = {
  name: "catalog.list_products",
  domain: "catalog",
  description: "Liste les produits du tenant.",
  input: z.object({ limit: z.number().int().positive().optional() }),
  output: z.object({ names: z.array(z.string()) }),
  risk: "read",
  permission: "catalog.read",
  storefrontSafe: true,
  run: async (ctx) => {
    const { data } = await ctx.db.from("products").select("name");
    return { names: (data as Array<{ name: string }>).map((row) => row.name) };
  },
};

export const draftDescription: ToolDef<{ productId: string; text: string }, { ok: boolean }> = {
  name: "catalog.draft_description",
  domain: "catalog",
  description: "Crée un brouillon de description (inerte).",
  input: z.object({ productId: z.string(), text: z.string() }),
  risk: "write_reversible",
  permission: "catalog.draft",
  storefrontSafe: true,
  run: async () => ({ ok: true }),
};

export const addNote: ToolDef<{ text: string }, { ok: boolean }> = {
  name: "notes.add",
  domain: "notes",
  description: "Ajoute une note interne.",
  input: z.object({ text: z.string() }),
  risk: "write_reversible",
  permission: "notes.write",
  run: async (ctx, input) => {
    await ctx.db.from("notes").insert({ text: input.text });
    return { ok: true };
  },
};

export const updatePrice: ToolDef<{ productId: string; price: number; meta?: { reason: string; token?: string } }, { ok: boolean }> = {
  name: "catalog.update_price",
  domain: "catalog",
  description: "Change le prix d'un produit.",
  input: z.object({
    productId: z.string(),
    price: z.number().nonnegative(),
    meta: z.object({ reason: z.string(), token: z.string().optional() }).optional(),
  }),
  risk: "sensitive",
  permission: "catalog.price",
  estimateCost: () => ({ items: [{ kind: "ai", units: 1 }] }),
  run: async (ctx, input) => {
    await ctx.db.from("products").update({ price: input.price }).eq("id", input.productId);
    return { ok: true };
  },
};

export interface Harness {
  deps: RuntimeDeps;
  kernel: ReturnType<typeof createAgentKernel>;
  repo: InMemoryPendingRepo;
  audit: InMemoryAuditSink;
  settings: InMemorySettingsRepo;
  db: FakeSupabase;
  clock: { now: Date };
}

export function buildHarness(opts: { stepUp?: StepUpPort } = {}): Harness {
  const kernel = createAgentKernel();
  kernel.registerTool(listProducts, { roles: ["owner", "admin", "manager", "employee"] });
  kernel.registerTool(draftDescription, { roles: ["owner", "admin", "manager"] });
  kernel.registerTool(addNote, { roles: ["owner", "admin", "manager", "employee"] });
  kernel.registerTool(updatePrice, { roles: ["owner", "admin"] });

  const clock = { now: new Date("2026-10-07T10:00:00Z") };
  const repo = new InMemoryPendingRepo();
  const audit = new InMemoryAuditSink();
  const settings = new InMemorySettingsRepo();
  const db = new FakeSupabase({
    products: [
      { id: "p1", organization_id: TENANT_A, name: "Robe A", price: 10 },
      { id: "p2", organization_id: TENANT_B, name: "Robe B", price: 20 },
    ],
    notes: [],
  });
  let seq = 0;
  const pending = createPendingActionService({
    repo,
    matrix: kernel.matrix,
    stepUp: opts.stepUp,
    now: () => clock.now,
    newId: () => `pa-${++seq}`,
  });
  const evaluate = createActionEvaluator({ settings, matrix: kernel.matrix, pending });
  const usage: UsageService = { charge: async () => ({ status: "charged" }) };
  const deps: RuntimeDeps = {
    registry: kernel.registry,
    evaluate,
    pending,
    audit,
    usage,
    makeDb: (tenantId) => createTenantScopedDb(db as never, tenantId),
  };
  return { deps, kernel, repo, audit, settings, db, clock };
}
