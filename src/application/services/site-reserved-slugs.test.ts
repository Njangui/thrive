import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { RESERVED_PAGE_SLUGS } from "@/domain/entities/site";

/**
 * Garde-fou de collision : toute route de premier niveau de l'application doit
 * figurer dans RESERVED_PAGE_SLUGS, sinon une page créée avec ce slug serait
 * silencieusement masquée par la route statique (qui l'emporte toujours sur la
 * route dynamique `/(site)/[pageSlug]`). Ce test échoue dès qu'une nouvelle route
 * est ajoutée sans être réservée.
 */
function topLevelSegments(appDir: string): string[] {
  const segments: string[] = [];
  const visit = (dir: string, depth: number) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const isDir = statSync(full).isDirectory();
      if (isDir && name.startsWith("(")) { visit(full, depth + 1); continue; } // groupe de routes : transparent dans l'URL
      if (isDir) {
        if (name.startsWith("_") || name.startsWith("[") || name.startsWith("@")) continue; // privé / dynamique / slot
        segments.push(name);
      } else if (depth >= 0 && /^(robots|sitemap)\.(ts|tsx)$/.test(name) && dir.endsWith("app")) {
        segments.push(name.replace(/\.(ts|tsx)$/, ""));
      }
    }
  };
  visit(appDir, 0);
  return [...new Set(segments)];
}

describe("RESERVED_PAGE_SLUGS", () => {
  it("couvre toutes les routes de premier niveau existantes", () => {
    const routes = topLevelSegments(join(process.cwd(), "src", "app"));
    expect(routes.length > 10).toBe(true); // le test a bien lu l'arborescence
    const missing = routes.filter((route) => !(RESERVED_PAGE_SLUGS as readonly string[]).includes(route));
    expect(missing).toEqual([]);
  });
});
