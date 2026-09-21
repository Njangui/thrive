import { describe, it, expect } from "vitest";
import { verifyFapshiWebhookSecret, parseFapshiWebhookPayload } from "./webhook-handler";

describe("verifyFapshiWebhookSecret", () => {
  it("accepte quand l'en-tête correspond exactement au secret configuré", () => {
    expect(verifyFapshiWebhookSecret("un-secret-partage", "un-secret-partage")).toBe(true);
  });

  it("refuse un en-tête absent", () => {
    expect(verifyFapshiWebhookSecret(null, "un-secret-partage")).toBe(false);
  });

  it("refuse un secret configuré vide (ne doit jamais laisser passer par défaut)", () => {
    expect(verifyFapshiWebhookSecret("peu-importe", "")).toBe(false);
  });

  it("refuse un en-tête différent, y compris de longueur différente (jamais de throw sur mismatch de longueur)", () => {
    expect(verifyFapshiWebhookSecret("court", "un-secret-partage-beaucoup-plus-long")).toBe(false);
    expect(verifyFapshiWebhookSecret("un-secret-partage-different", "un-secret-partage-original!")).toBe(false);
  });
});

describe("parseFapshiWebhookPayload", () => {
  it("parse directement l'objet Transaction, sans enveloppe {event, data} (contrairement à NotchPay)", () => {
    const raw = JSON.stringify({
      transId: "FAP2024ABC123",
      status: "SUCCESSFUL",
      medium: "mobile money",
      amount: 15000,
      externalId: "pay-local-uuid",
      userId: "org-1",
      email: "user@example.com",
    });

    const event = parseFapshiWebhookPayload(raw);

    expect(event.transId).toBe("FAP2024ABC123");
    expect(event.status).toBe("SUCCESSFUL");
    expect(event.externalId).toBe("pay-local-uuid");
  });

  it("laisse remonter l'exception sur un JSON invalide (l'appelant décide de la réponse HTTP)", () => {
    expect(() => parseFapshiWebhookPayload("pas du json")).toThrow();
  });
});
