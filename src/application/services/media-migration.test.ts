import { describe, it, expect, beforeEach, vi } from "vitest";
import { StorageObjectExistsError, type StorageProvider, type UploadFileRequest } from "@/domain/ports/storage-provider";

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co"));
import {
  MEDIA_COLUMNS,
  SOURCE_URL_MARKER,
  migrateOrganizationMedia,
  parseTenantMediaUrl,
  type MediaColumnSpec,
  type MediaMigrationDeps,
  type MediaReferenceStore,
} from "./media-migration";

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const src = (path: string) => `https://abc.supabase.co${SOURCE_URL_MARKER}${path}`;
const R2 = "https://media.exemple.com";

/** Base en mémoire : seules les lignes dont la colonne contient le marqueur sont « à migrer ». */
class FakeStore implements MediaReferenceStore {
  rows = new Map<string, string | null>(); // `${table}.${column}:${rowId}` -> valeur
  blockUpdates = false;
  key = (s: MediaColumnSpec, id: string) => `${s.table}.${s.column}:${id}`;
  set(table: string, column: string, id: string, value: string | null) {
    this.rows.set(`${table}.${column}:${id}`, value);
  }
  get(table: string, column: string, id: string) {
    return this.rows.get(`${table}.${column}:${id}`);
  }
  async findReferences(spec: MediaColumnSpec, _org: string, limit: number, afterId: string | null) {
    const prefix = `${spec.table}.${spec.column}:`;
    return [...this.rows.entries()]
      .filter(([k, v]) => k.startsWith(prefix) && v?.includes(SOURCE_URL_MARKER))
      .map(([k, v]) => ({ rowId: k.slice(prefix.length), value: v }))
      .sort((a, b) => (a.rowId < b.rowId ? -1 : 1))
      .filter((r) => afterId === null || r.rowId > afterId)
      .slice(0, limit);
  }
  async updateValue(spec: MediaColumnSpec, _org: string, rowId: string, expected: string, next: string) {
    if (this.blockUpdates) return false;
    const k = this.key(spec, rowId);
    if (this.rows.get(k) !== expected) return false;
    this.rows.set(k, next);
    return true;
  }
}

class FakeTarget implements StorageProvider {
  providerName = "fake-r2";
  objects = new Map<string, Uint8Array>();
  uploads = 0;
  async upload(r: UploadFileRequest) {
    if (this.objects.has(r.path)) throw new StorageObjectExistsError(r.path);
    this.objects.set(r.path, r.data);
    this.uploads++;
    return { url: `${R2}/${r.path}`, path: r.path };
  }
  async delete() {}
  async getUrl(_o: string, path: string) { return `${R2}/${path}`; }
}

function setup(files: Record<string, { data: string; type?: string }>) {
  const store = new FakeStore();
  const target = new FakeTarget();
  let fetches = 0;
  const deps: MediaMigrationDeps = {
    store,
    target,
    async fetchSource(url) {
      fetches++;
      const path = decodeURIComponent(new URL(url).pathname.slice(SOURCE_URL_MARKER.length));
      const f = files[path];
      return f ? { ok: true, data: new TextEncoder().encode(f.data), contentType: f.type ?? "image/jpeg" } : { ok: false, reason: "HTTP 404" };
    },
    async verifyPublic(url) {
      const path = url.slice(R2.length + 1);
      const obj = target.objects.get(path);
      return { ok: Boolean(obj), contentLength: obj ? obj.byteLength : null };
    },
  };
  return { store, target, deps, fetchCount: () => fetches };
}

describe("parseTenantMediaUrl", () => {
  it("accepte uniquement une URL publique Supabase du dossier du tenant", () => {
    expect(parseTenantMediaUrl(src(`${ORG}/products/a%20b.jpg`), ORG)).toBe(`${ORG}/products/a b.jpg`);
    expect(parseTenantMediaUrl(src(`${OTHER}/products/a.jpg`), ORG)).toBeNull(); // autre tenant
    expect(parseTenantMediaUrl(`https://evil.example${SOURCE_URL_MARKER}${ORG}/a.jpg`, ORG)).toBeNull(); // autre hôte
    expect(parseTenantMediaUrl(`http://abc.supabase.co${SOURCE_URL_MARKER}${ORG}/a.jpg`, ORG)).toBeNull(); // pas https
    expect(parseTenantMediaUrl(src(`${ORG}/../${OTHER}/a.jpg`), ORG)).toBeNull(); // traversée
    expect(parseTenantMediaUrl(src(`${ORG}/%2e%2e/${OTHER}/a.jpg`), ORG)).toBeNull();
    expect(parseTenantMediaUrl("pas une url", ORG)).toBeNull();
    expect(parseTenantMediaUrl(`${R2}/${ORG}/a.jpg`, ORG)).toBeNull(); // déjà migrée
  });
});

describe("migrateOrganizationMedia", () => {
  const p1 = `${ORG}/products/a.jpg`;
  const p2 = `${ORG}/logo/l.png`;

  it("simulation (défaut) : compte sans rien lire ni écrire", async () => {
    const { store, deps, target, fetchCount } = setup({ [p1]: { data: "AAAA" } });
    store.set("product_images", "url", "r1", src(p1));
    const report = await migrateOrganizationMedia(deps, { organizationId: ORG });
    expect(report.apply).toBe(false);
    expect(report.referencesFound).toBe(1);
    expect(fetchCount()).toBe(0);
    expect(target.uploads).toBe(0);
    expect(store.get("product_images", "url", "r1")).toBe(src(p1));
  });

  it("copie, vérifie, réécrit ; un fichier utilisé deux fois n'est copié qu'une fois", async () => {
    const { store, deps, target, fetchCount } = setup({ [p1]: { data: "AAAA" }, [p2]: { data: "LOGO", type: "image/png" } });
    store.set("product_images", "url", "r1", src(p1));
    store.set("product_images", "url", "r2", src(p1)); // même fichier
    store.set("organizations", "logo_url", ORG, src(p2));
    const report = await migrateOrganizationMedia(deps, { organizationId: ORG, apply: true });
    expect(report.filesCopied).toBe(2);
    expect(fetchCount()).toBe(2);
    expect(report.rowsRewritten).toBe(3);
    expect(report.bytesCopied).toBe(8);
    expect(report.failures).toEqual([]);
    expect(store.get("product_images", "url", "r1")).toBe(`${R2}/${p1}`);
    expect(store.get("organizations", "logo_url", ORG)).toBe(`${R2}/${p2}`);
    expect(target.objects.size).toBe(2);
    expect(report.rewrites.length).toBe(3);
  });

  it("est idempotent : relancer ne fait plus rien", async () => {
    const { store, deps } = setup({ [p1]: { data: "AAAA" } });
    store.set("product_images", "url", "r1", src(p1));
    await migrateOrganizationMedia(deps, { organizationId: ORG, apply: true });
    const second = await migrateOrganizationMedia(deps, { organizationId: ORG, apply: true });
    expect(second.referencesFound).toBe(0);
    expect(second.rowsRewritten).toBe(0);
  });

  it("reprend après interruption : fichier déjà présent côté R2 (412) = réutilisé, pas recopié", async () => {
    const { store, deps, target } = setup({ [p1]: { data: "AAAA" } });
    target.objects.set(p1, new TextEncoder().encode("AAAA")); // copie faite avant l'interruption
    store.set("product_images", "url", "r1", src(p1));
    const report = await migrateOrganizationMedia(deps, { organizationId: ORG, apply: true });
    expect(report.filesAlreadyPresent).toBe(1);
    expect(report.filesCopied).toBe(0);
    expect(report.rowsRewritten).toBe(1);
  });

  it("n'écrase JAMAIS la base si la copie présente a une autre taille", async () => {
    const { store, deps, target } = setup({ [p1]: { data: "AAAA" } });
    target.objects.set(p1, new TextEncoder().encode("PAS-PAREIL")); // objet différent au même chemin
    store.set("product_images", "url", "r1", src(p1));
    const report = await migrateOrganizationMedia(deps, { organizationId: ORG, apply: true });
    expect(report.rowsRewritten).toBe(0);
    expect(report.failures.length).toBe(1);
    expect(store.get("product_images", "url", "r1")).toBe(src(p1));
  });

  it("ignore les URL étrangères, refuse le SVG et l'excès de taille, sans toucher aux lignes", async () => {
    const svg = `${ORG}/products/x.svg`;
    const big = `${ORG}/products/big.jpg`;
    const { store, deps } = setup({ [svg]: { data: "<svg/>", type: "image/svg+xml" }, [big]: { data: "X".repeat(50) } });
    store.set("product_images", "url", "a", src(svg));
    store.set("product_images", "url", "b", src(big));
    store.set("product_images", "url", "c", src(`${OTHER}/products/autre.jpg`));
    store.set("product_images", "url", "d", "https://cdn.exemple.com/externe.jpg");
    const report = await migrateOrganizationMedia(deps, { organizationId: ORG, apply: true, maxFileBytes: 10 });
    expect(report.skippedForeign).toBe(1); // « c » ; « d » ne contient pas le marqueur, jamais lu
    expect(report.rowsRewritten).toBe(0);
    expect(report.failures.map((f) => f.rowId).sort()).toEqual(["a", "b"]);
    expect(store.get("product_images", "url", "c")).toBe(src(`${OTHER}/products/autre.jpg`));
  });

  it("source introuvable : échec consigné, ligne intacte, les autres continuent", async () => {
    const { store, deps } = setup({ [p2]: { data: "LOGO", type: "image/png" } });
    store.set("product_images", "url", "r1", src(p1)); // 404
    store.set("organizations", "logo_url", ORG, src(p2));
    const report = await migrateOrganizationMedia(deps, { organizationId: ORG, apply: true });
    expect(report.failures.length).toBe(1);
    expect(report.rowsRewritten).toBe(1);
    expect(store.get("product_images", "url", "r1")).toBe(src(p1));
  });

  it("ligne modifiée pendant la migration : laissée telle quelle et comptée", async () => {
    const { store, deps } = setup({ [p1]: { data: "AAAA" } });
    store.set("product_images", "url", "r1", src(p1));
    store.blockUpdates = true;
    const report = await migrateOrganizationMedia(deps, { organizationId: ORG, apply: true });
    expect(report.rowsChangedConcurrently).toBe(1);
    expect(report.rowsRewritten).toBe(0);
  });

  it("ne couvre que les colonnes du périmètre C4 (aucune table d'une autre équipe ni justificatifs privés)", () => {
    const tables = new Set(MEDIA_COLUMNS.map((c) => c.table));
    for (const forbidden of ["social_posts", "contact_broadcasts", "telegram_publications", "expenses", "messages"]) {
      expect(tables.has(forbidden)).toBe(false);
    }
  });
});
