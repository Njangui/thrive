import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifyNotchPaySignature, hashPayload, parseNotchPayWebhookPayload } from "./webhook-handler";

describe("verifyNotchPaySignature", () => {
  const secret = "test-webhook-secret";
  const body = JSON.stringify({ id: "evt_123", event: "payment.complete", data: { reference: "ref-1" } });

  function sign(payload: string, key: string): string {
    return crypto.createHmac("sha256", key).update(payload).digest("hex");
  }

  it("accepte une signature valide", () => {
    const signature = sign(body, secret);
    expect(verifyNotchPaySignature(body, signature, secret)).toBe(true);
  });

  it("rejette une signature invalide", () => {
    expect(verifyNotchPaySignature(body, "0".repeat(64), secret)).toBe(false);
  });

  it("rejette si le body a été modifié après signature (protection contre la falsification)", () => {
    const signature = sign(body, secret);
    const tamperedBody = JSON.stringify({
      id: "evt_123",
      event: "payment.complete",
      data: { reference: "ref-1", amount: 999999 },
    });
    expect(verifyNotchPaySignature(tamperedBody, signature, secret)).toBe(false);
  });

  it("rejette si le secret utilisé pour signer est différent", () => {
    const signature = sign(body, "wrong-secret");
    expect(verifyNotchPaySignature(body, signature, secret)).toBe(false);
  });

  it("rejette une signature absente", () => {
    expect(verifyNotchPaySignature(body, null, secret)).toBe(false);
  });

  it("rejette si le secret n'est pas configuré", () => {
    const signature = sign(body, secret);
    expect(verifyNotchPaySignature(body, signature, "")).toBe(false);
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

describe("parseNotchPayWebhookPayload", () => {
  it("parse un événement unique (confirmé : pas de batch côté NotchPay, contrairement à Zernio)", () => {
    const result = parseNotchPayWebhookPayload(
      '{"id":"evt_1","event":"payment.complete","data":{"reference":"ref-1","status":"complete","amount":5000,"currency":"XAF","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}}',
    );
    expect(result.id).toBe("evt_1");
    expect(result.event).toBe("payment.complete");
    expect(result.data.reference).toBe("ref-1");
  });

  it("lève une erreur sur un JSON invalide (jamais un objet vide silencieux)", () => {
    expect(() => parseNotchPayWebhookPayload("not json")).toThrow();
  });
});
