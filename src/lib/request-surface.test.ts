import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifySurface,
  isPlatformRootHost,
  buildPlatformOrigin,
  toHeaderSource,
  CRAWL_BLOCKED_PATHS,
  NOINDEX_ONLY_PATHS,
  PLATFORM_ONLY_PATHS,
  MARKETING_SITEMAP_ENTRIES,
} from "./request-surface";

describe("isPlatformRootHost", () => {
  it("reconnaît le domaine racine et son www., sans tenir compte de la casse ni des espaces", () => {
    expect(isPlatformRootHost("tokoo .com", "tokoo .com")).toBe(true);
    expect(isPlatformRootHost("www.tokoo .com", "tokoo .com")).toBe(true);
    expect(isPlatformRootHost("  tokoo .com ", "tokoo .com")).toBe(true);
    expect(isPlatformRootHost("localhost:3000", "localhost:3000")).toBe(true);
  });

  it("refuse un sous-domaine tenant, un domaine custom et un déploiement de prévisualisation", () => {
    expect(isPlatformRootHost("habynex.tokoo .com", "tokoo .com")).toBe(false);
    expect(isPlatformRootHost("habynex.com", "tokoo .com")).toBe(false);
    expect(isPlatformRootHost("thrive-git-main-abc123.vercel.app", "thrive.vercel.app")).toBe(false);
    expect(isPlatformRootHost("eviltokoo .com", "tokoo .com")).toBe(false);
    expect(isPlatformRootHost("tokoo .com.evil.example", "tokoo .com")).toBe(false);
  });

  it("ne classe jamais un hôte vide comme la plateforme", () => {
    expect(isPlatformRootHost("", "tokoo .com")).toBe(false);
    expect(isPlatformRootHost("tokoo .com", "")).toBe(false);
  });
});

describe("classifySurface", () => {
  const rootDomain = "tokoo .com";

  it("tenant résolu -> vitrine, quel que soit l'hôte", () => {
    expect(classifySurface({ hasTenant: true, host: "habynex.tokoo .com", rootDomain })).toBe("tenant");
    expect(classifySurface({ hasTenant: true, host: "habynex.com", rootDomain })).toBe("tenant");
  });

  it("aucun tenant + domaine racine -> landing marketing (à indexer)", () => {
    expect(classifySurface({ hasTenant: false, host: "tokoo .com", rootDomain })).toBe("marketing");
    expect(classifySurface({ hasTenant: false, host: "www.tokoo .com", rootDomain })).toBe("marketing");
  });

  it("aucun tenant + autre hôte (sous-domaine inconnu, tenant suspendu, preview) -> rien à indexer", () => {
    expect(classifySurface({ hasTenant: false, host: "inconnu.tokoo .com", rootDomain })).toBe("unrecognized");
    expect(classifySurface({ hasTenant: false, host: "thrive-abc.vercel.app", rootDomain })).toBe("unrecognized");
  });
});

describe("buildPlatformOrigin", () => {
  it("https en production, http uniquement en local", () => {
    expect(buildPlatformOrigin("tokoo .com")).toBe("https://tokoo .com");
    expect(buildPlatformOrigin("Thrive.Vercel.app")).toBe("https://thrive.vercel.app");
    expect(buildPlatformOrigin("localhost:3000")).toBe("http://localhost:3000");
    expect(buildPlatformOrigin("127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
  });
});

describe("listes de chemins", () => {
  it("aucun chemin n'est à la fois bloqué à l'exploration ET noindex-only (noindex illisible sinon)", () => {
    for (const path of NOINDEX_ONLY_PATHS) {
      expect(CRAWL_BLOCKED_PATHS.some((blocked) => path.startsWith(blocked))).toBe(false);
    }
  });

  it("chaque page marketing du sitemap (hors accueil) est déclarée « plateforme seulement » : indexable ici, noindex sous un hôte tenant", () => {
    expect(MARKETING_SITEMAP_ENTRIES.map((entry) => entry.path)).toContain("/");
    for (const entry of MARKETING_SITEMAP_ENTRIES.filter((e) => e.path !== "/")) {
      expect(PLATFORM_ONLY_PATHS.some((path) => path === entry.path)).toBe(true);
    }
  });

  it("toHeaderSource convertit un préfixe en motif source Next.js", () => {
    expect(toHeaderSource("/dashboard")).toBe("/dashboard/:path*");
    expect(toHeaderSource("/r/")).toBe("/r/:path*");
  });
});

describe("next.config.mjs reste synchronisé avec les listes de chemins", () => {
  // `next.config.mjs` ne peut pas importer ce fichier TypeScript : les motifs
  // y sont recopiés. Ce test échoue si on ajoute un chemin ici sans l'ajouter
  // là-bas (le noindex par en-tête, filet de sécurité de robots.txt, sauterait).
  const config = readFileSync(resolve(process.cwd(), "next.config.mjs"), "utf8");

  it.each([...CRAWL_BLOCKED_PATHS.map(toHeaderSource), ...NOINDEX_ONLY_PATHS])(
    "envoie X-Robots-Tag noindex pour %s",
    (source) => {
      expect(config).toContain(JSON.stringify(source));
    },
  );
});
