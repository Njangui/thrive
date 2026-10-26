import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeDb } from "../../../tests/helpers/fake-supabase";
import { findContacts, listLowStock } from "./ops-lookup-service";

vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: () => ({}) }));

const mk = () => {
  const db = new FakeDb();
  db.seed("contacts", [
    { id: "c1", organization_id: "o1", full_name: "Awa Ngono", phone_e164: "+237699000001" },
    { id: "c2", organization_id: "o1", full_name: "Paul Awa", phone_e164: "+237677000002" },
    { id: "c3", organization_id: "o2", full_name: "Awa Autre", phone_e164: "+237699000001" },
  ]);
  db.seed("products", [
    { id: "p1", organization_id: "o1", name: "Savon", current_stock: 2, min_stock: 5, status: "active" },
    { id: "p2", organization_id: "o1", name: "Huile", current_stock: 50, min_stock: 5, status: "active" },
    { id: "p3", organization_id: "o1", name: "Sans seuil", current_stock: 0, min_stock: 0, status: "active" },
    { id: "p4", organization_id: "o1", name: "Brouillon", current_stock: 0, min_stock: 5, status: "draft" },
    { id: "p5", organization_id: "o2", name: "Autre", current_stock: 0, min_stock: 5, status: "active" },
  ]);
  return db as unknown as SupabaseClient;
};

describe("findContacts", () => {
  it("par nom ou téléphone, dédoublonné, limité à l'entreprise", async () => {
    const r = await findContacts("o1", "awa", 5, mk());
    expect(r.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect((await findContacts("o1", "699000001", 5, mk())).map((c) => c.id)).toEqual(["c1"]);
  });
  it("requête trop courte : rien ; caractères spéciaux neutralisés", async () => {
    expect(await findContacts("o1", "a", 5, mk())).toEqual([]);
    expect(await findContacts("o1", "%,)", 5, mk())).toEqual([]);
  });
});

describe("listLowStock", () => {
  it("stock <= seuil (seuil > 0), produits actifs, une seule entreprise", async () => {
    expect((await listLowStock("o1", 20, mk())).map((p) => p.id)).toEqual(["p1"]);
  });
});
