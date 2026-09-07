import { describe, it, expect } from "vitest";
import { shouldEscalate } from "./handoff-service";

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
