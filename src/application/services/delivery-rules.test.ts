import { describe, it, expect } from "vitest";
import { parseZoneInput, detectDeliveryQuestion, matchZones, describeFee, zoneDetails, zoneLine, answerDeliveryQuestion, buildDeliveryFacts, buildDeliveryRules, zoneSlug, EMPTY_DELIVERY_RULES, EMPTY_DELIVERY_SETTINGS, type DeliveryZone, type DeliverySettings } from "./delivery-rules";
import { DEFAULT_LIBRARY, createMessageLibrary } from "./message-library";
import { DEFAULT_BRAND_VOICE } from "./brand-voice";

const flat = (t: string | null) => (t ?? "").replace(/[\u202f\u00a0]/g, " ");
const zone = (over: Partial<DeliveryZone> = {}): DeliveryZone => ({ name: "Douala", slug: "douala", aliases: [], feeAmount: 1500, isFree: false, freeAboveAmount: null, etaText: "24 à 48 h", ...over });
const rules = (zones: DeliveryZone[], settings: Partial<DeliverySettings> = {}) => buildDeliveryRules(zones, { ...EMPTY_DELIVERY_SETTINGS, ...settings });
const answer = (message: string, r = rules([zone(), zone({ name: "Yaoundé", slug: "yaounde", aliases: ["Yaoundé centre", "Yde"], feeAmount: 2000, etaText: "48 h" })])) => answerDeliveryQuestion(message, r, DEFAULT_LIBRARY);

describe("parseZoneInput", () => {
  it("accepte une zone complète et en dérive l'identifiant", () => {
    const r = parseZoneInput({ name: "  Yaoundé  ", aliases: ["Yde", "yde", "Yaoundé"], feeAmount: "2 000", freeAboveAmount: 25000, etaText: "48 h" });
    expect(r).toMatchObject({ ok: true, zone: { name: "Yaoundé", slug: "yaounde", aliases: ["Yde"], feeAmount: 2000, freeAboveAmount: 25000, etaText: "48 h", isFree: false, isActive: true } });
  });

  it("une zone gratuite n'a pas de frais ; gratuite + frais est refusé", () => {
    expect(parseZoneInput({ name: "Akwa", isFree: true })).toMatchObject({ ok: true, zone: { isFree: true, feeAmount: null } });
    expect(parseZoneInput({ name: "Akwa", isFree: true, feeAmount: 500 })).toMatchObject({ ok: false });
    expect(parseZoneInput({ name: "Akwa", isFree: true, feeAmount: 0 })).toMatchObject({ ok: true });
  });

  it("refuse (au lieu de deviner) nom vide, montants négatifs ou absurdes, délai ou alias trop longs", () => {
    expect(parseZoneInput({})).toMatchObject({ ok: false });
    expect(parseZoneInput({ name: "A", feeAmount: -1 })).toMatchObject({ ok: false });
    expect(parseZoneInput({ name: "A", feeAmount: "beaucoup" })).toMatchObject({ ok: false });
    expect(parseZoneInput({ name: "A", freeAboveAmount: 0 })).toMatchObject({ ok: false });
    expect(parseZoneInput({ name: "A", etaText: "x".repeat(81) })).toMatchObject({ ok: false });
    expect(parseZoneInput({ name: "A", aliases: ["x".repeat(41)] })).toMatchObject({ ok: false });
    expect(parseZoneInput({ name: "A", aliases: Array.from({ length: 11 }, (_, i) => `a${i}`) })).toMatchObject({ ok: false });
    expect(parseZoneInput("Douala")).toMatchObject({ ok: false });
  });

  it("frais « à communiquer » : zone sans frais ni gratuité est valide", () => {
    expect(parseZoneInput({ name: "Kribi" })).toMatchObject({ ok: true, zone: { feeAmount: null, isFree: false } });
  });

  it("identifiant stable sans accents ni espaces", () => {
    expect(zoneSlug("Bonamoussadi Nord")).toBe("bonamoussadi-nord");
    expect(zoneSlug("Yaoundé")).toBe("yaounde");
  });
});

describe("detectDeliveryQuestion", () => {
  it.each([
    ["Vous livrez à Douala ?", { delivery: true, pickup: false, cashOnDelivery: false }],
    ["Quels sont les frais de livraison ?", { delivery: true, pickup: false, cashOnDelivery: false }],
    ["Expédiez-vous à Bafoussam ?", { delivery: true, pickup: false, cashOnDelivery: false }],
    ["Do you deliver to Yaoundé?", { delivery: true, pickup: false, cashOnDelivery: false }],
    ["Je peux venir chercher sur place ?", { delivery: false, pickup: true, cashOnDelivery: false }],
    ["Retrait en boutique possible ?", { delivery: false, pickup: true, cashOnDelivery: false }],
    ["Je peux payer à la livraison ?", { delivery: false, pickup: false, cashOnDelivery: true }],
    ["Paiement à la livraison accepté ?", { delivery: false, pickup: false, cashOnDelivery: true }],
    ["Vous livrez et je paie à la livraison ?", { delivery: true, pickup: false, cashOnDelivery: true }],
  ])("%s", (message, expected) => {
    expect(detectDeliveryQuestion(message)).toMatchObject(expected);
  });

  it.each([
    "Merci pour la livraison, au revoir",
    "Merci pour la livraison rapide !",
    "Ma livraison est arrivée, merci",
    "Quand ma livraison arrive ?",
    "Où est mon colis ?",
    "Ma commande est livrée quand ?",
  ])("remerciement ou suivi de SA commande : pas une question sur les zones — %s", (message) => {
    expect(detectDeliveryQuestion(message).any).toBe(false);
  });

  it("un remerciement suivi d'une vraie question reste une question", () => {
    expect(detectDeliveryQuestion("Merci ! Vous livrez à Douala ?").delivery).toBe(true);
  });

  it("ne se déclenche pas sur une question sans rapport", () => {
    expect(detectDeliveryQuestion("Quel est le prix du sac ?").any).toBe(false);
    expect(detectDeliveryQuestion("Bonjour").any).toBe(false);
  });
});

describe("matchZones", () => {
  const zones = [zone(), zone({ name: "Yaoundé", slug: "yaounde", aliases: ["Yaoundé centre", "Yde"] }), zone({ name: "Douala Bonamoussadi", slug: "douala-bonamoussadi" })];
  it("trouve une zone par son nom, sans accents ni casse, en mot entier", () => {
    expect(matchZones("Vous livrez à yaounde ?", zones).map((z) => z.slug)).toEqual(["yaounde"]);
    expect(matchZones("Livraison à DOUALA", zones).map((z) => z.slug)).toEqual(["douala"]);
  });
  it("trouve par alias", () => {
    expect(matchZones("Et à Yde ?", zones).map((z) => z.slug)).toEqual(["yaounde"]);
  });
  it("la correspondance la plus précise passe d'abord", () => {
    expect(matchZones("Livraison à Douala Bonamoussadi ?", zones)[0]!.slug).toBe("douala-bonamoussadi");
  });
  it("pas de faux positif sur un mot qui contient le nom", () => {
    expect(matchZones("Vous livrez à Doualaland ?", zones)).toEqual([]);
  });
});

describe("describeFee / zoneDetails — uniquement ce que le commerçant a renseigné", () => {
  it("couvre chaque cas", () => {
    expect(flat(describeFee(zone()))).toBe("frais de livraison : 1 500 FCFA");
    expect(describeFee(zone({ isFree: true, feeAmount: null }))).toBe("livraison gratuite");
    expect(flat(describeFee(zone({ freeAboveAmount: 25000 })))).toBe("frais de livraison : 1 500 FCFA, gratuite dès 25 000 FCFA d'achat");
    expect(flat(describeFee(zone({ feeAmount: null, freeAboveAmount: 25000 })))).toBe("livraison gratuite dès 25 000 FCFA d'achat, sinon frais communiqués à la commande");
    expect(describeFee(zone({ feeAmount: null }))).toBe("frais communiqués à la commande");
  });
  it("délai ajouté s'il est renseigné", () => {
    expect(flat(zoneDetails(zone()))).toBe("frais de livraison : 1 500 FCFA, délai : 24 à 48 h");
    expect(flat(zoneLine(zone({ etaText: null })))).toBe("Douala : frais de livraison : 1 500 FCFA");
  });
});

describe("answerDeliveryQuestion — réponses déterministes", () => {
  it("zone desservie : frais et délai de la base", () => {
    expect(flat(answer("Vous livrez à Douala ?"))).toBe("Oui, nous livrons à Douala : frais de livraison : 1 500 FCFA, délai : 24 à 48 h.");
  });

  it("alias reconnu ; deux zones citées = deux réponses", () => {
    expect(flat(answer("Livrez-vous à Yde ?"))).toContain("Oui, nous livrons à Yaoundé");
    expect(answer("Livraison à Douala et à Yaoundé ?")?.split("\n")).toHaveLength(2);
  });

  it("zone inconnue ou question générale : liste des zones servies, sans prétendre savoir pour la zone demandée", () => {
    expect(answer("Vous livrez à Kribi ?")).toBe("Nous livrons à : Douala ou Yaoundé. Pour une autre zone, écrivez-nous et nous vérifions.");
    expect(answer("Livrez-vous ?")).toContain("Nous livrons à : Douala ou Yaoundé");
  });

  it("retrait et paiement à la livraison : seulement si renseignés, oui comme non", () => {
    const r = rules([zone()], { pickupAvailable: true, pickupNote: "Du lundi au samedi à Akwa.", acceptsCashOnDelivery: false });
    expect(answer("Retrait en boutique possible ?", r)).toBe("Oui, le retrait est possible. Du lundi au samedi à Akwa.");
    expect(answer("Je peux payer à la livraison ?", r)).toBe("Nous n'acceptons pas le paiement à la livraison.");
    expect(answer("Retrait possible ?", rules([zone()], { pickupAvailable: false }))).toBe("Nous ne proposons pas de retrait pour le moment.");
  });

  it("jamais de oui/non sur ce qui n'est pas renseigné : null (l'étape suivante prend le relais)", () => {
    expect(answer("Je peux payer à la livraison ?", rules([zone()]))).toBeNull();
    expect(answer("Retrait possible ?", rules([zone()]))).toBeNull();
    expect(answer("Livrez-vous à Douala ?", rules([], { pickupAvailable: true }))).toBeNull(); // aucune zone
  });

  it("question mixte : répond à tout ou à rien", () => {
    const r = rules([zone()], { acceptsCashOnDelivery: true });
    expect(answer("Vous livrez à Douala et je paie à la livraison ?", r)?.split("\n")).toHaveLength(2);
    expect(answer("Vous livrez à Douala et retrait possible ?", r)).toBeNull(); // retrait non renseigné
  });

  it("relance sans mot de livraison (« Et à Yde ? ») : pas de réponse déterministe, l'étape suivante a le contexte", () => {
    expect(answer("Et à Yde ?")).toBeNull();
  });

  it("commerçant sans aucune règle, ou question sans rapport : null", () => {
    expect(answerDeliveryQuestion("Vous livrez ?", EMPTY_DELIVERY_RULES, DEFAULT_LIBRARY)).toBeNull();
    expect(answer("Quel est le prix du sac ?")).toBeNull();
  });

  it("suit la voix de marque", () => {
    const library = createMessageLibrary({ ...DEFAULT_BRAND_VOICE, register: "tu" });
    expect(answerDeliveryQuestion("Je peux payer à la livraison ?", rules([zone()], { acceptsCashOnDelivery: true }), library)).toBe("Oui, tu peux payer à la livraison.");
    expect(answerDeliveryQuestion("Livrez-vous à Kribi ?", rules([zone()]), library)).toContain("écris-nous");
  });
});

describe("buildDeliveryFacts", () => {
  it("lignes de faits, montants autorisés et gratuité autorisée seulement si fondée", () => {
    const facts = buildDeliveryFacts(rules([zone({ freeAboveAmount: 25000 })], { pickupAvailable: true, acceptsCashOnDelivery: false }));
    expect(facts.allowedAmounts).toEqual([1500, 25000]);
    expect(facts.allowFree).toBe(true);
    expect(flat(facts.lines.join("\n"))).toContain("Livraison Douala : frais de livraison : 1 500 FCFA, gratuite dès 25 000 FCFA d'achat, délai : 24 à 48 h");
    expect(facts.lines).toContain("- Retrait possible.");
    expect(facts.lines).toContain("- Paiement à la livraison non accepté.");
  });
  it("aucune gratuité réelle : « gratuit » reste refusé", () => {
    expect(buildDeliveryFacts(rules([zone()])).allowFree).toBe(false);
  });
  it("non renseigné : rien d'affirmé", () => {
    expect(buildDeliveryFacts(EMPTY_DELIVERY_RULES)).toEqual({ lines: [], allowedAmounts: [], allowFree: false });
  });
});
