import { describe, it, expect } from "vitest";
import { classifyComment, planPreRouting, planPostRouting, formatCommentPrice, supportsHide, DEFAULT_COMMENT_SETTINGS, FAIL_SAFE_COMMENT_SETTINGS, PUBLIC_SHORT_LIMIT, type CommentAssistantSettings, type CommentProduct } from "./comment-assistant";
import { DEFAULT_LIBRARY, createMessageLibrary, MESSAGE_KEYS } from "./message-library";
import { DEFAULT_BRAND_VOICE } from "./brand-voice";

const kindOf = (text: string) => classifyComment(text).kind;
const flat = (t: string) => t.replace(/[\u202f\u00a0]/g, " ");
const settings = (over: Partial<CommentAssistantSettings> = {}): CommentAssistantSettings => ({ ...DEFAULT_COMMENT_SETTINGS, ...over });
const product: CommentProduct = { id: "p1", name: "Sac cuir", slug: "sac-cuir", unitPrice: 15000, compareAtPrice: null, isPromo: false };

describe("classifyComment — spam", () => {
  it.each([
    "Vous avez gagné à la loterie, cliquez ici pour réclamer",
    "Gagnez 500 000 FCFA par jour avec le forex",
    "Travail à domicile, contactez-moi sur Telegram",
    "Followers gratuits ici http://spam.example",
    "Rejoignez 1xbet maintenant",
    "Recovering your account: click here http://evil.example/login",
    "Check my profile www.promo-top.xyz ✨✨✨",
  ])("spam : %s", (text) => {
    expect(kindOf(text)).toBe("spam");
  });

  it("deux signaux faibles = spam ; un lien seul = suspect (jamais masqué)", () => {
    expect(kindOf("dm me pour une offre http://x.example")).toBe("spam");
    expect(kindOf("regardez ça https://monsite.example/sac")).toBe("spam_suspected");
  });

  it.each([
    "Combien coûte ce sac ?",
    "Je veux commander, appelez-moi au 699 12 34 56",
    "Bon investissement ce sac, je recommande",
    "Quelqu'un peut me dire si c'est disponible en 42 ?",
    "J'adore ❤️❤️",
    "Livrez-vous à Douala ?",
    "Bonjour, quel est votre numéro WhatsApp ?",
    "C'est cher, mais très beau",
  ])("ne classe pas en spam un client réel : %s", (text) => {
    expect(["spam", "spam_suspected"]).not.toContain(kindOf(text));
  });

  it("une rafale d'emojis seule est suspecte (ignorée) mais JAMAIS considérée comme du spam à masquer", () => {
    const flood = classifyComment("😍😍😍😍😍😍😍😍😍😍");
    expect(flood.kind).toBe("spam_suspected");
    expect(flood.signals).toContain("emoji_flood");
  });

  it("repère les majuscules criées et les caractères répétés (signaux faibles)", () => {
    expect(classifyComment("ACHETEZ MAINTENANT TOUT EST GRATUIT").signals).toContain("shouting");
    expect(classifyComment("aaaaaaaaaaaa!!!!!!!!!!").signals).toContain("repeated_characters");
  });
});

describe("classifyComment — intentions", () => {
  it.each([
    "Je veux ce sac",
    "Je le prends !",
    "Comment commander ?",
    "Où acheter ça ?",
    "Je suis intéressée",
    "Appelez-moi svp",
    "I want to buy this",
  ])("intention d'achat : %s", (text) => {
    expect(kindOf(text)).toBe("strong_intent");
  });

  it("une négation n'est pas une intention (« je ne veux pas »)", () => {
    expect(kindOf("Je ne veux plus de ce modèle")).not.toBe("strong_intent");
    expect(kindOf("Pas intéressé merci")).not.toBe("strong_intent");
  });

  it.each(["Quel est le prix ?", "C'est combien ?", "Dispo en 42 ?", "How much?", "Il reste de la taille M ?"])("prix ou disponibilité : %s", (text) => {
    expect(kindOf(text)).toBe("price_or_availability");
  });

  it("l'intention explicite l'emporte sur la simple question de prix", () => {
    expect(kindOf("C'est combien ? Je le prends")).toBe("strong_intent");
  });

  it.each(["Magnifique !", "Trop beau 😍", "J'adore ce modèle", "Bravo pour la collection"])("compliment : %s", (text) => {
    expect(kindOf(text)).toBe("praise");
  });

  it("un compliment qui pose une question n'est pas un simple compliment", () => {
    expect(kindOf("Magnifique, c'est combien ?")).toBe("price_or_availability");
    expect(kindOf("Beau, vous livrez ?")).not.toBe("praise");
  });

  it("ne renvoie jamais le contenu du commentaire dans les signaux (minimisation)", () => {
    const { signals } = classifyComment("Je veux commander, appelez-moi au 699123456");
    expect(signals.join(" ")).not.toContain("699123456");
  });
});

describe("planPreRouting", () => {
  const plan = (text: string, over: { settings?: Partial<CommentAssistantSettings>; product?: CommentProduct | null; platform?: string; library?: typeof DEFAULT_LIBRARY } = {}) =>
    planPreRouting({ classification: classifyComment(text), settings: settings(over.settings), product: over.product === undefined ? product : over.product, platform: over.platform ?? "facebook", library: over.library ?? DEFAULT_LIBRARY });

  it("spam : jamais de réponse ; masqué seulement si le commerçant l'a activé ET le réseau le permet", () => {
    const spam = "Gagnez 500 000 FCFA par jour avec le forex";
    expect(plan(spam)).toEqual({ type: "ignore_spam", moderation: "spam", hide: false });
    expect(plan(spam, { settings: { hideSpam: true } })).toMatchObject({ hide: true });
    expect(plan(spam, { settings: { hideSpam: true }, platform: "tiktok" })).toMatchObject({ hide: false }); // masquage non confirmé sur TikTok
  });

  it("lien seul (suspect) : ignoré mais jamais masqué", () => {
    expect(plan("regardez ça https://monsite.example/sac", { settings: { hideSpam: true } })).toEqual({ type: "ignore_spam", moderation: "spam_suspected", hide: false });
  });

  it("compliment : ignoré par défaut, remercié si activé", () => {
    expect(plan("Magnifique !")).toEqual({ type: "ignore_praise" });
    expect(plan("Magnifique !", { settings: { replyToPraise: true } })).toMatchObject({ type: "reply", text: "Merci beaucoup pour votre message ! 😊" });
  });

  it("prix demandé sous une publication avec produit : réponse courte avec le prix de la base et l'invitation en message privé", () => {
    const action = plan("Quel est le prix ?");
    expect(action).toMatchObject({ type: "reply", intent: "comment_price", createLead: false });
    expect(flat((action as { text: string }).text)).toBe("Le Sac cuir est à 15 000 FCFA. Écrivez-nous en message privé pour commander.");
  });

  it("promotion en cours : prix barré affiché ; promotion expirée : jamais", () => {
    const promo = { ...product, compareAtPrice: 20000, isPromo: true };
    expect(flat((plan("Quel est le prix ?", { product: promo }) as { text: string }).text)).toContain("15 000 FCFA (au lieu de 20 000 FCFA)");
    expect(flat((plan("Quel est le prix ?", { product: { ...promo, isPromo: false } }) as { text: string }).text)).not.toContain("au lieu de");
  });

  it("prix demandé sans produit connu : on laisse l'orchestrateur répondre (FAQ, catalogue…)", () => {
    expect(plan("Quel est le prix ?", { product: null })).toEqual({ type: "route", createLead: false });
    expect(plan("Quel est le prix ?", { settings: { usePostProduct: false } })).toEqual({ type: "route", createLead: false });
  });

  it("intention d'achat : réponse courte + lead seulement si le commerçant l'a activé", () => {
    const action = plan("Je le prends !", { settings: { createLeads: true } });
    expect(action).toMatchObject({ type: "reply", intent: "comment_intent", createLead: true });
    expect(flat((action as { text: string }).text)).toBe("Merci pour votre intérêt ! Le Sac cuir est à 15 000 FCFA. Écrivez-nous en message privé pour commander.");
    expect(plan("Je le prends !")).toMatchObject({ createLead: false });
  });

  it("intention d'achat sans produit : invitation générique, ou « nous revenons vers vous » si les messages privés sont désactivés", () => {
    expect((plan("Je le prends !", { product: null }) as { text: string }).text).toBe("Merci pour votre intérêt ! Écrivez-nous en message privé pour commander.");
    expect((plan("Je le prends !", { product: null, settings: { inviteToDm: false } }) as { text: string }).text).toBe("Merci pour votre intérêt ! Nous revenons vers vous très vite.");
  });

  it("la voix de marque s'applique (tutoiement, sans emoji)", () => {
    const library = createMessageLibrary({ ...DEFAULT_BRAND_VOICE, register: "tu", emojiLevel: "none" });
    expect((plan("Je le prends !", { product: null, library }) as { text: string }).text).toBe("Merci pour ton intérêt ! Écris-nous en message privé pour commander.");
    expect(plan("Magnifique !", { settings: { replyToPraise: true }, library })).toMatchObject({ text: "Merci beaucoup pour ton message !" });
  });

  it("autre commentaire : orchestrateur", () => {
    expect(plan("Livrez-vous à Douala ?")).toEqual({ type: "route", createLead: false });
  });

  it("réglages de repli (lecture en échec) : aucun comportement nouveau", () => {
    const failSafe = planPreRouting({ classification: classifyComment("Quel est le prix ?"), settings: FAIL_SAFE_COMMENT_SETTINGS, product, platform: "facebook", library: DEFAULT_LIBRARY });
    expect(failSafe).toEqual({ type: "route", createLead: false });
  });
});

describe("planPostRouting", () => {
  const post = (routing: { replyText: string | null; handoffReason: string | null }, over: Partial<CommentAssistantSettings> = {}) => planPostRouting({ routing, settings: settings(over), library: DEFAULT_LIBRARY });

  it("réponse courte : publiée telle quelle", () => {
    expect(post({ replyText: "Oui, nous livrons à Douala.", handoffReason: null })).toEqual({ type: "reply", text: "Oui, nous livrons à Douala.", shortened: false });
  });

  it("réponse trop longue pour un fil public : invitation en message privé", () => {
    const out = post({ replyText: "x ".repeat(PUBLIC_SHORT_LIMIT), handoffReason: null });
    expect(out).toMatchObject({ type: "reply", shortened: true });
    expect((out as { text: string }).text).toContain("message privé");
  });

  it("réponse longue conservée si l'invitation est désactivée (comportement d'avant)", () => {
    expect(post({ replyText: "x ".repeat(PUBLIC_SHORT_LIMIT), handoffReason: null }, { inviteToDm: false })).toMatchObject({ shortened: false });
  });

  it("plainte / remboursement : escalade ; accusé public seulement si activé", () => {
    expect(post({ replyText: null, handoffReason: "complaint" })).toEqual({ type: "escalate", publicAck: null });
    expect(post({ replyText: null, handoffReason: "complaint" }, { complaintPublicAck: true })).toMatchObject({ publicAck: expect.stringContaining("message privé") });
    expect(post({ replyText: null, handoffReason: "refund_request" }, { complaintPublicAck: true })).toMatchObject({ publicAck: expect.any(String) });
  });

  it("autres escalades (information inconnue…) : jamais d'accusé public", () => {
    expect(post({ replyText: null, handoffReason: "unknown_information" }, { complaintPublicAck: true })).toEqual({ type: "escalate", publicAck: null });
  });

  it("aucune réponse et aucune raison : à traiter à la main", () => {
    expect(post({ replyText: null, handoffReason: null })).toEqual({ type: "escalate", publicAck: null });
  });
});

describe("divers", () => {
  it("prix formaté depuis la base", () => {
    expect(flat(formatCommentPrice({ unitPrice: 24500, compareAtPrice: null, isPromo: false }))).toBe("24 500 FCFA");
  });
  it("masquage : Facebook, Instagram, Threads seulement", () => {
    expect(["facebook", "instagram", "threads"].every(supportsHide)).toBe(true);
    expect(supportsHide("tiktok")).toBe(false);
  });
  it("tous les messages de commentaire se rendent dans tous les tons", () => {
    const keys = MESSAGE_KEYS.filter((k) => k.startsWith("comment_"));
    expect(keys).toHaveLength(8);
    for (const key of keys) for (const register of ["vous", "tu"] as const) for (const emojiLevel of ["none", "light", "rich"] as const) {
      const text = createMessageLibrary({ ...DEFAULT_BRAND_VOICE, register, emojiLevel }).render(key, { product: "Sac", price: "1 FCFA", dm: "x" });
      expect(text).not.toContain("{");
    }
  });
});
