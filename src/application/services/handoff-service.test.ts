import { describe, it, expect } from "vitest";
import { shouldEscalate, shouldAutoRespond, getAutoReplyMode } from "./handoff-service";

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

describe("getAutoReplyMode — la FAQ ne doit pas rester muette après une escalade « IA indisponible »", () => {
  it("statut 'ai' : réponse complète (règles puis IA)", () => {
    expect(getAutoReplyMode("ai", null)).toBe("full");
  });

  it("'pending_human' causé uniquement par l'IA indisponible : réponses déterministes (FAQ, catalogue) permises, jamais l'IA", () => {
    expect(getAutoReplyMode("pending_human", "ai_unavailable")).toBe("deterministic_only");
  });

  it("'pending_human' pour une plainte ou un remboursement : aucune réponse automatique", () => {
    expect(getAutoReplyMode("pending_human", "complaint")).toBe("none");
    expect(getAutoReplyMode("pending_human", "refund_request")).toBe("none");
  });

  it("'human' et 'resolved' : aucune réponse automatique", () => {
    expect(getAutoReplyMode("human", null)).toBe("none");
    expect(getAutoReplyMode("human", "ai_unavailable")).toBe("none");
    expect(getAutoReplyMode("resolved", null)).toBe("none");
  });
});
