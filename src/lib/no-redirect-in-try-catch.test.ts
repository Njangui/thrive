import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import fs from "node:fs";
import path from "node:path";

/**
 * Garde-fou de non-régression (fusion #14, addendum).
 *
 * `redirect()`, `permanentRedirect()` et `notFound()` (next/navigation) ne
 * « retournent » jamais : ils LÈVENT une exception spéciale
 * (NEXT_REDIRECT / NEXT_NOT_FOUND) que Next.js intercepte plus haut. Appelés
 * dans un `try` qui a son propre `catch`, c'est ce `catch` qui l'attrape et la
 * traite comme une vraie erreur : l'action a réussi, mais l'utilisateur voit
 * « Erreur lors de l'enregistrement ». Ce bug est apparu à deux fusions
 * consécutives (#13 : dashboard/channels ; #14 : dashboard/ai, groups, team,
 * marketing/nouveau) — d'où ce test, qui échoue au lieu de le laisser revenir.
 *
 * Schéma sûr : capturer le résultat dans une variable dans le `try`, appeler
 * `redirect()` APRÈS le try/catch. Un `catch` qui re-lance l'erreur qu'il ne
 * reconnaît pas (`throw error` au premier niveau du bloc) est également accepté :
 * NEXT_REDIRECT n'est pas une AppError, elle repart donc vers Next.js.
 *
 * Volontairement ignorés : `NextResponse.redirect(...)` (appel de méthode qui
 * RETOURNE une réponse, ne lève rien).
 */

const SRC_ROOT = path.resolve(__dirname, "..");
const THROWING_NAVIGATION_CALLS = new Set(["redirect", "permanentRedirect", "notFound"]);

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function bareCalleeName(call: ts.CallExpression): string | null {
  // Identifiant nu uniquement : `NextResponse.redirect(...)` (accès de propriété) est exclu.
  return ts.isIdentifier(call.expression) ? call.expression.text : null;
}

/** Fonctions du fichier qui (transitivement, dans ce même fichier) appellent redirect/notFound. */
function collectThrowingNames(sf: ts.SourceFile): Set<string> {
  const fns: { name: string; body: ts.Node }[] = [];
  (function visit(n: ts.Node) {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) fns.push({ name: n.name.text, body: n.body });
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
    ) {
      fns.push({ name: n.name.text, body: n.initializer.body });
    }
    ts.forEachChild(n, visit);
  })(sf);

  const names = new Set(THROWING_NAVIGATION_CALLS);
  const callsAny = (body: ts.Node): boolean => {
    let found = false;
    (function visit(n: ts.Node) {
      if (found) return;
      if (ts.isCallExpression(n)) {
        const nm = bareCalleeName(n);
        if (nm && names.has(nm)) {
          found = true;
          return;
        }
      }
      ts.forEachChild(n, visit);
    })(body);
    return found;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of fns) {
      if (!names.has(fn.name) && callsAny(fn.body)) {
        names.add(fn.name);
        changed = true;
      }
    }
  }
  return names;
}

function callsInTryBlock(block: ts.Block, names: Set<string>): string[] {
  const hits: string[] = [];
  (function visit(n: ts.Node) {
    // Ne pas descendre dans une fonction imbriquée : son corps ne s'exécute pas forcément dans ce try.
    if (n !== block && ts.isFunctionLike(n)) return;
    if (ts.isCallExpression(n)) {
      const nm = bareCalleeName(n);
      if (nm && names.has(nm)) hits.push(nm);
    }
    ts.forEachChild(n, visit);
  })(block);
  return hits;
}

function catchRethrows(clause: ts.CatchClause): boolean {
  const text = clause.getText();
  if (/isRedirectError|unstable_rethrow|NEXT_REDIRECT|NEXT_NOT_FOUND|isNotFoundError/.test(text)) return true;
  const varName = clause.variableDeclaration && ts.isIdentifier(clause.variableDeclaration.name) ? clause.variableDeclaration.name.text : null;
  if (!varName) return false;
  // `throw <variable du catch>` au premier niveau du bloc catch.
  return clause.block.statements.some(
    (st) => ts.isThrowStatement(st) && st.expression && ts.isIdentifier(st.expression) && st.expression.text === varName,
  );
}

function findViolations(): string[] {
  const violations: string[] = [];
  for (const file of listSourceFiles(SRC_ROOT)) {
    const text = fs.readFileSync(file, "utf8");
    if (!/\b(redirect|permanentRedirect|notFound)\b/.test(text)) continue; // pré-filtre rapide
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const names = collectThrowingNames(sf);
    (function visit(n: ts.Node) {
      if (ts.isTryStatement(n) && n.catchClause) {
        const hits = callsInTryBlock(n.tryBlock, names);
        if (hits.length > 0 && !catchRethrows(n.catchClause)) {
          const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
          violations.push(`${path.relative(SRC_ROOT, file)}:${line} — ${[...new Set(hits)].join(", ")}() dans un try/catch`);
        }
      }
      ts.forEachChild(n, visit);
    })(sf);
  }
  return violations;
}

describe("redirect()/notFound() jamais avalés par un catch", () => {
  it("aucun appel dans un try/catch sans re-throw (sinon le succès s'affiche comme une erreur)", () => {
    expect(findViolations()).toEqual([]);
  });

  it("le détecteur reconnaît bien le schéma fautif (test du test)", () => {
    const sample = `
      import { redirect } from "next/navigation";
      function flash(m: string): never { redirect("/x?m=" + m); }
      async function action() {
        try { await doIt(); flash("ok"); } catch (e) { flash("erreur"); }
      }`;
    const sf = ts.createSourceFile("sample.ts", sample, ts.ScriptTarget.Latest, true);
    const names = collectThrowingNames(sf);
    expect(names.has("flash")).toBe(true);
    let flagged = 0;
    (function visit(n: ts.Node) {
      if (ts.isTryStatement(n) && n.catchClause && callsInTryBlock(n.tryBlock, names).length > 0 && !catchRethrows(n.catchClause)) flagged++;
      ts.forEachChild(n, visit);
    })(sf);
    expect(flagged).toBe(1);
  });
});
