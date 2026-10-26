import { describe, expect, it } from "vitest";
import { checkAudio, looksLikeDictatedSecret, MAX_VOICE_BYTES, MAX_VOICE_SECONDS, normalizeTranscript, sniffAudioMime } from "./voice-policy";

const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 0]);
const M4A = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41]);
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0]);

describe("format audio (signature binaire)", () => {
  it("reconnaît ogg, webm, m4a, mp3", () => {
    expect([OGG, WEBM, M4A, MP3].map(sniffAudioMime)).toEqual(["audio/ogg", "audio/webm", "audio/mp4", "audio/mpeg"]);
  });
  it("refuse tout le reste (exécutable, HTML, texte, vide)", () => {
    for (const b of [new Uint8Array([0x4d, 0x5a, 0x90]), new TextEncoder().encode("<html>"), new Uint8Array([1, 2, 3]), new Uint8Array()]) expect(sniffAudioMime(b)).toBeNull();
  });
});

describe("contrôles avant envoi au fournisseur", () => {
  it("accepte un vocal valide", () => expect(checkAudio({ bytes: OGG, durationSec: 30 })).toEqual({ ok: true, mimeType: "audio/ogg" }));
  it("vide, trop gros, trop long, format inconnu", () => {
    expect(checkAudio({ bytes: new Uint8Array() })).toEqual({ ok: false, reason: "empty_audio" });
    expect(checkAudio({ bytes: new Uint8Array(MAX_VOICE_BYTES + 1) })).toEqual({ ok: false, reason: "too_large" });
    expect(checkAudio({ bytes: OGG, durationSec: MAX_VOICE_SECONDS + 1 })).toEqual({ ok: false, reason: "too_long" });
    expect(checkAudio({ bytes: OGG, durationSec: MAX_VOICE_SECONDS })).toMatchObject({ ok: true });
    expect(checkAudio({ bytes: new Uint8Array([9, 9, 9, 9]) })).toEqual({ ok: false, reason: "bad_format" });
  });
});

describe("transcription", () => {
  it("retire les caractères de contrôle et bidirectionnels, écrase les espaces", () => {
    expect(normalizeTranscript("  ajoute\u0000 une\n\n dépense‮  de 5000 ")).toBe("ajoute une dépense de 5000");
  });
  it("plafonne la longueur", () => expect(normalizeTranscript("a".repeat(9000))).toHaveLength(4000));
});

describe("PIN dicté", () => {
  it.each(["123456", "1 2 3 4 5 6", "1-2-3-4-5-6", "12 34 56", "mon code est 4 8 2 9 1 7", "le pin c'est 123456", "PIN 1234"])("détecté : %s", (t) => expect(looksLikeDictatedSecret(t)).toBe(true));
  it.each(["Ajoute une dépense de 5000 francs pour le transport", "Combien reste-t-il de savons ?", "Annule la commande 12", "rendez-vous à 15 h demain", "123"])("non détecté : %s", (t) => expect(looksLikeDictatedSecret(t)).toBe(false));
});
