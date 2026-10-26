/**
 * C3 — test RÉEL de la recherche produit (0140_c3_product_search.sql) contre
 * une vraie instance Supabase. Même règle que tenant-isolation.test.ts :
 * projet Supabase DÉDIÉ aux tests, jamais production ; sans les 3 variables
 * SUPABASE_TEST_*, toute la suite est sautée.
 *
 *   npm run test:integration
 *
 * Ce test est la seule vérification du SQL (classement, fautes de frappe,
 * accents, filtres, isolation entre tenants, droits d'exécution) : les tests
 * unitaires mockent la base.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL_ = process.env.SUPABASE_TEST_URL;
const ANON = process.env.SUPABASE_TEST_ANON_KEY;
const SERVICE = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const hasCredentials = Boolean(URL_ && ANON && SERVICE);
const pointsAtAppEnv = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.NEXT_PUBLIC_SUPABASE_URL === URL_;
const canRun = hasCredentials && !pointsAtAppEnv;
if (hasCredentials && pointsAtAppEnv) {
  console.error("c3-product-search.test.ts : SUPABASE_TEST_URL == NEXT_PUBLIC_SUPABASE_URL — suite SAUTÉE par sécurité (utilise un projet de test dédié).");
}

type Hit = { id: string; name: string; unit_price: number | string; category_name: string | null; is_promo: boolean; score: number };

describe.skipIf(!canRun)("Recherche produit assistant (Supabase réel)", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let orgA = "";
  let orgB = "";
  let catShoes = "";
  const ids: Record<string, string> = {};

  const search = async (org: string, terms: string[], extra: Record<string, unknown> = {}): Promise<Hit[]> => {
    const { data, error } = await service.rpc("search_products_for_assistant", { p_organization_id: org, p_terms: terms, ...extra });
    if (error) throw new Error(error.message);
    return (data ?? []) as Hit[];
  };
  const names = (hits: Hit[]) => hits.map((h) => h.name);

  async function insertProduct(org: string, key: string, fields: Record<string, unknown>) {
    const { data, error } = await service
      .from("products")
      .insert({ organization_id: org, status: "active", slug: `${key}-${Date.now()}`, ...fields })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Seed ${key}: ${error?.message}`);
    ids[key] = data.id as string;
  }

  beforeAll(async () => {
    service = createClient(URL_!, SERVICE!);
    anon = createClient(URL_!, ANON!);

    for (const label of ["A", "B"] as const) {
      const { data, error } = await service.from("organizations").insert({ name: `C3 search ${label}`, slug: `c3-search-${label.toLowerCase()}-${Date.now()}`, is_demo: true }).select("id").single();
      if (error || !data) throw new Error(`Setup org ${label}: ${error?.message}`);
      if (label === "A") orgA = data.id as string;
      else orgB = data.id as string;
    }

    const { data: cat, error: catError } = await service.from("categories").insert({ organization_id: orgA, name: "Chaussures", slug: `chaussures-${Date.now()}` }).select("id").single();
    if (catError || !cat) throw new Error(`Setup catégorie: ${catError?.message}`);
    catShoes = cat.id as string;

    await insertProduct(orgA, "derby", { name: "Derby cuir noir homme", unit_price: 24500, category_id: catShoes });
    await insertProduct(orgA, "mocassin", { name: "Mocassin marron homme", unit_price: 60000, category_id: catShoes });
    await insertProduct(orgA, "sac", { name: "Sac à main noir", unit_price: 15000 });
    await insertProduct(orgA, "specs", { name: "Sneakers Air Max", unit_price: 35000, category_id: catShoes, specifications: [{ label: "Couleur", value: "Noir" }] });
    await insertProduct(orgA, "draft", { name: "Derby brouillon noir", unit_price: 24000, status: "draft" });
    await insertProduct(orgA, "promo", { name: "Sandale cuir", unit_price: 9000, compare_at_price: 12000, category_id: catShoes });
    await insertProduct(orgB, "derbyB", { name: "Derby cuir noir homme", unit_price: 24500 });
  });

  afterAll(async () => {
    if (orgA) await service.from("organizations").delete().eq("id", orgA);
    if (orgB) await service.from("organizations").delete().eq("id", orgB);
  });

  it("« chaussures noires homme » : le derby noir passe devant le mocassin marron et le sac", async () => {
    const hits = await search(orgA, ["chaussure", "noire", "homme"]);
    expect(names(hits)[0]).toBe("Derby cuir noir homme");
    expect(names(hits)).not.toContain("Derby brouillon noir"); // statut draft jamais proposé
  });

  it("la couleur saisie dans les spécifications est trouvée (« noir »)", async () => {
    const hits = await search(orgA, ["sneakers", "noir"]);
    expect(names(hits)).toContain("Sneakers Air Max");
  });

  it("tolère une faute de frappe et ignore les accents / la casse", async () => {
    expect(names(await search(orgA, ["chausure"]))).toContain("Derby cuir noir homme"); // via la catégorie « Chaussures »
    expect(names(await search(orgA, ["NOIRE", "Chaussûres"]))).toContain("Derby cuir noir homme");
  });

  it("filtre de prix strict en base", async () => {
    const hits = await search(orgA, ["chaussure", "homme"], { p_min_price: 20000, p_max_price: 30000 });
    expect(names(hits)).toEqual(["Derby cuir noir homme"]);
  });

  it("promotion signalée seulement quand compare_at_price > prix", async () => {
    const hits = await search(orgA, ["sandale"]);
    expect(hits[0]?.name).toBe("Sandale cuir");
    expect(hits[0]?.is_promo).toBe(true);
    const derby = (await search(orgA, ["derby", "noir"])).find((h) => h.name === "Derby cuir noir homme");
    expect(derby?.is_promo).toBe(false);
  });

  it("mode parcours (aucun mot) : renvoie le catalogue actif, jamais un brouillon", async () => {
    const hits = await search(orgA, [], { p_limit: 20 });
    expect(hits.length).toBe(5);
    expect(names(hits)).not.toContain("Derby brouillon noir");
  });

  it("ISOLATION : l'organisation B n'apparaît jamais dans les résultats de A (et inversement)", async () => {
    const hitsA = await search(orgA, ["derby", "noir"], { p_limit: 20 });
    expect(hitsA.some((h) => h.id === ids.derbyB)).toBe(false);
    const hitsB = await search(orgB, ["derby", "noir"], { p_limit: 20 });
    expect(hitsB.map((h) => h.id)).toEqual([ids.derbyB]);
  });

  it("renommer une catégorie rafraîchit la recherche des produits concernés", async () => {
    await service.from("categories").update({ name: "Souliers" }).eq("id", catShoes);
    expect(names(await search(orgA, ["soulier"]))).toContain("Derby cuir noir homme");
    await service.from("categories").update({ name: "Chaussures" }).eq("id", catShoes);
  });

  it("DROITS : un client anon ne peut pas appeler la fonction (réservée au service-role)", async () => {
    const { error } = await anon.rpc("search_products_for_assistant", { p_organization_id: orgA, p_terms: ["derby"] });
    expect(error).not.toBeNull();
  });
});
