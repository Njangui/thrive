import { describe, it, expect } from "vitest";
import { shouldEscalate, shouldAutoRespond } from "./handoff-service";

describe("shouldEscalate", () => {
  it("détecte une demande de remboursement", () => {
    expect(shouldEscalate("Je veux un remboursement, le produit est cassé")).toBe("refund_request");
  });

  it("détecte une plainte", () => {
    expect(shouldEscalate("C'est vraiment inadmissible, je suis déçu")).toBe("complaint");
  });

  it("ne déclenche rien pour un message normal (section 46 : ne pas escalader inutilement)", () => {
    expect(shouldEscalate("Bonjour, vous avez des chaussures ?")).toBeNull();
    expect(shouldEscalate("Merci beaucoup, à bientôt !")).toBeNull();
  });
});

describe("shouldAutoRespond — critère d'acceptation Lot 3 (audit master prompt §31)", () => {
  it("autorise la réponse automatique uniquement en statut 'ai'", () => {
    expect(shouldAutoRespond("ai")).toBe(true);
  });

  it("bloque l'IA pendant 'pending_human' (en attente d'un humain)", () => {
    expect(shouldAutoRespond("pending_human")).toBe(false);
  });

  it("bloque l'IA pendant 'human' (déjà pris en charge) — c'est le bug corrigé : un nouveau message pendant la prise en charge ne doit jamais relancer l'IA", () => {
    expect(shouldAutoRespond("human")).toBe(false);
  });

  it("bloque l'IA sur une conversation 'resolved' (ne doit pas repartir seule)", () => {
    expect(shouldAutoRespond("resolved")).toBe(false);
  });
});
