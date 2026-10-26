import { describe, it, expect } from "vitest";
import { createMessageLibrary, DEFAULT_LIBRARY, renderGreeting, renderTemplate, validateOverrideBody, MESSAGE_KEYS, type LibraryOverride } from "./message-library";
import { DEFAULT_BRAND_VOICE, type BrandVoice } from "./brand-voice";
import { buildGreetingReply, THANKS_REPLY, GOODBYE_REPLY } from "./message-intents";

const voice = (over: Partial<BrandVoice> = {}): BrandVoice => ({ ...DEFAULT_BRAND_VOICE, ...over });
const approved = (o: Partial<LibraryOverride> & Pick<LibraryOverride, "key" | "body">): LibraryOverride => ({ register: "any", emojiLevel: "any", status: "approved", ...o });

describe("voix par défaut = comportement historique (aucune régression pour qui n'a rien configuré)", () => {
  it("accueil identique à buildGreetingReply", () => {
    for (const input of [
      { greetingWord: "Bonjour" as const, businessName: "Chez Awa", itemLabelPlural: "produits", hasHours: true, hasAddress: true, hasContact: true },
      { greetingWord: "Bonsoir" as const, businessName: null, itemLabelPlural: "services", hasHours: false, hasAddress: false, hasContact: false },
      { businessName: "Boutique", itemLabelPlural: "produits", hasHours: true, hasAddress: false, hasContact: true },
    ]) {
      expect(renderGreeting(DEFAULT_LIBRARY, input)).toBe(buildGreetingReply(input));
    }
  });

  it("merci et au revoir identiques", () => {
    expect(DEFAULT_LIBRARY.render("thanks")).toBe(THANKS_REPLY);
    expect(DEFAULT_LIBRARY.render("goodbye")).toBe(GOODBYE_REPLY);
  });

  it("chaque message existe et se rend avec ses variables", () => {
    const vars = { items: "produits", url: "https://b.example/produits", request: "à moins de 20 000 FCFA", hello: "Bonjour", welcome: "Bienvenue.", asks: "x", product: "Sac cuir", price: "15 000 FCFA", dm: "Écrivez-nous.", zone: "Douala", details: "frais de livraison : 1 500 FCFA", zones: "Douala ou Yaoundé", note: "" };
    for (const key of MESSAGE_KEYS) {
      for (const register of ["vous", "tu"] as const) {
        for (const emojiLevel of ["none", "light", "rich"] as const) {
          const text = createMessageLibrary(voice({ register, emojiLevel })).render(key, vars);
          expect(text.length > 0).toBe(true);
          expect(text).not.toContain("{");
        }
      }
    }
  });
});

describe("variantes de ton", () => {
  it("tutoiement : le message ne vouvoie pas", () => {
    const lib = createMessageLibrary(voice({ register: "tu" }));
    expect(lib.render("thanks")).toBe("Avec plaisir ! N'hésite pas si tu as d'autres questions. 😊");
    expect(lib.render("verify")).toContain("vers toi");
    expect(renderGreeting(lib, { businessName: "Awa Shop", itemLabelPlural: "produits", hasHours: true, hasAddress: true, hasContact: true })).not.toMatch(/\bvous\b|\bvos\b|\bvotre\b/);
  });

  it("niveau d'emojis : aucun / léger / riche", () => {
    expect(createMessageLibrary(voice({ emojiLevel: "none" })).render("goodbye")).toBe("Merci pour votre message, à très bientôt !");
    expect(createMessageLibrary(voice({ emojiLevel: "light" })).render("goodbye")).toBe("Merci pour votre message, à très bientôt ! 👋");
    const rich = renderGreeting(createMessageLibrary(voice({ emojiLevel: "rich" })), { businessName: null, itemLabelPlural: "produits", hasHours: false, hasAddress: false, hasContact: false });
    expect(rich).toContain("✨");
    const none = renderGreeting(createMessageLibrary(voice({ emojiLevel: "none" })), { businessName: null, itemLabelPlural: "produits", hasHours: false, hasAddress: false, hasContact: false });
    expect(none).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(none.startsWith("Bonjour ! Bienvenue.")).toBe(true);
  });
});

describe("surcharges du commerçant", () => {
  it("utilise une surcharge approuvée", () => {
    const lib = createMessageLibrary(voice(), [approved({ key: "goodbye", body: "À la prochaine chez nous !" })]);
    expect(lib.render("goodbye")).toBe("À la prochaine chez nous !");
  });

  it("ignore un brouillon (jamais de texte non validé envoyé à un client)", () => {
    const lib = createMessageLibrary(voice(), [approved({ key: "goodbye", body: "Brouillon", status: "draft" })]);
    expect(lib.render("goodbye")).toBe("Merci pour votre message, à très bientôt ! 👋");
  });

  it("préfère la surcharge la plus précise (ton exact avant « any »)", () => {
    const lib = createMessageLibrary(voice({ register: "tu" }), [
      approved({ key: "thanks", body: "Générique" }),
      approved({ key: "thanks", register: "tu", body: "De rien !" }),
      approved({ key: "thanks", register: "vous", body: "Je vous en prie." }),
    ]);
    expect(lib.render("thanks")).toBe("De rien !");
  });

  it("ignore une surcharge d'un autre ton ou d'un autre niveau d'emojis", () => {
    const lib = createMessageLibrary(voice({ register: "vous", emojiLevel: "none" }), [approved({ key: "thanks", register: "tu", body: "De rien" }), approved({ key: "thanks", emojiLevel: "rich", body: "Avec plaisir ! 😊😊" })]);
    expect(lib.render("thanks")).toBe("Avec plaisir ! N'hésitez pas si vous avez d'autres questions.");
  });

  it("une surcharge invalide en base (variable inconnue, prix en dur) retombe sur le défaut au lieu de casser", () => {
    const lib = createMessageLibrary(voice(), [approved({ key: "goodbye", body: "Merci {prenom} ! Promo à 5 000 FCFA" })]);
    expect(lib.render("goodbye")).toBe("Merci pour votre message, à très bientôt ! 👋");
  });

  it("une variable obligatoire absente au rendu retombe sur le défaut", () => {
    const lib = createMessageLibrary(voice(), [approved({ key: "see_all", body: "Tout voir ici : {url}" })]);
    expect(lib.render("see_all", { items: "produits", url: "https://b.example" })).toBe("Tout voir ici : https://b.example");
    // variable {url} non fournie par l'appelant → défaut (qui exige aussi {url}) → erreur de programmation signalée
    expect(() => lib.render("see_all", { items: "produits" })).toThrow();
  });
});

describe("validateOverrideBody", () => {
  it("accepte un texte conforme", () => {
    expect(validateOverrideBody("goodbye", "À bientôt ! {wave}")).toEqual([]);
    expect(validateOverrideBody("see_all", "Tout le catalogue : {url}")).toEqual([]);
  });

  it("refuse clé inconnue, texte vide, trop long", () => {
    expect(validateOverrideBody("inconnu", "x")).toHaveLength(1);
    expect(validateOverrideBody("goodbye", "   ")).toEqual(["texte vide"]);
    expect(validateOverrideBody("goodbye", "x".repeat(601)).length).toBeGreaterThan(0);
  });

  it("refuse variables non autorisées et variables obligatoires absentes", () => {
    expect(validateOverrideBody("goodbye", "Merci {prenom}").join(" ")).toContain("{prenom}");
    expect(validateOverrideBody("see_all", "Voir le catalogue").join(" ")).toContain("{url}");
  });

  it("refuse ce qui change ou engage : montant, gratuité, numéro, email, lien en dur", () => {
    expect(validateOverrideBody("goodbye", "Livraison 2 000 FCFA").length).toBeGreaterThan(0);
    expect(validateOverrideBody("goodbye", "Livraison gratuite").length).toBeGreaterThan(0);
    expect(validateOverrideBody("goodbye", "Appelez le 699 12 34 56").length).toBeGreaterThan(0);
    expect(validateOverrideBody("goodbye", "Écrivez à a@b.cm").length).toBeGreaterThan(0);
    expect(validateOverrideBody("goodbye", "Voir https://x.cm").length).toBeGreaterThan(0);
  });

  it("refuse un texte incohérent avec le ton annoncé", () => {
    expect(validateOverrideBody("thanks", "Tu peux revenir quand tu veux", { register: "vous" }).join(" ")).toContain("tutoie");
    expect(validateOverrideBody("thanks", "Vous pouvez revenir", { register: "tu" }).join(" ")).toContain("vouvoie");
    expect(validateOverrideBody("thanks", "Merci 😊😊😊", { emojiLevel: "light" }).join(" ")).toContain("emojis");
  });
});

describe("renderTemplate", () => {
  it("variable manquante → null (jamais « {x} » envoyé à un client)", () => {
    expect(renderTemplate("Bonjour {nom}", {}, "light")).toBeNull();
    expect(renderTemplate("Bonjour {nom}", { nom: "Awa" }, "light")).toBe("Bonjour Awa");
  });
});
