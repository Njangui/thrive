import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Garde-fou de non-régression (audit SEO, sept. 2026).
 *
 * Tout bloc `<script type="application/ld+json">` doit passer par le
 * composant `<JsonLd>` (`app/_components/json-ld.tsx`), qui sérialise via
 * `serializeJsonLd` et échappe `<`. Écrit à la main avec
 * `dangerouslySetInnerHTML={{ __html: JSON.stringify(...) }}`, un nom de
 * boutique, une description produit ou une réponse de FAQ contenant
 * `</script>` s'exécute chez chaque visiteur de la vitrine — six pages
 * étaient concernées avant ce correctif.
 *
 * Ce test échoue dès qu'un fichier autre que le composant lui-même contient
 * la déclaration `application/ld+json`.
 */

const SRC_ROOT = path.resolve(__dirname, "..");
const ALLOWED = new Set([
  path.join(SRC_ROOT, "app", "_components", "json-ld.tsx"),
  path.join(SRC_ROOT, "lib", "seo.ts"), // le commentaire de `serializeJsonLd` cite la balise
]);

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("données structurées JSON-LD", () => {
  it("aucun fichier n'écrit un <script type=\"application/ld+json\"> hors du composant <JsonLd>", () => {
    const offenders = listSourceFiles(SRC_ROOT)
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => fs.readFileSync(file, "utf8").includes("application/ld+json"))
      .map((file) => path.relative(SRC_ROOT, file));

    expect(offenders).toEqual([]);
  });
});
