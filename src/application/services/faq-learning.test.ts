import { describe, it, expect } from "vitest";
import { questionTokens, areSimilar, clusterQuestions, countSimilar, clampThreshold, redactQuestion, suggestKeywords, checkFaqTemplate, renderFaqAnswer, extractFaqVariables, suggestAnswerFrom, creditsSaved, type LoggedQuestion } from "./faq-learning";

const q = (question: string, over: Partial<LoggedQuestion> = {}): LoggedQuestion => ({ question, tokens: questionTokens(question), resolution: "ai", suggestedAnswer: null, createdAt: "2026-10-01T10:00:00.000Z", ...over });

describe("questionTokens", () => {
  it("garde les sujets de FAQ (livraison, horaires, adresse) et retire politesse et mots vides", () => {
    expect(questionTokens("Bonjour, vous livrez à Douala ?")).toEqual(["douala", "livrez"]);
    expect(questionTokens("Quels sont vos horaires d'ouverture ?")).toEqual(["horaire", "ouverture"]);
    expect(questionTokens("Où est votre adresse svp")).toEqual(["adresse"]);
  });
  it("ignore les nombres et normalise accents et casse", () => {
    expect(questionTokens("Paiement à la LIVRAISON possible ? 12345")).toEqual(["livraison", "paiement", "possible"]);
  });
});

describe("areSimilar — la même question reformulée", () => {
  it.each([
    ["Vous livrez à Douala ?", "Livraison possible sur Douala ?"],
    ["Quels sont vos horaires ?", "Vos horaires d'ouverture svp"],
    ["Acceptez-vous le paiement mobile money ?", "Paiement par mobile money possible ?"],
  ])("%s ~ %s", (a, b) => {
    expect(areSimilar(questionTokens(a), questionTokens(b))).toBe(true);
  });

  it.each([
    ["Vous livrez à Douala ?", "Quels sont vos horaires ?"],
    ["Vous livrez à Douala ?", "Vous livrez à Yaoundé ?"],
    ["Paiement mobile money ?", "Paiement à la livraison ?"],
  ])("%s ≠ %s", (a, b) => {
    expect(areSimilar(questionTokens(a), questionTokens(b))).toBe(false);
  });

  it("jamais similaire à une question sans mot significatif", () => {
    expect(areSimilar([], ["livraison"])).toBe(false);
  });
});

describe("clusterQuestions / countSimilar", () => {
  const log = [
    q("Vous livrez à Douala ?", { createdAt: "2026-10-01T08:00:00.000Z" }),
    q("Quels sont vos horaires ?", { createdAt: "2026-10-01T09:00:00.000Z" }),
    q("Livraison possible sur Douala ?", { createdAt: "2026-10-02T08:00:00.000Z" }),
    q("Livrez-vous sur Douala ?", { createdAt: "2026-10-03T08:00:00.000Z" }),
    q("Vos horaires d'ouverture svp", { createdAt: "2026-10-03T09:00:00.000Z" }),
  ];

  it("regroupe les reformulations et sépare les sujets", () => {
    const clusters = clusterQuestions(log).sort((a, b) => b.members.length - a.members.length);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.members).toHaveLength(3);
    expect(clusters[0]!.signature).toContain("douala");
    expect(clusters[1]!.members).toHaveLength(2);
    expect(clusters[1]!.signature).toContain("horaire");
  });

  it("countSimilar compte les occurrences d'une question dans la semaine", () => {
    expect(countSimilar(questionTokens("Livraison à Douala possible ?"), log)).toBe(3);
    expect(countSimilar(questionTokens("Garantie sur les produits ?"), log)).toBe(0);
  });

  it("la question représentative appartient au groupe", () => {
    const cluster = clusterQuestions(log).find((c) => c.signature.includes("douala"))!;
    expect(cluster.members).toContain(cluster.representative);
  });
});

describe("seuil, minimisation, mots-clés", () => {
  it("borne le seuil hebdomadaire (2 à 50)", () => {
    expect(clampThreshold(1)).toBe(2);
    expect(clampThreshold(999)).toBe(50);
    expect(clampThreshold(Number.NaN)).toBe(3);
    expect(clampThreshold(5.9)).toBe(5);
  });

  it("retire emails, numéros et liens des questions enregistrées et borne la longueur", () => {
    expect(redactQuestion("Appelez-moi au 699 12 34 56 ou awa@mail.cm")).toBe("Appelez-moi au [numéro] ou [email]");
    expect(redactQuestion("x".repeat(500))).toHaveLength(200);
  });

  it("propose UN mot-clé composé des mots les plus parlants (tous doivent apparaître)", () => {
    expect(suggestKeywords(["douala", "livraison"])).toEqual(["douala livraison"]);
    expect(suggestKeywords([])).toEqual([]);
  });
});

describe("variables dynamiques", () => {
  it("extrait les variables", () => {
    expect(extractFaqVariables("Ouvert : {hours}. Prix : {price:sac-cuir}. {hours}")).toEqual(["hours", "price:sac-cuir"]);
  });

  it("refuse une variable inconnue, avertit sur un montant écrit en dur (sans bloquer)", () => {
    expect(checkFaqTemplate("Voir {prix_du_jour}").errors).toHaveLength(1);
    expect(checkFaqTemplate("Voir {price:Sac Cuir}").errors).toHaveLength(1);
    expect(checkFaqTemplate("Ouvert : {hours} — contact : {contact}")).toEqual({ errors: [], warnings: [] });
    const frozen = checkFaqTemplate("La livraison coûte 1 500 FCFA");
    expect(frozen.errors).toEqual([]);
    expect(frozen.warnings).toHaveLength(1);
  });

  it("variables de livraison : {delivery_zones} et {delivery:zone}", () => {
    expect(checkFaqTemplate("Nous livrons à {delivery_zones}. Douala : {delivery:douala}")).toEqual({ errors: [], warnings: [] });
    expect(checkFaqTemplate("{delivery:Douala Centre}").errors).toHaveLength(1);
    expect(extractFaqVariables("{delivery:douala} {delivery_zones}")).toEqual(["delivery:douala", "delivery_zones"]);
  });

  it("rend les variables ; une valeur introuvable → null (la FAQ n'est pas utilisée plutôt que périmée)", () => {
    expect(renderFaqAnswer("Ouvert : {hours}", { hours: "lundi 9h-18h" })).toBe("Ouvert : lundi 9h-18h");
    expect(renderFaqAnswer("Ouvert : {hours}", { hours: null })).toBeNull();
    expect(renderFaqAnswer("Pas de variable", {})).toBe("Pas de variable");
  });
});

describe("suggestAnswerFrom", () => {
  const catalog = "https://b.example/produits";
  it("garde une réponse sans donnée périssable et transforme le lien catalogue en variable", () => {
    expect(suggestAnswerFrom("Oui, nous livrons à Douala. Voir le catalogue : https://b.example/produits", catalog)).toBe("Oui, nous livrons à Douala. Voir le catalogue : {catalog_url}");
  });
  it("rejette montant, numéro, email, autre lien, stock, texte trop court ou trop long", () => {
    for (const reply of [
      "La livraison coûte 1 500 FCFA à Douala.",
      "Appelez le 699 12 34 56 pour la livraison.",
      "Écrivez à contact@b.example pour la livraison.",
      "Voir https://b.example/produits/sac pour la livraison.",
      "Il reste 3 articles, livraison possible.",
      "Oui.",
      "x ".repeat(400),
    ]) {
      expect(suggestAnswerFrom(reply, catalog)).toBeNull();
    }
  });
});

describe("économies", () => {
  it("un crédit économisé par FAQ servie", () => {
    expect(creditsSaved(42)).toBe(42);
    expect(creditsSaved(-3)).toBe(0);
  });
});
