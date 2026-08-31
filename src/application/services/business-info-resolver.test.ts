import { describe, it, expect } from "vitest";
import { detectBusinessInfoTopic } from "./business-info-resolver";

describe("detectBusinessInfoTopic", () => {
  it("détecte une question d'horaires", () => {
    expect(detectBusinessInfoTopic("Vous êtes ouverts dimanche ?")).toBe("hours");
    expect(detectBusinessInfoTopic("C'est à quelle heure la fermeture ?")).toBe("hours");
  });

  it("détecte une question d'adresse", () => {
    expect(detectBusinessInfoTopic("Quelle est votre adresse ?")).toBe("address");
  });

  it("détecte une question de contact", () => {
    expect(detectBusinessInfoTopic("Je peux avoir votre numéro de téléphone ?")).toBe("contact");
  });

  it("ne détecte rien pour une question hors sujet (laisse la main au reste du routeur)", () => {
    expect(detectBusinessInfoTopic("Le jean slim est encore disponible ?")).toBeNull();
  });

  it("est insensible aux accents/casse", () => {
    expect(detectBusinessInfoTopic("VOS HORAIRES SVP")).toBe("hours");
  });
});
