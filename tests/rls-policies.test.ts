import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Lot 1 (audit multi-tenant, section 4/71 du master prompt) — un vrai
 * test d'intégration ("Tenant A ne peut pas lire Tenant B") nécessite une
 * instance Postgres réelle avec RLS actif, ce qui n'est pas exécutable
 * dans cet environnement (voir RAPPORT_LOT_1.md, limitation
 * d'environnement). Ce test ne remplace PAS cette vérification — c'est
 * un filet statique complémentaire, exécutable ici et à chaque `npm
 * test` : il lit les migrations SQL réelles (pas une supposition sur ce
 * qu'elles contiennent) et vérifie structurellement que :
 *
 * 1. Toute table créée a RLS activée (`enable row level security`).
 * 2. Toute table qui a AU MOINS UNE politique définit cette politique de
 *    façon tenant-safe — `organization_id`, `is_member_of_org(...)`,
 *    `is_platform_admin(...)`, ou `auth.uid()` — sauf pour les tables de
 *    référence explicitement publiques listées dans PUBLIC_REFERENCE_TABLES
 *    (catalogue de plans/add-ons, jamais de données appartenant à un
 *    tenant).
 *
 * Ce test échoue si une future migration ajoute une table tenant sans
 * RLS, ou une politique `using (true)` sur une table qui n'est pas dans
 * l'allowlist explicite ci-dessous — la seule façon de faire passer ce
 * cas est d'ajouter délibérément la table à l'allowlist, avec la
 * justification en commentaire, jamais silencieusement.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

/**
 * Tables de RÉFÉRENCE explicitement publiques (catalogue plateforme, pas
 * de données appartenant à un tenant) — vérifiées manuellement lors de
 * l'audit Lot 1, voir RAPPORT_LOT_1.md :
 * - plans / plan_entitlements : catalogue de plans, doit être lisible
 *   avant même la création d'un compte (page tarifs publique, section 54).
 * - addons / domain_tld_pricing : catalogues similaires (add-ons,
 *   tarification domaines), `to authenticated using (active = true)`.
 */
const PUBLIC_REFERENCE_TABLES = new Set(["plans", "plan_entitlements", "addons", "domain_tld_pricing"]);

/**
 * Tables intentionnellement SANS AUCUNE politique (RLS activée = deny-all
 * par défaut pour anon/authenticated, accessible uniquement via
 * service_role) — vérifiées manuellement lors de l'audit Lot 1 :
 * - platform_admins / platform_settings : administration plateforme,
 *   jamais accessible à un rôle tenant.
 * - webhook_events : idempotence/audit interne des webhooks, jamais
 *   destiné à une lecture applicative directe.
 * - phone_numbers : inventaire Super Admin (section 62) — tout accès
 *   tenant passe par un service en service_role, pas par RLS directe.
 */
const SERVICE_ROLE_ONLY_TABLES = new Set(["platform_admins", "platform_settings", "webhook_events", "phone_numbers"]);

const TENANT_SAFE_MARKERS = ["organization_id", "is_member_of_org", "is_platform_admin", "auth.uid()"];

function readAllMigrations(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  return files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8")).join("\n");
}

function extractCreatedTables(sql: string): Set<string> {
  const re = /create table(?: if not exists)?\s+(\w+)/gi;
  const tables = new Set<string>();
  for (const match of sql.matchAll(re)) tables.add(match[1]!);
  return tables;
}

function extractRlsEnabledTables(sql: string): Set<string> {
  const re = /alter table (\w+) enable row level security/gi;
  const tables = new Set<string>();
  for (const match of sql.matchAll(re)) tables.add(match[1]!);
  return tables;
}

interface Policy {
  table: string;
  clause: string;
}

function extractPolicies(sql: string): Policy[] {
  // Une politique se termine au `;` de fin de statement — les clauses
  // `using (...)`/`with check (...)` peuvent contenir des parenthèses
  // imbriquées mais jamais de point-virgule dans ce projet (vérifié sur
  // toutes les migrations existantes), donc un match non-gourmand
  // jusqu'au premier `;` est fiable ici.
  const re = /create policy\s+"[^"]+"\s+on\s+(\w+)[^;]*?(using\s*\([^;]*?\)|with check\s*\([^;]*?\))+[^;]*;/gis;
  const policies: Policy[] = [];
  for (const match of sql.matchAll(re)) {
    policies.push({ table: match[1]!, clause: match[0] });
  }
  return policies;
}

describe("RLS — chaque table a une politique tenant-safe (Lot 1, filet statique)", () => {
  const sql = readAllMigrations();
  const createdTables = extractCreatedTables(sql);
  const rlsEnabledTables = extractRlsEnabledTables(sql);
  const policies = extractPolicies(sql);

  it("a trouvé des tables et des politiques (le test lit vraiment les migrations)", () => {
    // Filet de sécurité sur le test lui-même : si ce nombre tombe à 0,
    // c'est que le parsing regex a cassé silencieusement, pas que le
    // projet n'a plus de tables.
    expect(createdTables.size).toBeGreaterThan(40);
    expect(policies.length).toBeGreaterThan(40);
  });

  it("toute table créée (hors tables système Supabase) a RLS activée", () => {
    const missing = [...createdTables].filter((t) => !rlsEnabledTables.has(t));
    expect(missing).toEqual([]);
  });

  for (const table of PUBLIC_REFERENCE_TABLES) {
    it(`${table} : table de référence publique connue — présente dans les migrations`, () => {
      expect(createdTables.has(table)).toBe(true);
    });
  }

  it("aucune politique 'using (true)' / 'with check (true)' en dehors de l'allowlist explicite", () => {
    const trueClausePattern = /using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i;
    const offenders = policies
      .filter((p) => trueClausePattern.test(p.clause))
      .filter((p) => !PUBLIC_REFERENCE_TABLES.has(p.table))
      .map((p) => p.table);

    expect(offenders).toEqual([]);
  });

  it("toute table avec au moins une politique a au moins une politique tenant-safe (organization_id / is_member_of_org / is_platform_admin / auth.uid())", () => {
    const byTable = new Map<string, Policy[]>();
    for (const p of policies) {
      if (PUBLIC_REFERENCE_TABLES.has(p.table)) continue; // couvert par le test 'using (true)' ci-dessus
      if (!byTable.has(p.table)) byTable.set(p.table, []);
      byTable.get(p.table)!.push(p);
    }

    const unsafeTables: string[] = [];
    for (const [table, tablePolicies] of byTable) {
      const hasSafePolicy = tablePolicies.some((p) => TENANT_SAFE_MARKERS.some((marker) => p.clause.includes(marker)));
      if (!hasSafePolicy) unsafeTables.push(table);
    }

    expect(unsafeTables).toEqual([]);
  });

  it("les tables sans aucune politique sont uniquement celles de l'allowlist service_role-only (deny-all volontaire)", () => {
    const tablesWithPolicies = new Set(policies.map((p) => p.table));
    const tablesWithoutPolicies = [...createdTables].filter((t) => !tablesWithPolicies.has(t));

    const unexplained = tablesWithoutPolicies.filter((t) => !SERVICE_ROLE_ONLY_TABLES.has(t));
    expect(unexplained).toEqual([]);
  });
});
