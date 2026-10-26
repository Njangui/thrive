import { describe, expect, it } from "vitest";
import { checkReplyQuality, type ReplyFacts } from "./reply-quality";

const facts = (sector?: string): ReplyFacts => ({ allowedAmounts: [], allowedOrigins: ["https://clinique.example"], allowedPhones: [], allowedEmails: [], alreadyGreeted: true, protectedMarkers: [], sector });
const violations = (text: string, sector?: string) => checkReplyQuality(text, facts(sector)).violations;

describe("garde-fous de réponse — santé", () => {
  it.each([
    "Prenez 500 mg de paracétamol toutes les 6 heures.",
    "Je vous conseille de prendre un antibiotique pendant une semaine.",
    "Vous avez sûrement le paludisme, faites un test.",
    "Mon diagnostic : une simple fatigue.",
    "Deux comprimés le matin suffiront.",
  ])("écarte : %s", (text) => {
    expect(violations(text, "health")).toContain("medical_advice");
  });

  it("laisse passer une réponse d'orientation vers un rendez-vous", () => {
    expect(violations("Je vous propose de prendre rendez-vous avec le docteur : choisissez un créneau sur notre page.", "health")).toEqual([]);
    expect(violations("Nous recevons du lundi au vendredi. En cas d'urgence, appelez les secours.", "health")).toEqual([]);
  });

  it("ne s'applique pas aux autres secteurs", () => {
    expect(violations("Prenez 2 comprimés de notre complément, il est en vente ici.", "retail")).not.toContain("medical_advice");
  });
});

describe("garde-fous de réponse — éducation", () => {
  it.each([
    "Votre admission est garantie si vous vous inscrivez aujourd'hui.",
    "Vous serez admis sans problème.",
    "Notre formation offre 100% de réussite.",
    "Le diplôme est assuré à la fin du cursus.",
  ])("écarte : %s", (text) => {
    expect(violations(text, "education")).toContain("admission_promise");
  });

  it("laisse passer une réponse prudente", () => {
    expect(violations("Les conditions d'admission sont confirmées par l'équipe : voulez-vous un entretien ?", "education")).toEqual([]);
  });
});
