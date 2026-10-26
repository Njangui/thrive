import { describe, expect, it, vi } from "vitest";
import type { Actor, UsageService } from "@/application/agents/contracts";
import type { EmbeddingPort } from "@/domain/ports/embedding";
import { MistralEmbeddingAdapter } from "@/infrastructure/providers/embedding/mistral-embedding";
import { toVectorLiteral } from "@/infrastructure/memory/supabase-memory-repository";
import { createMemoryService, memoryHash, type MemoryHit, type MemoryRepository } from "./memory-service";
import { looksLikeSecret } from "./secret-guard";

const actor = (over: Partial<Actor> = {}): Actor => ({ userId: "u1", tenantId: "t1", role: "owner", extraPermissions: [], channel: "dashboard", ...over });
const UUID = "22222222-0000-0000-0000-000000000001";

describe("secret-guard", () => {
  it.each([
    "Bearer abcdefghijklmnopqrstuvwxyz123456",
    "clé : sk-live-ABCDEFGHIJKLMNOPQRSTUV",
    "mot de passe: Tr0ub4dor&3",
    "password = hunter2hunter2",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
    "-----BEGIN RSA PRIVATE KEY-----",
    "carte 4111 1111 1111 1111 expire 12/28",
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN0123456789",
  ])("détecte %s", (t) => expect(looksLikeSecret(t)).toBe(true));

  it.each([
    "Livraison gratuite à Douala pour toute commande de plus de 20 000 FCFA",
    "Nous ouvrons de 8h à 18h, du lundi au samedi. Téléphone : 6 99 12 34 56",
    "Le client préfère être contacté par WhatsApp",
    "Référence commande 2026-10-0042",
  ])("laisse passer %s", (t) => expect(looksLikeSecret(t)).toBe(false));
});

describe("MistralEmbeddingAdapter", () => {
  const vec = (n = 1024) => Array.from({ length: n }, (_, i) => i / n);
  const ok = (data: unknown) => vi.fn(async () => new Response(JSON.stringify(data), { status: 200 }));

  it("renvoie les vecteurs dans l'ordre de `index`", async () => {
    const f = ok({ data: [{ index: 1, embedding: vec().map((x) => x + 1) }, { index: 0, embedding: vec() }] });
    const out = await new MistralEmbeddingAdapter("k", "mistral-embed", 1024, undefined, f as never).embed(["a", "b"]);
    expect(out[0]?.[1]).toBeCloseTo(1 / 1024);
    expect(out[1]?.[1]).toBeGreaterThan(1);
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({ model: "mistral-embed", input: ["a", "b"] });
  });

  it.each([
    ["mauvaise dimension", { data: [{ index: 0, embedding: vec(10) }] }],
    ["valeur non finie", { data: [{ index: 0, embedding: [...vec(1023), null] }] }],
    ["nombre de vecteurs", { data: [] }],
  ])("refuse : %s", async (_n, data) => {
    await expect(new MistralEmbeddingAdapter("k", "m", 1024, undefined, ok(data) as never).embed(["a"])).rejects.toThrow();
  });

  it("l'erreur HTTP ne contient ni le texte ni la clé", async () => {
    const f = vi.fn(async () => new Response("echo: texte-secret-client", { status: 429 }));
    const err = await new MistralEmbeddingAdapter("cle-api-123", "m", 1024, undefined, f as never).embed(["texte-secret-client"]).catch((e: Error) => e);
    expect((err as Error).message).toBe("Mistral embeddings a échoué (429)");
  });

  it("refuse texte vide, trop long, trop de textes — sans appel réseau", async () => {
    const f = ok({ data: [] });
    const a = new MistralEmbeddingAdapter("k", "m", 1024, undefined, f as never);
    await expect(a.embed(["  "])).rejects.toThrow();
    await expect(a.embed(["x".repeat(8001)])).rejects.toThrow();
    await expect(a.embed(Array.from({ length: 17 }, () => "a"))).rejects.toThrow();
    expect(await a.embed([])).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("memory-service", () => {
  const embeddings: EmbeddingPort = { providerName: "fake", model: "fake-embed", dimensions: 4, embed: vi.fn(async (t: string[]) => t.map(() => [1, 0, 0, 0])) };
  const mk = (over: Partial<MemoryRepository> = {}, usage?: UsageService) => {
    const repo: MemoryRepository = {
      existsByHash: vi.fn(async () => false),
      upsert: vi.fn(async () => ({ status: "created" as const, id: UUID })),
      search: vi.fn(async (): Promise<MemoryHit[]> => []),
      archive: vi.fn(async () => "archived" as const),
      erase: vi.fn(async () => "erased" as const),
      ...over,
    };
    const u: UsageService = usage ?? { charge: vi.fn(async () => ({ status: "charged" as const })) };
    return { repo, usage: u, svc: createMemoryService({ repo, embeddings, usage: u, newId: () => "q1" }) };
  };

  it("mémorise : normalise, hache, débite (idempotent), tag le tenant de l'ACTEUR", async () => {
    const { repo, usage, svc } = mk();
    const res = await svc.remember(actor(), { kind: "fact", content: "  Livraison   gratuite \n à Douala " });
    expect(res).toMatchObject({ status: "created" });
    const hash = memoryHash("livraison gratuite à douala");
    expect(usage.charge).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1", kind: "ai", units: 1, ref: `mem:t1:${hash}` }));
    expect(repo.upsert).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1", content: "Livraison gratuite à Douala", hash, source: "agent", model: "fake-embed", createdBy: "u1" }));
  });

  it("doublon : ni embedding ni débit", async () => {
    const { usage, svc } = mk({ existsByHash: vi.fn(async () => true) });
    expect(await svc.remember(actor(), { kind: "fact", content: "déjà là" })).toEqual({ status: "duplicate" });
    expect(usage.charge).not.toHaveBeenCalled();
    expect(embeddings.embed).not.toHaveBeenCalledWith(["déjà là"]);
  });

  it.each([
    { kind: "fact" as const, content: "" },
    { kind: "fact" as const, content: "x".repeat(2001) },
    { kind: "secret" as never, content: "ok" },
    { kind: "fact" as const, content: "mot de passe: Tr0ub4dor&3" },
    { kind: "fact" as const, content: "ok", expiresInDays: 0 },
    { kind: "fact" as const, content: "ok", expiresInDays: 1.5 },
  ])("refuse %o sans rien appeler", async (input) => {
    const { repo, usage, svc } = mk();
    await expect(svc.remember(actor(), input)).rejects.toMatchObject({ code: "memory_invalid" });
    expect(usage.charge).not.toHaveBeenCalled();
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it("le canal customer ne peut ni écrire ni lire ni archiver", async () => {
    const { repo, svc } = mk();
    const c = actor({ channel: "customer" });
    await expect(svc.remember(c, { kind: "fact", content: "ok" })).rejects.toMatchObject({ code: "memory_forbidden" });
    await expect(svc.search(c, { query: "ok" })).rejects.toMatchObject({ code: "memory_forbidden" });
    await expect(svc.forget(c, UUID)).rejects.toMatchObject({ code: "memory_forbidden" });
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it("crédits insuffisants : pas d'appel au fournisseur d'embeddings", async () => {
    const before = (embeddings.embed as ReturnType<typeof vi.fn>).mock.calls.length;
    const { svc } = mk({}, { charge: async () => ({ status: "insufficient" }) });
    expect(await svc.remember(actor(), { kind: "fact", content: "nouveau" })).toEqual({ status: "insufficient_credits" });
    expect(await svc.search(actor(), { query: "q" })).toEqual({ status: "insufficient_credits" });
    expect((embeddings.embed as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
  });

  it("recherche : borne la limite, applique le seuil, interroge le tenant de l'ACTEUR", async () => {
    const hits: MemoryHit[] = [{ id: UUID, kind: "faq", content: "Horaires 8h-18h", source: "user", similarity: 0.8 }];
    const { repo, svc } = mk({ search: vi.fn(async () => hits) });
    expect(await svc.search(actor(), { query: "horaires ?", limit: 999 })).toEqual({ status: "ok", hits });
    expect(repo.search).toHaveBeenCalledWith("t1", [1, 0, 0, 0], 10, 0.3);
    await svc.search(actor(), { query: "horaires ?", limit: -4 });
    expect(repo.search).toHaveBeenLastCalledWith("t1", [1, 0, 0, 0], 1, 0.3);
  });

  it("recherche : refuse requête vide/trop longue/secrète", async () => {
    const { svc } = mk();
    for (const query of ["", "x".repeat(501), "Bearer abcdefghijklmnopqrstuvwxyz123456"]) {
      await expect(svc.search(actor(), { query })).rejects.toMatchObject({ code: "memory_invalid" });
    }
  });

  it("embedding de mauvaise taille : refusé, rien n'est stocké", async () => {
    const bad: EmbeddingPort = { ...embeddings, embed: async () => [[1, 2]] };
    const repo = mk().repo;
    const svc = createMemoryService({ repo, embeddings: bad, usage: { charge: async () => ({ status: "charged" }) } });
    await expect(svc.remember(actor(), { kind: "fact", content: "ok" })).rejects.toMatchObject({ code: "memory_invalid" });
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it("effacement définitif : propriétaire/admin sur le tableau de bord uniquement ; identifiant validé", async () => {
    const { repo, svc } = mk();
    expect(await svc.erase(actor(), UUID)).toBe("erased");
    for (const a of [actor({ role: "manager" }), actor({ channel: "telegram" }), actor({ channel: "customer" })]) {
      await expect(svc.erase(a, UUID)).rejects.toMatchObject({ code: "memory_forbidden" });
    }
    await expect(svc.erase(actor(), "pas-un-uuid")).rejects.toMatchObject({ code: "memory_invalid" });
    expect(repo.erase).toHaveBeenCalledTimes(1);
  });

  it("littéral pgvector", () => expect(toVectorLiteral([0.5, -1, 2])).toBe("[0.5,-1,2]"));
});
