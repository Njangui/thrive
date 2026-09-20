import { describe, it, expect } from "vitest";
import { pickTelegramUploadKind } from "./adapter";

describe("pickTelegramUploadKind — rendu natif seulement pour les formats documentés par Telegram", () => {
  it("vidéo MP4 : lecture intégrée ; MOV/AVI/WebM : document (livré à coup sûr)", () => {
    expect(pickTelegramUploadKind("video", "video/mp4", false)).toBe("video");
    expect(pickTelegramUploadKind("video", "video/quicktime", false)).toBe("document");
    expect(pickTelegramUploadKind("video", "video/webm", false)).toBe("document");
  });

  it("vocal enregistré : sendVoice pour OGG/MP3/M4A ; jamais pour WebM", () => {
    expect(pickTelegramUploadKind("audio", "audio/ogg", true)).toBe("voice");
    expect(pickTelegramUploadKind("audio", "audio/mp4", true)).toBe("voice");
    expect(pickTelegramUploadKind("audio", "audio/webm", true)).toBe("document");
  });

  it("audio joint (non vocal) : lecteur audio pour MP3/M4A, document pour AAC/AMR", () => {
    expect(pickTelegramUploadKind("audio", "audio/mpeg", false)).toBe("audio");
    expect(pickTelegramUploadKind("audio", "audio/aac", false)).toBe("document");
  });

  it("image : photo, sauf GIF (document) ; fichier : document", () => {
    expect(pickTelegramUploadKind("image", "image/jpeg", false)).toBe("photo");
    expect(pickTelegramUploadKind("image", "image/gif", false)).toBe("document");
    expect(pickTelegramUploadKind("file", "application/pdf", false)).toBe("document");
    expect(pickTelegramUploadKind(undefined, "", false)).toBe("document");
  });
});
