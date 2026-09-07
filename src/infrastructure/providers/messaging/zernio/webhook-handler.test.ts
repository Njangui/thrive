import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifyZernioSignature, hashPayload, parseZernioWebhookPayload } from "./webhook-handler";

describe("verifyZernioSignature", () => {
  const secret = "test-signing-secret";
  const body = JSON.stringify({ id: "evt_123", event: "message.received" });

  function sign(payload: string, key: string): string {
    return crypto.createHmac("sha256", key).update(payload).digest("hex");
  }

  it("accepte une signature valide", () => {
    const signature = sign(body, secret);
    expect(verifyZernioSignature(body, signature, secret)).toBe(true);
  });

  it("rejette une signature invalide", () => {
    expect(verifyZernioSignature(body, "0".repeat(64), secret)).toBe(false);
  });

  it("rejette si le body a été modifié après signature (protection contre la falsification)", () => {
    const signature = sign(body, secret);
    const tamperedBody = JSON.stringify({ id: "evt_123", event: "message.received", extra: "injected" });
    expect(verifyZernioSignature(tamperedBody, signature, secret)).toBe(false);
  });

  it("rejette si le secret utilisé pour signer est différent", () => {
    const signature = sign(body, "wrong-secret");
    expect(verifyZernioSignature(body, signature, secret)).toBe(false);
  });

  it("rejette une signature absente", () => {
    expect(verifyZernioSignature(body, null, secret)).toBe(false);
  });

  it("rejette si le secret n'est pas configuré", () => {
    const signature = sign(body, secret);
    expect(verifyZernioSignature(body, signature, "")).toBe(false);
  });
});

describe("hashPayload", () => {
  it("produit un hash stable pour un même contenu", () => {
    const body = '{"a":1}';
    expect(hashPayload(body)).toBe(hashPayload(body));
  });

  it("produit des hashs différents pour des contenus différents", () => {
    expect(hashPayload('{"a":1}')).not.toBe(hashPayload('{"a":2}'));
  });
});

describe("parseZernioWebhookPayload", () => {
  it("normalise un objet unique en tableau d'un élément", () => {
    const result = parseZernioWebhookPayload('{"id":"evt_1","event":"message.received"}');
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("evt_1");
  });

  it("laisse un tableau déjà présent tel quel", () => {
    const result = parseZernioWebhookPayload('[{"id":"evt_1"},{"id":"evt_2"}]');
    expect(result).toHaveLength(2);
  });
});
