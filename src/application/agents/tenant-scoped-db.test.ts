import { describe, expect, it } from "vitest";
import { createTenantScopedDb } from "./tenant-scoped-db";
import { FakeSupabase } from "./testing/fake-supabase";

const seed = () =>
  new FakeSupabase({
    orders: [
      { id: "o1", organization_id: "A", total: 1 },
      { id: "o2", organization_id: "B", total: 2 },
    ],
    organizations: [{ id: "A" }, { id: "B" }],
  });

describe("createTenantScopedDb", () => {
  it("select/update/delete sont filtrés sur le tenant", async () => {
    const fake = seed();
    const db = createTenantScopedDb(fake as never, "A");
    expect((await db.from("orders").select("*")).data).toEqual([{ id: "o1", organization_id: "A", total: 1 }]);
    await db.from("orders").update({ total: 9 });
    await db.from("orders").delete().eq("id", "o2");
    expect(fake.rows("orders")).toEqual([
      { id: "o1", organization_id: "A", total: 9 },
      { id: "o2", organization_id: "B", total: 2 },
    ]);
  });

  it("insert force le tenant ; une valeur contraire est refusée", async () => {
    const fake = seed();
    const db = createTenantScopedDb(fake as never, "A");
    await db.from("orders").insert([{ id: "o3" }, { id: "o4", organization_id: "A" }]);
    expect(fake.rows("orders").filter((r) => r.organization_id === "A")).toHaveLength(3);
    expect(() => db.from("orders").insert({ id: "o5", organization_id: "B" })).toThrow(/tenant/);
    expect(() => db.from("orders").update({ organization_id: "B" })).toThrow(/tenant/);
    expect(() => db.from("orders").upsert({ id: "o6", organization_id: "B" })).toThrow(/tenant/);
  });

  it("organizations se filtre par id ; tables sensibles et noms invalides interdits", async () => {
    const fake = seed();
    const db = createTenantScopedDb(fake as never, "A");
    expect((await db.from("organizations").select("*")).data).toEqual([{ id: "A" }]);
    expect(() => db.from("organizations").delete()).toThrow();
    expect(() => db.from("memberships").insert({ user_id: "u" })).toThrow();
    expect(() => db.from("pending_actions").update({ status: "approved" })).toThrow();
    expect(() => db.from("orders; drop table x")).toThrow();
    expect(() => createTenantScopedDb(fake as never, "")).toThrow();
  });
});
