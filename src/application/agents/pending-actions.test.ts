import { describe, expect, it } from "vitest";
import { paramsHash, canonicalize } from "./canonical";
import { createPendingActionService } from "./pending-actions";
import { actor, buildHarness, TENANT_B, updatePrice } from "./testing/harness";
import { InMemoryPendingRepo } from "./testing/in-memory";
import { createPermissionMatrix } from "./role-matrix";
import { createAgentKernel } from "./tool-registry";

/** PRNG déterministe (mulberry32) : le test de propriété est reproductible. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomParams(r: () => number, depth = 0): unknown {
  const kind = Math.floor(r() * (depth > 2 ? 4 : 6));
  switch (kind) {
    case 0: return Math.floor(r() * 1000);
    case 1: return `s${Math.floor(r() * 1000)}`;
    case 2: return r() > 0.5;
    case 3: return null;
    case 4: return Array.from({ length: 1 + Math.floor(r() * 3) }, () => randomParams(r, depth + 1));
    default: {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < 1 + Math.floor(r() * 3); i++) obj[`k${Math.floor(r() * 5)}`] = randomParams(r, depth + 1);
      return obj;
    }
  }
}

/** Modifie une valeur quelque part (feuille changée, clé ajoutée/supprimée). */
function mutate(r: () => number, value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length === 0 || r() < 0.3) return [...value, "extra"];
    const i = Math.floor(r() * value.length);
    return value.map((v, j) => (j === i ? mutate(r, v) : v));
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0 || r() < 0.25) return { ...obj, added: 1 };
    const key = keys[Math.floor(r() * keys.length)] as string;
    if (r() < 0.2) {
      const { [key]: _removed, ...rest } = obj;
      return rest;
    }
    return { ...obj, [key]: mutate(r, obj[key]) };
  }
  if (typeof value === "number") return value + 1;
  if (typeof value === "string") return `${value}!`;
  if (typeof value === "boolean") return !value;
  return "was-null";
}

const stepUpOk = { requestStepUp: async () => ({ verified: true }) };

describe("approbations ↔ empreinte (propriété : modifier un paramètre invalide l'approbation)", () => {
  it("200 jeux de paramètres aléatoires : un « oui » ne vaut que pour l'empreinte exacte", async () => {
    const r = rng(20261007);
    for (let i = 0; i < 200; i++) {
      const h = buildHarness({ stepUp: stepUpOk });
      const owner = actor("owner");
      const params = { payload: randomParams(r) };
      const mutated = mutate(r, params);
      if (canonicalize(mutated) === canonicalize(params)) continue;

      const row = await h.deps.pending.request({ actor: owner, tool: updatePrice, params });
      const mutatedHash = paramsHash(owner.tenantId, updatePrice.name, mutated);

      // 1. Approuver avec l'empreinte d'AUTRES paramètres échoue.
      expect(await h.deps.pending.approve({ approver: owner, tool: updatePrice, pendingActionId: row.id, expectedHash: mutatedHash }))
        .toEqual({ ok: false, reason: "params_changed" });

      // 2. Approuver avec la bonne empreinte réussit.
      const approved = await h.deps.pending.approve({ approver: owner, tool: updatePrice, pendingActionId: row.id, expectedHash: row.paramsHash });
      expect(approved.ok).toBe(true);

      // 3. Si les paramètres stockés sont altérés après le « oui », l'exécution est refusée.
      h.repo.rows.get(row.id)!.params = mutated;
      expect(await h.deps.pending.claimForExecution({ actor: owner, tool: updatePrice, pendingActionId: row.id }))
        .toEqual({ ok: false, reason: "integrity_error" });
    }
  });

  it("l'exécution rend les paramètres stockés, et ne sert qu'une fois", async () => {
    const h = buildHarness({ stepUp: stepUpOk });
    const owner = actor("owner");
    const row = await h.deps.pending.request({ actor: owner, tool: updatePrice, params: { productId: "p1", price: 5 } });
    await h.deps.pending.approve({ approver: owner, tool: updatePrice, pendingActionId: row.id, expectedHash: row.paramsHash });
    const first = await h.deps.pending.claimForExecution({ actor: owner, tool: updatePrice, pendingActionId: row.id });
    expect(first.ok && first.value.params).toEqual({ productId: "p1", price: 5 });
    expect(await h.deps.pending.claimForExecution({ actor: owner, tool: updatePrice, pendingActionId: row.id }))
      .toEqual({ ok: false, reason: "not_approved" });
  });

  it("expiration : une carte expirée ne peut plus être approuvée ; une approbation expirée ne s'exécute plus", async () => {
    const h = buildHarness({ stepUp: stepUpOk });
    const owner = actor("owner");
    const a = await h.deps.pending.request({ actor: owner, tool: updatePrice, params: { n: 1 } });
    h.clock.now = new Date(h.clock.now.getTime() + 16 * 60 * 1000);
    expect(await h.deps.pending.approve({ approver: owner, tool: updatePrice, pendingActionId: a.id, expectedHash: a.paramsHash }))
      .toEqual({ ok: false, reason: "expired" });
    expect(h.repo.rows.get(a.id)!.status).toBe("expired");

    h.clock.now = new Date("2026-10-07T10:00:00Z");
    const b = await h.deps.pending.request({ actor: owner, tool: updatePrice, params: { n: 2 } });
    await h.deps.pending.approve({ approver: owner, tool: updatePrice, pendingActionId: b.id, expectedHash: b.paramsHash });
    h.clock.now = new Date(h.clock.now.getTime() + 16 * 60 * 1000);
    expect(await h.deps.pending.claimForExecution({ actor: owner, tool: updatePrice, pendingActionId: b.id }))
      .toEqual({ ok: false, reason: "expired" });
  });

  it("isolation : un autre tenant ne voit ni n'approuve la carte", async () => {
    const h = buildHarness({ stepUp: stepUpOk });
    const row = await h.deps.pending.request({ actor: actor("owner"), tool: updatePrice, params: { n: 1 } });
    const intruder = actor("owner", { tenantId: TENANT_B, userId: "owner-b" });
    expect(await h.deps.pending.approve({ approver: intruder, tool: updatePrice, pendingActionId: row.id, expectedHash: row.paramsHash }))
      .toEqual({ ok: false, reason: "not_found" });
  });

  it("autorisation : l'approbateur doit détenir la permission de l'outil", async () => {
    const h = buildHarness({ stepUp: stepUpOk });
    const row = await h.deps.pending.request({ actor: actor("owner"), tool: updatePrice, params: { n: 1 } });
    expect(await h.deps.pending.approve({ approver: actor("employee"), tool: updatePrice, pendingActionId: row.id, expectedHash: row.paramsHash }))
      .toEqual({ ok: false, reason: "not_authorized" });
  });

  it("outil sensible : step-up obligatoire, fail-closed si le port est absent ou refuse", async () => {
    const owner = actor("owner");
    for (const stepUp of [undefined, { requestStepUp: async () => ({ verified: false }) }]) {
      const h = buildHarness({ stepUp });
      const row = await h.deps.pending.request({ actor: owner, tool: updatePrice, params: { n: 1 } });
      expect(await h.deps.pending.approve({ approver: owner, tool: updatePrice, pendingActionId: row.id, expectedHash: row.paramsHash }))
        .toEqual({ ok: false, reason: "step_up_required" });
      expect(h.repo.rows.get(row.id)!.status).toBe("pending");
    }
  });

  it("Q22 : auto-approbation d'une action sensible interdite s'il existe un autre approbateur", async () => {
    const owner = actor("owner");
    const build = (hasOther: (() => Promise<boolean>) | undefined) => {
      const repo = new InMemoryPendingRepo();
      const kernel = createAgentKernel();
      kernel.registerTool(updatePrice, { roles: ["owner", "admin"] });
      const svc = createPendingActionService({ repo, matrix: kernel.matrix, stepUp: stepUpOk, hasOtherApprover: hasOther });
      return { repo, svc };
    };
    // un autre membre existe : refus, la carte reste en attente
    let ctx = build(async () => true);
    let row = await ctx.svc.request({ actor: owner, tool: updatePrice, params: { n: 1 } });
    expect(await ctx.svc.approve({ approver: owner, tool: updatePrice, pendingActionId: row.id, expectedHash: row.paramsHash }))
      .toEqual({ ok: false, reason: "self_approval_forbidden" });
    expect(ctx.repo.rows.get(row.id)!.status).toBe("pending");
    // un autre approbateur (admin) peut approuver
    expect((await ctx.svc.approve({ approver: actor("admin"), tool: updatePrice, pendingActionId: row.id, expectedHash: row.paramsHash })).ok).toBe(true);
    // seul : peut s'approuver
    ctx = build(async () => false);
    row = await ctx.svc.request({ actor: owner, tool: updatePrice, params: { n: 2 } });
    expect((await ctx.svc.approve({ approver: owner, tool: updatePrice, pendingActionId: row.id, expectedHash: row.paramsHash })).ok).toBe(true);
    // vérification en erreur : refus par défaut
    ctx = build(async () => { throw new Error("db"); });
    row = await ctx.svc.request({ actor: owner, tool: updatePrice, params: { n: 3 } });
    expect(await ctx.svc.approve({ approver: owner, tool: updatePrice, pendingActionId: row.id, expectedHash: row.paramsHash }))
      .toEqual({ ok: false, reason: "self_approval_forbidden" });
  });

  it("refus explicite et transitions concurrentes : un seul gagnant", async () => {
    const h = buildHarness({ stepUp: stepUpOk });
    const owner = actor("owner");
    const row = await h.deps.pending.request({ actor: owner, tool: updatePrice, params: { n: 1 } });
    const [a, b] = await Promise.all([
      h.deps.pending.approve({ approver: owner, tool: updatePrice, pendingActionId: row.id, expectedHash: row.paramsHash }),
      h.deps.pending.reject({ approver: owner, pendingActionId: row.id }),
    ]);
    expect([a.ok, b].filter(Boolean)).toHaveLength(1);
  });

  it("service construit sans matrice permissive : permission non déclarée => refus", async () => {
    const repo = new InMemoryPendingRepo();
    const service = createPendingActionService({ repo, matrix: createPermissionMatrix(), stepUp: stepUpOk });
    const owner = actor("owner");
    const row = await service.request({ actor: owner, tool: updatePrice, params: { n: 1 } });
    expect(await service.approve({ approver: owner, tool: updatePrice, pendingActionId: row.id, expectedHash: row.paramsHash }))
      .toEqual({ ok: false, reason: "not_authorized" });
  });
});
