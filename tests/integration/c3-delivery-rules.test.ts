/**
 * C3 — contraintes et RLS réelles de 0145_c3_delivery_rules.sql contre une vraie instance
 * Supabase. Mêmes garde-fous que tenant-isolation.test.ts : projet de TEST dédié, jamais
 * production ; sans les 3 variables SUPABASE_TEST_*, tout est sauté.
 *
 * Vérifie ce que les tests unitaires (qui simulent la base) ne peuvent pas : valeurs par défaut,
 * bornes CHECK (un frais négatif ou une zone « gratuite avec frais » doivent être impossibles),
 * unicité par entreprise, « non renseigné » = NULL, RLS anonyme, cascade.
 * Les politiques « membres lisent / propriétaire-administrateur écrit » nécessitent des sessions
 * par rôle : à couvrir avec les rôles de tenant-isolation.test.ts.
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
  console.error("c3-delivery-rules.test.ts : SUPABASE_TEST_URL == NEXT_PUBLIC_SUPABASE_URL — suite SAUTÉE par sécurité (utilise un projet de test dédié).");
}

describe.skipIf(!canRun)("Règles de livraison (Supabase réel)", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let orgA = "";
  let orgB = "";

  async function newOrg(label: string): Promise<string> {
    const { data, error } = await service.from("organizations").insert({ name: `C3 delivery ${label}`, slug: `c3-delivery-${label.toLowerCase()}-${Date.now()}`, is_demo: true }).select("id").single();
    if (error || !data) throw new Error(`Setup org ${label}: ${error?.message}`);
    return data.id as string;
  }
  const zone = (org: string, over: Record<string, unknown> = {}) => ({ organization_id: org, name: "Douala", slug: "douala", ...over });

  beforeAll(async () => {
    service = createClient(URL_!, SERVICE!);
    anon = createClient(URL_!, ANON!);
    orgA = await newOrg("A");
    orgB = await newOrg("B");
  });

  afterAll(async () => {
    if (orgA) await service.from("organizations").delete().eq("id", orgA);
    if (orgB) await service.from("organizations").delete().eq("id", orgB);
  });

  it("zone : active, payante par défaut, sans alias ; frais et délai « non renseignés » = NULL", async () => {
    expect((await service.from("delivery_zones").insert(zone(orgA))).error).toBeNull();
    const { data } = await service.from("delivery_zones").select("aliases, fee_amount, is_free, free_above_amount, eta_text, is_active").eq("organization_id", orgA).eq("slug", "douala").single();
    expect(data).toEqual({ aliases: [], fee_amount: null, is_free: false, free_above_amount: null, eta_text: null, is_active: true });
  });

  it("bornes : frais positifs, seuil de gratuité > 0, identifiant propre, 10 alias, délai ≤ 80 caractères", async () => {
    const bad = (over: Record<string, unknown>) => service.from("delivery_zones").insert(zone(orgA, { slug: `z-${Math.random().toString(36).slice(2, 8)}`, ...over }));
    expect((await bad({ fee_amount: -1 })).error).not.toBeNull();
    expect((await bad({ free_above_amount: 0 })).error).not.toBeNull();
    expect((await bad({ slug: "Douala Nord" })).error).not.toBeNull();
    expect((await bad({ slug: "-douala" })).error).not.toBeNull();
    expect((await bad({ aliases: Array.from({ length: 11 }, (_, i) => `a${i}`) })).error).not.toBeNull();
    expect((await bad({ eta_text: "x".repeat(81) })).error).not.toBeNull();
    expect((await bad({ name: "" })).error).not.toBeNull();
  });

  it("une zone gratuite ne peut pas avoir de frais (impossible en base, pas seulement en code)", async () => {
    expect((await service.from("delivery_zones").insert(zone(orgA, { slug: "akwa", name: "Akwa", is_free: true, fee_amount: 500 }))).error).not.toBeNull();
    expect((await service.from("delivery_zones").insert(zone(orgA, { slug: "akwa", name: "Akwa", is_free: true, fee_amount: 0 }))).error).toBeNull();
    expect((await service.from("delivery_zones").insert(zone(orgA, { slug: "bali", name: "Bali", is_free: true }))).error).toBeNull();
  });

  it("une zone par identifiant et par entreprise ; la même zone chez une autre entreprise est autorisée", async () => {
    expect((await service.from("delivery_zones").insert(zone(orgA))).error).not.toBeNull();
    expect((await service.from("delivery_zones").insert(zone(orgB))).error).toBeNull();
  });

  it("réglages : retrait et paiement à la livraison « non renseignés » = NULL (jamais faux par défaut)", async () => {
    expect((await service.from("delivery_settings").insert({ organization_id: orgA })).error).toBeNull();
    const { data } = await service.from("delivery_settings").select("pickup_available, pickup_note, accepts_cash_on_delivery").eq("organization_id", orgA).single();
    expect(data).toEqual({ pickup_available: null, pickup_note: null, accepts_cash_on_delivery: null });
    expect((await service.from("delivery_settings").update({ pickup_note: "x".repeat(201) }).eq("organization_id", orgA)).error).not.toBeNull();
  });

  it("RLS : un client anonyme ne voit aucune zone ni aucun réglage", async () => {
    for (const table of ["delivery_zones", "delivery_settings"]) {
      const { data } = await anon.from(table).select("*").eq("organization_id", orgA);
      expect(data ?? []).toEqual([]);
    }
  });

  it("supprimer l'organisation supprime ses zones et réglages (cascade)", async () => {
    const tmp = await newOrg("tmp");
    await service.from("delivery_zones").insert(zone(tmp));
    await service.from("delivery_settings").insert({ organization_id: tmp });
    await service.from("organizations").delete().eq("id", tmp);
    for (const table of ["delivery_zones", "delivery_settings"]) {
      expect((await service.from(table).select("organization_id").eq("organization_id", tmp)).data).toEqual([]);
    }
  });
});
