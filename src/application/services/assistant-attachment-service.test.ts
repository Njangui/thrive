import { describe, it, expect } from "vitest";
import { isOwnAttachmentPath, matchesSignature, validateAssistantFile } from "./assistant-attachment-service";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const UUID = "33333333-3333-4333-8333-333333333333";
const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("isOwnAttachmentPath", () => {
  it("accepte uniquement le chemin du tenant, dans le dossier du chat", () => {
    expect(isOwnAttachmentPath(ORG, `${ORG}/assistant-attachment/${UUID}-recu.jpg`)).toBe(true);
  });
  it.each([
    ["autre tenant", `${OTHER}/assistant-attachment/${UUID}-recu.jpg`],
    ["sans préfixe tenant", `assistant-attachment/${UUID}-recu.jpg`],
    ["autre dossier", `${ORG}/product/${UUID}-recu.jpg`],
    ["traversée", `${ORG}/assistant-attachment/../${OTHER}/x.jpg`],
    ["sous-dossier", `${ORG}/assistant-attachment/${UUID}-a/b.jpg`],
    ["sans uuid", `${ORG}/assistant-attachment/recu.jpg`],
  ])("refuse : %s", (_label, path) => expect(isOwnAttachmentPath(ORG, path)).toBe(false));
  it("refuse un tenantId malformé", () => expect(isOwnAttachmentPath("x", "x/assistant-attachment/y")).toBe(false));
});

describe("validation des fichiers", () => {
  it("accepte un JPEG réel", () => expect(validateAssistantFile({ type: "image/jpeg", size: 16, name: "a.jpg" }, bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({ mime: "image/jpeg", kind: "image" }));
  it("normalise les paramètres MIME d'un vocal (ogg;codecs=opus)", () => expect(validateAssistantFile({ type: "audio/ogg;codecs=opus", size: 16, name: "v.ogg" }, bytes(0x4f, 0x67, 0x67, 0x53)).kind).toBe("audio"));
  it("refuse SVG, HTML et vidéo", () => {
    for (const type of ["image/svg+xml", "text/html", "video/mp4"]) expect(() => validateAssistantFile({ type, size: 16, name: "x" }, bytes(1))).toThrow(/non pris en charge/);
  });
  it("refuse un contenu qui ne correspond pas au type annoncé (HTML déguisé en JPEG)", () => {
    expect(() => validateAssistantFile({ type: "image/jpeg", size: 16, name: "x.jpg" }, bytes(0x3c, 0x68, 0x74, 0x6d))).toThrow(/ne correspond pas/);
  });
  it("refuse trop volumineux et taille incohérente", () => {
    const big = new Uint8Array(4 * 1024 * 1024 + 1); big.set([0xff, 0xd8, 0xff]);
    expect(() => validateAssistantFile({ type: "image/jpeg", size: big.byteLength, name: "x" }, big)).toThrow(/volumineux/);
    expect(() => validateAssistantFile({ type: "image/jpeg", size: 999, name: "x" }, bytes(0xff, 0xd8, 0xff))).toThrow(/invalide/);
  });
  it("signatures PNG / PDF / WebP", () => {
    expect(matchesSignature("image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(true);
    expect(matchesSignature("application/pdf", bytes(0x25, 0x50, 0x44, 0x46))).toBe(true);
    expect(matchesSignature("image/webp", new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe(true);
    expect(matchesSignature("image/webp", bytes(0x52, 0x49, 0x46, 0x46))).toBe(false);
  });
});
