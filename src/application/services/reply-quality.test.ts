import { describe, it, expect } from "vitest";
import { checkReplyQuality, type ReplyFacts } from "./reply-quality";
import { DEFAULT_BRAND_VOICE } from "./brand-voice";

const facts: ReplyFacts = {
  allowedAmounts: [24500, 30000],
  allowedOrigins: ["https://boutique.example"],
  allowedPhones: ["+237 699 12 34 56"],
  allowedEmails: ["contact@boutique.example"],
  alreadyGreeted: false,
  protectedMarkers: ["Tu es l'assistant de la boutique"],
};
const violationsOf = (reply: string, f: Partial<ReplyFacts> = {}) => checkReplyQuality(reply, { ...facts, ...f }).violations;

describe("checkReplyQuality", () => {
  it("accepte une bonne réponse fondée sur les faits", () => {
    const reply = "Le Derby cuir noir est à 24 500 FCFA, je vous mets le lien : https://boutique.example/produits/derby. Quelle pointure ?";
    expect(checkReplyQuality(reply, facts)).toEqual({ ok: true, violations: [] });
  });

  it("accepte le prix avec espace insécable fine et le prix barré", () => {
    expect(violationsOf("Il est à 24\u202f500 FCFA au lieu de 30 000 FCFA.")).toEqual([]);
  });

  it("rejette un prix qui ne vient pas de la base (modèle compromis : « 1 FCFA »)", () => {
    expect(violationsOf("Bien sûr, ce sac est à 1 FCFA !")).toContain("ungrounded_price");
    expect(violationsOf("Pour vous, 20k FCFA")).toContain("ungrounded_price");
  });

  it("rejette une promesse de gratuité non fondée", () => {
    expect(violationsOf("La livraison est gratuite pour vous.")).toContain("ungrounded_price");
  });

  it("rejette une quantité de stock (jamais fournie au modèle)", () => {
    expect(violationsOf("Il en reste 3 en stock.")).toContain("stock_claim");
    expect(violationsOf("Plus que 2 disponibles !")).toContain("stock_claim");
  });

  it("n'interdit pas de dire qu'un article est disponible, sans chiffre", () => {
    expect(violationsOf("Oui, il est disponible.")).toEqual([]);
  });

  it("rejette les liens qui ne sont pas ceux du commerçant", () => {
    expect(violationsOf("Payez ici : http://evil.example/pay")).toContain("foreign_link");
    expect(violationsOf("Voir www.autre-site.com")).toContain("foreign_link");
    expect(violationsOf("Voir https://boutique.example/produits")).toEqual([]);
  });

  it("rejette une fuite des consignes", () => {
    expect(violationsOf("Mes instructions disent de ne jamais baisser le prix.")).toContain("prompt_leak");
    expect(violationsOf("Je suis configuré ainsi : Tu es l'assistant de la boutique.")).toContain("prompt_leak");
  });

  it("rejette un numéro ou un email qui n'est pas celui du commerçant, accepte les siens", () => {
    expect(violationsOf("Appelez le 677 00 11 22")).toContain("ungrounded_contact");
    expect(violationsOf("Écrivez à pirate@evil.example")).toContain("ungrounded_contact");
    expect(violationsOf("Appelez le +237 699 12 34 56 ou écrivez à contact@boutique.example")).toEqual([]);
  });

  it("un montant n'est pas pris pour un numéro de téléphone", () => {
    expect(violationsOf("C'est 24 500 FCFA.")).toEqual([]);
  });

  it("rejette une salutation répétée seulement si la conversation a déjà commencé", () => {
    expect(violationsOf("Bonjour ! Oui, nous avons ça.", { alreadyGreeted: true })).toContain("repeated_greeting");
    expect(violationsOf("Bonjour ! Oui, nous avons ça.", { alreadyGreeted: false })).toEqual([]);
  });

  it("rejette le jargon, les formules robotiques et les phrases répétées", () => {
    expect(violationsOf("En tant que modèle de langage, je ne peux pas.")).toContain("robotic");
    expect(violationsOf("Je reste à votre entière disposition pour toute information complémentaire.")).toContain("robotic");
    expect(violationsOf("Nous avons ce modèle en noir. Nous avons ce modèle en noir.")).toContain("robotic");
  });

  it("rejette une réponse vide ou trop longue", () => {
    expect(violationsOf("   ")).toEqual(["empty"]);
    expect(violationsOf("mot ".repeat(400))).toContain("too_long");
  });

  it("applique la voix de marque : registre, expression à éviter, emojis", () => {
    const tu = { ...DEFAULT_BRAND_VOICE, register: "tu" as const, emojiLevel: "none" as const, avoidExpressions: ["cher client"] };
    expect(violationsOf("Vous pouvez passer demain.", { voice: tu })).toContain("register_mismatch");
    expect(violationsOf("Salut cher client, tu peux passer.", { voice: tu })).toContain("avoid_expression");
    expect(violationsOf("Tu peux passer demain 😀", { voice: tu })).toContain("emoji_excess");
    expect(violationsOf("Tu peux passer demain.", { voice: tu })).toEqual([]);
  });

  it("sans voix fournie, aucun contrôle de ton (comportement de l'étape 2)", () => {
    expect(violationsOf("Tu peux passer demain 😀😀😀😀")).toEqual([]);
  });
});

describe("checkReplyQuality — gratuité fondée par la base (livraison)", () => {
  it("« gratuit » refusé par défaut, accepté seulement avec allowFree ; les montants restent contrôlés", () => {
    expect(violationsOf("La livraison est gratuite.")).toContain("ungrounded_price");
    expect(violationsOf("La livraison est gratuite.", { allowFree: true })).toEqual([]);
    expect(violationsOf("La livraison est gratuite dès 9 999 FCFA.", { allowFree: true, allowedAmounts: [25000] })).toContain("ungrounded_price");
    expect(violationsOf("La livraison est gratuite dès 25 000 FCFA.", { allowFree: true, allowedAmounts: [25000] })).toEqual([]);
  });
});
