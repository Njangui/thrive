import { describe, it, expect } from "vitest";
import { parseBrandVoiceInput, voiceFromRow, formatVoiceForPrompt, checkVoiceCompliance, redactPersonalData, countEmojis, DEFAULT_BRAND_VOICE, type BrandVoice } from "./brand-voice";

const voice = (over: Partial<BrandVoice> = {}): BrandVoice => ({ ...DEFAULT_BRAND_VOICE, ...over });

describe("parseBrandVoiceInput", () => {
  it("accepte un profil complet et nettoie les listes (doublons, espaces)", () => {
    const r = parseBrandVoiceInput({ register: "tu", emojiLevel: "rich", localExpressions: ["  on est ensemble ", "on est ensemble", "wesh"], avoidExpressions: ["cher client"], exampleMessages: [], examplesConsent: false });
    expect(r).toMatchObject({ ok: true, voice: { register: "tu", emojiLevel: "rich", localExpressions: ["on est ensemble", "wesh"], avoidExpressions: ["cher client"] } });
  });

  it("valeurs par défaut quand le champ est absent", () => {
    const r = parseBrandVoiceInput({});
    expect(r).toMatchObject({ ok: true, voice: { register: "vous", emojiLevel: "light" } });
  });

  it("refuse (au lieu de deviner) un registre ou un niveau d'emoji inconnus", () => {
    expect(parseBrandVoiceInput({ register: "toi" })).toMatchObject({ ok: false });
    expect(parseBrandVoiceInput({ emojiLevel: "max" })).toMatchObject({ ok: false });
    expect(parseBrandVoiceInput("tu")).toMatchObject({ ok: false });
  });

  it("les exemples de messages exigent le consentement explicite", () => {
    const r = parseBrandVoiceInput({ exampleMessages: ["Salut ! Ton colis est prêt."] });
    expect(r.ok).toBe(false);
    expect(parseBrandVoiceInput({ exampleMessages: ["Salut ! Ton colis est prêt."], examplesConsent: true }).ok).toBe(true);
  });

  it("retire emails, numéros et liens des exemples avant stockage (minimisation)", () => {
    const r = parseBrandVoiceInput({ exampleMessages: ["Appelle Awa au +237 699 12 34 56 ou écris à awa@mail.cm, voir https://x.cm/p"], examplesConsent: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.voice.exampleMessages[0]).toBe("Appelle Awa au [numéro] ou écris à [email], voir [lien]");
    }
  });

  it("limite le nombre et la longueur des éléments", () => {
    expect(parseBrandVoiceInput({ localExpressions: Array.from({ length: 11 }, (_, i) => `expr${i}`) }).ok).toBe(false);
    expect(parseBrandVoiceInput({ avoidExpressions: ["x".repeat(41)] }).ok).toBe(false);
    expect(parseBrandVoiceInput({ exampleMessages: Array.from({ length: 11 }, (_, i) => `m${i}`), examplesConsent: true }).ok).toBe(false);
  });
});

describe("voiceFromRow", () => {
  it("lecture tolérante : ligne absente ou corrompue → défauts", () => {
    expect(voiceFromRow(null)).toEqual(DEFAULT_BRAND_VOICE);
    expect(voiceFromRow({ register: 42, emoji_level: "??", local_expressions: "x" })).toMatchObject({ register: "vous", emojiLevel: "light", localExpressions: [] });
  });

  it("n'expose jamais les exemples sans consentement, même présents en base", () => {
    expect(voiceFromRow({ example_messages: ["a"], examples_consent: false }).exampleMessages).toEqual([]);
    expect(voiceFromRow({ example_messages: ["a"], examples_consent: true }).exampleMessages).toEqual(["a"]);
  });
});

describe("formatVoiceForPrompt", () => {
  it("décrit registre, emojis, expressions et exemples (si consentement)", () => {
    const text = formatVoiceForPrompt(voice({ register: "tu", emojiLevel: "none", localExpressions: ["on est ensemble"], avoidExpressions: ["cher client"], exampleMessages: ["Salut ! C'est prêt."], examplesConsent: true }));
    expect(text).toContain("Tutoie le client");
    expect(text).toContain("aucun emoji");
    expect(text).toContain("on est ensemble");
    expect(text).toContain("Ne dis jamais : cher client");
    expect(text).toContain("« Salut ! C'est prêt. »");
  });
});

describe("checkVoiceCompliance", () => {
  it("vouvoiement : refuse le tutoiement", () => {
    expect(checkVoiceCompliance("Tu peux passer demain, ton colis est prêt.", voice())).toContain("register_mismatch");
    expect(checkVoiceCompliance("Vous pouvez passer demain, votre colis est prêt.", voice())).toEqual([]);
  });

  it("tutoiement : refuse le vouvoiement", () => {
    expect(checkVoiceCompliance("Vous pouvez passer demain.", voice({ register: "tu" }))).toContain("register_mismatch");
    expect(checkVoiceCompliance("Tu peux passer demain.", voice({ register: "tu" }))).toEqual([]);
  });

  it("refuse une expression à éviter (accents et casse ignorés)", () => {
    const v = voice({ avoidExpressions: ["Cher Client"] });
    expect(checkVoiceCompliance("Bonjour cher client, voici le prix.", v)).toContain("avoid_expression");
    expect(checkVoiceCompliance("Bonjour, voici le prix.", v)).toEqual([]);
  });

  it("n'a pas de faux positif sur un mot qui contient l'expression", () => {
    expect(checkVoiceCompliance("Nous avons des tuniques", voice({ register: "tu" }))).toEqual([]);
  });

  it("refuse trop d'emojis pour le niveau choisi", () => {
    expect(checkVoiceCompliance("Super 😀😀😀 !", voice({ emojiLevel: "light" }))).toContain("emoji_excess");
    expect(checkVoiceCompliance("Super 😀 !", voice({ emojiLevel: "none" }))).toContain("emoji_excess");
    expect(checkVoiceCompliance("Super 😀😀😀 !", voice({ emojiLevel: "rich" }))).toEqual([]);
  });
});

describe("utilitaires", () => {
  it("compte les emojis (pas les chiffres ni la ponctuation)", () => {
    expect(countEmojis("Salut 👋 ça va ? 😊 12345 !")).toBe(2);
  });
  it("redactPersonalData", () => {
    expect(redactPersonalData("écris à a@b.cm")).toBe("écris à [email]");
  });
});
