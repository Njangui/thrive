import { describe, it, expect } from "vitest";
import { classifyAttachment, normalizeMimeType, MAX_MESSAGE_ATTACHMENT_BYTES } from "./message-attachment-service";

describe("normalizeMimeType", () => {
  it("retire les paramètres de codec et normalise la casse (MediaRecorder renvoie `audio/ogg;codecs=opus`)", () => {
    expect(normalizeMimeType("audio/ogg;codecs=opus")).toBe("audio/ogg");
    expect(normalizeMimeType(" Audio/MP4 ")).toBe("audio/mp4");
  });
});

describe("classifyAttachment", () => {
  it("image JPG/PNG : acceptée sur les deux canaux", () => {
    expect(classifyAttachment("image/jpeg", "whatsapp", false).type).toBe("image");
    expect(classifyAttachment("image/png", "telegram", false).type).toBe("image");
  });

  it("WebP : refusée sur WhatsApp (JPG/PNG seulement), acceptée sur Telegram", () => {
    expect(() => classifyAttachment("image/webp", "whatsapp", false)).toThrow(/JPG ou PNG/);
    expect(classifyAttachment("image/webp", "telegram", false).type).toBe("image");
  });

  it("vocal OGG/OPUS enregistré : audio + vocal, sur WhatsApp comme sur Telegram", () => {
    expect(classifyAttachment("audio/ogg;codecs=opus", "whatsapp", true)).toEqual({ type: "audio", mimeType: "audio/ogg", isVoiceNote: true });
    expect(classifyAttachment("audio/ogg;codecs=opus", "telegram", true)).toEqual({ type: "audio", mimeType: "audio/ogg", isVoiceNote: true });
  });

  it("vocal MP4/AAC (Safari) : accepté", () => {
    expect(classifyAttachment("audio/mp4", "whatsapp", true).isVoiceNote).toBe(true);
  });

  it("vocal WebM : refusé sur WhatsApp (jamais délivré sinon), envoyé en fichier sur Telegram", () => {
    expect(() => classifyAttachment("audio/webm;codecs=opus", "whatsapp", true)).toThrow(/WebM/);
    expect(classifyAttachment("audio/webm;codecs=opus", "telegram", true)).toEqual({ type: "file", mimeType: "audio/webm", isVoiceNote: false });
  });

  it("un fichier audio joint (non enregistré) n'est jamais traité comme un vocal", () => {
    expect(classifyAttachment("audio/mpeg", "telegram", false)).toEqual({ type: "audio", mimeType: "audio/mpeg", isVoiceNote: false });
  });

  it("documents Office/PDF : envoyés comme fichiers", () => {
    expect(classifyAttachment("application/pdf", "whatsapp", false).type).toBe("file");
    expect(classifyAttachment("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "telegram", false).type).toBe("file");
  });

  it("type inconnu ou dangereux (exécutable, HTML, SVG) : refusé", () => {
    expect(() => classifyAttachment("application/x-msdownload", "whatsapp", false)).toThrow(/non pris en charge/);
    expect(() => classifyAttachment("text/html", "telegram", false)).toThrow(/non pris en charge/);
    expect(() => classifyAttachment("image/svg+xml", "telegram", false)).toThrow(/non pris en charge/);
    expect(() => classifyAttachment("", "telegram", false)).toThrow(/non pris en charge/);
  });

  it("plafond à 4 Mo (limite de corps de requête Vercel)", () => {
    expect(MAX_MESSAGE_ATTACHMENT_BYTES).toBe(4 * 1024 * 1024);
  });
});
