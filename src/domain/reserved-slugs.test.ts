import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS, isReservedSlug } from "./reserved-slugs";

describe("sous-domaines réservés (Q29)", () => {
  it("la liste du code est IDENTIQUE à celle de la base (is_reserved_slug, migration 0193)", () => {
    const dir = join(process.cwd(), "supabase", "migrations");
    const file = readdirSync(dir).find((f) => f.startsWith("0193_"))!;
    const sql = readFileSync(join(dir, file), "utf8");
    const block = sql.slice(sql.indexOf("array["), sql.indexOf("]);", sql.indexOf("array[")));
    const inSql = [...block.matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]).sort();
    expect([...RESERVED_SLUGS].sort()).toEqual(inSql);
  });
  it("couvre la liste décidée + le nom de la marque, sans tenir compte de la casse", () => {
    for (const s of ["www", "admin", "api", "app", "mail", "auth", "login", "pay", "support", "status", "billing", "dashboard", "affiliate", "cdn", "static", "flexco"]) {
      expect(isReservedSlug(s)).toBe(true);
    }
    expect(isReservedSlug(" ADMIN ")).toBe(true);
    expect(isReservedSlug("ma-boutique")).toBe(false);
  });
});
