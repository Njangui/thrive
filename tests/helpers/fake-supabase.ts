/**
 * Faux client Supabase en mémoire pour les tests unitaires (C2).
 * Couvre exactement ce qu'utilisent channel-identity-service et
 * supabase-step-up-adapter : select/insert/update/delete/upsert, filtres
 * eq/gt/gte/is/in, maybeSingle/single, count head, et rpc() scriptables.
 * Les jointures `table!inner(...)` ne sont PAS simulées : les lignes de test
 * portent déjà les objets embarqués (`memberships`, `organizations`).
 */
type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export interface FakeResult {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

export class FakeDb {
  tables: Record<string, Row[]> = {};
  rpcHandlers: Record<string, (args: Record<string, unknown>) => FakeResult | Promise<FakeResult>> = {};
  rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  insertErrors: Record<string, { message: string } | undefined> = {};
  /** Valeurs par défaut de colonnes (émule les `default` SQL) appliquées à l'insert, par table. */
  defaults: Record<string, Row> = {};
  /** Index uniques partiels émulés à l'insert (code 23505) : colonnes + condition optionnelle. */
  uniques: Record<string, { cols: string[]; where?: (r: Row) => boolean }[]> = {};
  private seq = 0;

  /** Horodatage monotone (1 s d'écart par appel) : tris `order by created_at` déterministes. */
  tick(): string {
    this.seq += 1;
    return new Date(Date.UTC(2026, 0, 1) + this.seq * 1000).toISOString();
  }

  seed(table: string, rows: Row[]): this {
    this.tables[table] = [...(this.tables[table] ?? []), ...rows.map((r) => ({ ...r }))];
    return this;
  }

  rows(table: string): Row[] {
    return this.tables[table] ?? [];
  }

  nextId(): string {
    this.seq += 1;
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`;
  }

  from(table: string): Query {
    return new Query(this, table);
  }

  async rpc(name: string, args: Record<string, unknown>): Promise<FakeResult> {
    this.rpcCalls.push({ name, args });
    const handler = this.rpcHandlers[name];
    if (!handler) return { data: null, error: { message: `rpc ${name} non scriptée` } };
    return handler(args);
  }
}

class Query implements PromiseLike<FakeResult> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: Row | undefined;
  private wantsRows = false;
  private head = false;
  private countMode = false;
  private upsertKey: string | undefined;
  private orderBy: { col: string; asc: boolean } | undefined;
  private limitN: number | undefined;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }): this {
    if (this.op === "select") this.wantsRows = true;
    else this.wantsRows = true;
    if (opts?.count) this.countMode = true;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(row: Row | Row[]): this { this.op = "insert"; this.payload = row as Row; return this; }
  update(patch: Row): this { this.op = "update"; this.payload = patch; return this; }
  delete(): this { this.op = "delete"; return this; }
  upsert(row: Row, opts?: { onConflict?: string }): this { this.op = "upsert"; this.payload = row; this.upsertKey = opts?.onConflict; return this; }

  order(col: string, opts?: { ascending?: boolean }): this { this.orderBy = { col, asc: opts?.ascending !== false }; return this; }
  limit(n: number): this { this.limitN = n; return this; }

  eq(col: string, val: unknown): this { this.filters.push((r) => r[col] === val); return this; }
  in(col: string, vals: unknown[]): this { this.filters.push((r) => vals.includes(r[col])); return this; }
  is(col: string, val: unknown): this { this.filters.push((r) => (r[col] ?? null) === val); return this; }
  gt(col: string, val: unknown): this { this.filters.push((r) => String(r[col]) > String(val)); return this; }
  gte(col: string, val: unknown): this { this.filters.push((r) => String(r[col]) >= String(val)); return this; }
  ilike(col: string, pattern: string): this { const needle = pattern.replace(/%/g, "").toLowerCase(); this.filters.push((r) => String(r[col] ?? "").toLowerCase().includes(needle)); return this; }
  lte(col: string, val: unknown): this { this.filters.push((r) => r[col] != null && String(r[col]) <= String(val)); return this; }

  async maybeSingle(): Promise<FakeResult> {
    const res = await this.run();
    const list = (res.data as Row[] | null) ?? [];
    return { data: list[0] ?? null, error: res.error };
  }
  async single(): Promise<FakeResult> {
    const res = await this.run();
    const list = (res.data as Row[] | null) ?? [];
    return list[0] ? { data: list[0], error: res.error } : { data: null, error: res.error ?? { message: "no rows" } };
  }
  then<T1 = FakeResult, T2 = never>(
    onfulfilled?: ((value: FakeResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => f(row));
  }

  private async run(): Promise<FakeResult> {
    const table = (this.db.tables[this.table] ??= []);
    switch (this.op) {
      case "select": {
        let found = table.filter((r) => this.matches(r));
        if (this.orderBy) {
          const { col, asc } = this.orderBy;
          found = [...found].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
        }
        if (this.limitN !== undefined) found = found.slice(0, this.limitN);
        if (this.head) return { data: null, error: null, count: found.length };
        return { data: found.map((r) => ({ ...r })), error: null, count: this.countMode ? found.length : null };
      }
      case "insert": {
        const err = this.db.insertErrors[this.table];
        if (err) return { data: null, error: err };
        const batch = (Array.isArray(this.payload) ? (this.payload as unknown as Row[]) : [this.payload as Row]);
        const inserted: Row[] = [];
        for (const item of batch) {
          const row: Row = { id: this.db.nextId(), created_at: this.db.tick(), ...(this.db.defaults[this.table] ?? {}), ...item };
          for (const u of this.db.uniques[this.table] ?? []) {
            if (u.where && !u.where(row)) continue;
            if (table.some((r) => (!u.where || u.where(r)) && u.cols.every((c) => r[c] === row[c]))) {
              return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
            }
          }
          table.push(row);
          inserted.push(row);
        }
        return { data: this.wantsRows ? inserted.map((r) => ({ ...r })) : null, error: null };
      }
      case "upsert": {
        const keys = (this.upsertKey ?? "id").split(",");
        const existing = table.find((r) => keys.every((k) => r[k] === this.payload![k]));
        if (existing) Object.assign(existing, this.payload);
        else table.push({ ...this.payload });
        return { data: null, error: null };
      }
      case "update": {
        const hit = table.filter((r) => this.matches(r));
        hit.forEach((r) => Object.assign(r, this.payload));
        return { data: this.wantsRows ? hit.map((r) => ({ ...r })) : null, error: null };
      }
      case "delete": {
        const keep = table.filter((r) => !this.matches(r));
        const removed = table.length - keep.length;
        this.db.tables[this.table] = keep;
        return { data: this.wantsRows ? [] : null, error: null, count: removed };
      }
    }
  }
}
