import { describe, it, expect, vi } from "vitest";
import { R2StorageAdapter, toObjectPath } from "./r2-storage-adapter";
import { StorageObjectExistsError } from "@/domain/ports/storage-provider";

const config = {
  accountId: "acc123",
  accessKeyId: "AK",
  secretAccessKey: "SK",
  bucket: "flexco-media",
  publicBaseUrl: "https://media.exemple.com/",
};

describe("toObjectPath", () => {
  it("préfixe par l'organisation, de façon idempotente", () => {
    expect(toObjectPath("org1", "product/a.png")).toBe("org1/product/a.png");
    expect(toObjectPath("org1", "org1/product/a.png")).toBe("org1/product/a.png");
  });
  it("refuse la traversée de chemin", () => {
    expect(() => toObjectPath("org1", "../org2/a.png")).toThrow();
    expect(() => toObjectPath("org1", "a/./b.png")).toThrow();
  });
});

describe("R2StorageAdapter", () => {
  it("envoie un PUT signé, non écrasant, vers le bon endpoint path-style", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const adapter = new R2StorageAdapter(config, fetchMock as unknown as typeof fetch);
    const result = await adapter.upload({
      organizationId: "org1",
      path: "product/photo été.png",
      contentType: "image/png",
      data: Buffer.from("x"),
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://acc123.r2.cloudflarestorage.com/flexco-media/org1/product/photo%20%C3%A9t%C3%A9.png");
    expect(init.method).toBe("PUT");
    expect(init.headers["if-none-match"]).toBe("*");
    expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\//);
    expect(result.path).toBe("org1/product/photo été.png");
    expect(result.url).toBe("https://media.exemple.com/org1/product/photo%20%C3%A9t%C3%A9.png");
  });

  it("n'expose ni clé ni secret dans les erreurs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("secret SK", { status: 403 }));
    const adapter = new R2StorageAdapter(config, fetchMock as unknown as typeof fetch);
    await expect(
      adapter.upload({ organizationId: "o", path: "a.png", contentType: "image/png", data: Buffer.from("x") }),
    ).rejects.toThrow(/403/);
    await expect(
      adapter.upload({ organizationId: "o", path: "a.png", contentType: "image/png", data: Buffer.from("x") }),
    ).rejects.not.toThrow(/SK/);
  });

  it("tolère un 404 à la suppression mais pas un 500", async () => {
    const ok404 = new R2StorageAdapter(config, vi.fn().mockResolvedValue(new Response(null, { status: 404 })) as unknown as typeof fetch);
    await expect(ok404.delete("o", "a.png")).resolves.toBeUndefined();
    const ko = new R2StorageAdapter(config, vi.fn().mockResolvedValue(new Response(null, { status: 500 })) as unknown as typeof fetch);
    await expect(ko.delete("o", "a.png")).rejects.toThrow(/500/);
  });

  it("signale un objet déjà présent (412) par une erreur typée, pour reprendre une migration", async () => {
    const adapter = new R2StorageAdapter(config, vi.fn().mockResolvedValue(new Response(null, { status: 412 })) as unknown as typeof fetch);
    await expect(
      adapter.upload({ organizationId: "o", path: "a.png", contentType: "image/png", data: Buffer.from("x") }),
    ).rejects.toBeInstanceOf(StorageObjectExistsError);
  });
});
