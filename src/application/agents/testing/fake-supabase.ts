/** Faux client supabase-js minimal (select/insert/update/delete + eq) pour tester l'isolation. */
type Row = Record<string, unknown>;

class FakeQuery implements PromiseLike<{ data: Row[]; error: null }> {
  private filters: Array<[string, unknown]> = [];
  constructor(
    private readonly store: Map<string, Row[]>,
    private readonly table: string,
    private readonly op: "select" | "insert" | "update" | "delete",
    private readonly payload?: Row | Row[],
    private readonly columns?: string,
  ) {}

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every(([column, value]) => row[column] === value);
  }

  private exec(): Row[] {
    const rows = this.store.get(this.table) ?? [];
    switch (this.op) {
      case "select":
        return rows.filter((r) => this.matches(r)).map((r) => ({ ...r }));
      case "insert": {
        const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload as Row]).map((r) => ({ ...r }));
        rows.push(...incoming);
        this.store.set(this.table, rows);
        return incoming;
      }
      case "update":
        return rows.filter((r) => this.matches(r)).map((r) => Object.assign(r, this.payload as Row));
      case "delete": {
        const kept = rows.filter((r) => !this.matches(r));
        const removed = rows.filter((r) => this.matches(r));
        this.store.set(this.table, kept);
        return removed;
      }
    }
  }

  then<R1 = { data: Row[]; error: null }, R2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve({ data: this.exec(), error: null as null }).then(onfulfilled, onrejected);
  }
}

export class FakeSupabase {
  readonly store = new Map<string, Row[]>();
  constructor(seed: Record<string, Row[]> = {}) {
    for (const [table, rows] of Object.entries(seed)) this.store.set(table, rows.map((r) => ({ ...r })));
  }
  rows(table: string): Row[] {
    return this.store.get(table) ?? [];
  }
  from(table: string) {
    return {
      select: (columns?: string) => new FakeQuery(this.store, table, "select", undefined, columns),
      insert: (payload: Row | Row[]) => new FakeQuery(this.store, table, "insert", payload),
      upsert: (payload: Row | Row[]) => new FakeQuery(this.store, table, "insert", payload),
      update: (payload: Row) => new FakeQuery(this.store, table, "update", payload),
      delete: () => new FakeQuery(this.store, table, "delete"),
    };
  }
}
