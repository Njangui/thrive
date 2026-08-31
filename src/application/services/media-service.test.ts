import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildTenantObjectPath, resolveImageFromFormData } from "./media-service";

describe("buildTenantObjectPath", () => {
  it("respecte le format {type}/{uuid}-{filename}", () => {
    const path = buildTenantObjectPath("product", "photo.png");
    expect(path).toMatch(
      /^product\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-photo\.png$/,
    );
  });

  it("nettoie les caractères non sûrs du nom de fichier", () => {
    const path = buildTenantObjectPath("logo", "mon logo été (final)!!.png");
    expect(path).not.toMatch(/[^a-zA-Z0-9._/-]/);
    expect(path.endsWith(".png")).toBe(true);
  });

  it("retombe sur 'fichier' si le nom devient vide après nettoyage", () => {
    const path = buildTenantObjectPath("favicon", "★★★");
    expect(path).toMatch(/^favicon\/[0-9a-f-]{36}-fichier$/);
  });

  it("génère un UUID différent à chaque appel (pas de collision de nommage)", () => {
    const a = buildTenantObjectPath("banner", "x.png");
    const b = buildTenantObjectPath("banner", "x.png");
    expect(a).not.toBe(b);
  });
});

const uploadMock = vi.fn();

vi.mock("@/infrastructure/providers/registry", () => ({
  getStorageProvider: async () => ({
    providerName: "fake",
    upload: uploadMock,
    delete: vi.fn(),
    getUrl: vi.fn(),
  }),
}));

describe("resolveImageFromFormData", () => {
  beforeEach(() => {
    uploadMock.mockReset();
    uploadMock.mockResolvedValue({ url: "https://cdn.example.com/uploaded.png", path: "org/product/x.png" });
  });

  it("priorise le fichier uploadé sur l'URL collée quand les deux sont présents", async () => {
    const formData = new FormData();
    formData.set("imageFile", new File(["contenu"], "photo.png", { type: "image/png" }));
    formData.set("imageUrl", "https://exemple.com/ignoree.png");

    const url = await resolveImageFromFormData(formData, {
      organizationId: "org-1",
      mediaType: "product",
      fileField: "imageFile",
      urlField: "imageUrl",
    });

    expect(url).toBe("https://cdn.example.com/uploaded.png");
    expect(uploadMock).toHaveBeenCalledTimes(1);
  });

  it("utilise l'URL collée quand aucun fichier n'est fourni", async () => {
    const formData = new FormData();
    formData.set("imageUrl", "https://exemple.com/logo.png");

    const url = await resolveImageFromFormData(formData, {
      organizationId: "org-1",
      mediaType: "logo",
      fileField: "logoFile",
      urlField: "imageUrl",
    });

    expect(url).toBe("https://exemple.com/logo.png");
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("conserve currentUrl quand rien n'est fourni (édition sans changement)", async () => {
    const formData = new FormData();

    const url = await resolveImageFromFormData(formData, {
      organizationId: "org-1",
      mediaType: "banner",
      fileField: "bannerFile",
      urlField: "bannerUrl",
      currentUrl: "https://exemple.com/deja-la.png",
    });

    expect(url).toBe("https://exemple.com/deja-la.png");
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("rejette un fichier trop volumineux (> 5 Mo)", async () => {
    const formData = new FormData();
    const tooBig = new File([new Uint8Array(6 * 1024 * 1024)], "gros.png", { type: "image/png" });
    formData.set("imageFile", tooBig);

    await expect(
      resolveImageFromFormData(formData, {
        organizationId: "org-1",
        mediaType: "product",
        fileField: "imageFile",
        urlField: "imageUrl",
      }),
    ).rejects.toThrow(/5 Mo/);
  });

  it("rejette un fichier qui n'est pas une image", async () => {
    const formData = new FormData();
    formData.set("imageFile", new File(["pdf"], "doc.pdf", { type: "application/pdf" }));

    await expect(
      resolveImageFromFormData(formData, {
        organizationId: "org-1",
        mediaType: "product",
        fileField: "imageFile",
        urlField: "imageUrl",
      }),
    ).rejects.toThrow(/images/);
  });
});
