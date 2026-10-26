/**
 * Fausse base Supabase EN MÉMOIRE pour les tests de services (aucune dépendance de test).
 * Interprète les appels chaînés utilisés par les services C3 : select / insert / update /
 * upsert / delete, eq / neq / gte / lte / not, order, limit, maybeSingle / single, rpc.
 * Ce n'est pas Postgres : ni les contraintes SQL (CHECK, UNIQUE, RLS) ni les DEFAULT du schéma
 * (à passer explicitement dans `defaults`) ne sont simulés ; ils sont couverts par les tests
 * d'intégration (tests/integration).
 */
export type FakeRow = Record<string, unknown>;
interface Op {
  name: string;
  args: unknown[];
}

export function createFakeSupabase(initial: Record<string, FakeRow[]> = {}, defaults: Record<string, FakeRow> = {}) {
  const tables: Record<string, FakeRow[]> = {};
  for (const [name, rows] of Object.entries(initial)) tables[name] = rows.map((r) => ({ ...r }));
  const state = {
    seq: 0,
    failTables: new Set<string>(),
    /** Simule une course : le prochain insert dans cette table échoue (comme une contrainte UNIQUE) après avoir exécuté le rappel. */
    failNextInsert: new Map<string, () => void>(),
    rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
    rpcImpl: async (_name: string, _args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> => ({ data: null, error: null }),
  };
  const table = (name: string) => (tables[name] ??= []);

  // Colonne simple ou chemin JSON PostgREST « metadata->>social_key ».
  const readCell = (row: FakeRow, col: string): unknown => {
    if (!col.includes("->>")) return row[col];
    const [base = "", key = ""] = col.split("->>");
    const json = row[base] as Record<string, unknown> | null | undefined;
    return json ? json[key] : undefined;
  };

  function matches(row: FakeRow, ops: Op[]): boolean {
    for (const op of ops) {
      const [col, val] = op.args as [string, unknown, unknown?];
      const cell = readCell(row, col);
      if (op.name === "eq" && cell !== val) return false;
      if (op.name === "neq" && cell === val) return false;
      if (op.name === "gte" && !(String(cell) >= String(val))) return false;
      if (op.name === "lte" && !(String(cell) <= String(val))) return false;
      if (op.name === "not") {
        const [c, kind, v] = op.args as [string, string, unknown];
        if (kind === "is" && v === null && (readCell(row, c) === null || readCell(row, c) === undefined)) return false;
      }
    }
    return true;
  }

  function run(name: string, ops: Op[]): { data: unknown; error: { message: string } | null; count?: number } {
    if (state.failTables.has(name)) return { data: null, error: { message: "boom" } };
    const has = (n: string) => ops.find((o) => o.name === n);
    const wantsRows = Boolean(has("select"));
    const single = Boolean(has("single") || has("maybeSingle"));
    const filters = ops.filter((o) => ["eq", "neq", "gte", "lte", "not"].includes(o.name));
    const shape = (rows: FakeRow[]) => (single ? (rows[0] ?? null) : rows);

    const insert = has("insert");
    if (insert && state.failNextInsert.has(name)) {
      state.failNextInsert.get(name)!();
      state.failNextInsert.delete(name);
      return { data: null, error: { message: "duplicate key value violates unique constraint" } };
    }
    if (insert) {
      const input = insert.args[0];
      const rows = (Array.isArray(input) ? input : [input]) as FakeRow[];
      // Valeurs par défaut SQL (DEFAULT) à fournir par table : la fausse base ne lit pas le schéma.
      const created = rows.map((r) => ({ id: `id_${++state.seq}`, created_at: new Date().toISOString(), ...(defaults[name] ?? {}), ...r }));
      table(name).push(...created);
      return { data: wantsRows ? shape(created) : null, error: null };
    }
    const upsert = has("upsert");
    if (upsert) {
      const row = upsert.args[0] as FakeRow;
      const conflict = String((upsert.args[1] as { onConflict?: string } | undefined)?.onConflict ?? "id").split(",");
      const existing = table(name).find((r) => conflict.every((c) => r[c] === row[c]));
      if (existing) Object.assign(existing, row);
      else table(name).push({ id: `id_${++state.seq}`, ...row });
      return { data: null, error: null };
    }
    const update = has("update");
    if (update) {
      const targets = table(name).filter((r) => matches(r, filters));
      for (const r of targets) Object.assign(r, update.args[0] as FakeRow);
      return { data: wantsRows ? targets.map((r) => ({ id: r.id })) : null, error: null, count: targets.length };
    }
    if (has("delete")) {
      const before = table(name).length;
      tables[name] = table(name).filter((r) => !matches(r, filters));
      return { data: null, error: null, count: before - tables[name].length };
    }

    let rows = table(name).filter((r) => matches(r, filters));
    const order = has("order");
    if (order) {
      const col = String(order.args[0]);
      const asc = (order.args[1] as { ascending?: boolean } | undefined)?.ascending !== false;
      rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
    }
    const limit = has("limit");
    if (limit) rows = rows.slice(0, Number(limit.args[0]));
    if (has("single") && rows.length === 0) return { data: null, error: { message: "no rows" } };
    return { data: shape(rows), error: null };
  }

  const client = {
    from(name: string) {
      const ops: Op[] = [];
      const chain: unknown = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === "then") return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(run(name, ops)).then(resolve, reject);
            return (...args: unknown[]) => {
              ops.push({ name: prop, args });
              return chain;
            };
          },
        },
      );
      return chain;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      state.rpcCalls.push({ name, args });
      return state.rpcImpl(name, args);
    },
  };

  return { client, tables, state };
}
