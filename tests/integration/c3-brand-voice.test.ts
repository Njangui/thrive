/**
 * C3 — contraintes et RLS réelles de 0142_c3_brand_voice.sql contre une vraie
 * instance Supabase. Mêmes garde-fous que tenant-isolation.test.ts : projet de
 * TEST dédié, jamais production ; sans les 3 variables SUPABASE_TEST_*, tout est sauté.
 *
 * Vérifie ce que les tests unitaires (qui mockent la base) ne peuvent pas :
 *  - exemples de messages impossibles sans consentement (contrainte SQL) ;
 *  - un message prédéfini approuvé exige une date d'approbation ;
 *  - unicité (organisation, clé, ton, emojis) ;
 *  - un client anonyme ne voit aucune ligne (RLS) ;
 *  - suppression en cascade avec l'organisation.
 * Les politiques « propriétaire/administrateur écrit, membres lisent » nécessitent
 * des sessions utilisateurs : à couvrir avec les rôles de tenant-isolation.test.ts.
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
  console.error("c3-brand-voice.test.ts : SUPABASE_TEST_URL == NEXT_PUBLIC_SUPABASE_URL — suite SAUTÉE par sécurité (utilise un projet de test dédié).");
}

describe.skipIf(!canRun)("Voix de marque et messages prédéfinis (Supabase réel)", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let org = "";

  beforeAll(async () => {
    service = createClient(URL_!, SERVICE!);
    anon = createClient(URL_!, ANON!);
    const { data, error } = await service.from("organizations").insert({ name: "C3 voice", slug: `c3-voice-${Date.now()}`, is_demo: true }).select("id").single();
    if (error || !data) throw new Error(`Setup org: ${error?.message}`);
    org = data.id as string;
  });

  afterAll(async () => {
    if (org) await service.from("organizations").delete().eq("id", org);
  });

  it("refuse des exemples de messages sans consentement (contrainte en base)", async () => {
    const { error } = await service.from("brand_voice_profiles").insert({ organization_id: org, example_messages: ["Salut"], examples_consent: false });
    expect(error).not.toBeNull();
  });

  it("accepte le profil avec consentement, avec valeurs par défaut vouvoiement / emojis légers", async () => {
    const { error } = await service.from("brand_voice_profiles").insert({ organization_id: org, example_messages: ["Salut"], examples_consent: true, examples_consent_at: new Date().toISOString() });
    expect(error).toBeNull();
    const { data } = await service.from("brand_voice_profiles").select("register, emoji_level").eq("organization_id", org).single();
    expect(data).toEqual({ register: "vous", emoji_level: "light" });
  });

  it("refuse un registre ou un niveau d'emojis hors liste", async () => {
    const { error } = await service.from("brand_voice_profiles").update({ register: "toi" }).eq("organization_id", org);
    expect(error).not.toBeNull();
  });

  it("limite à 10 exemples", async () => {
    const { error } = await service.from("brand_voice_profiles").update({ example_messages: Array.from({ length: 11 }, (_, i) => `m${i}`) }).eq("organization_id", org);
    expect(error).not.toBeNull();
  });

  it("un message approuvé exige une date d'approbation ; unicité par (clé, ton, emojis)", async () => {
    const base = { organization_id: org, key: "goodbye", body: "À bientôt", register: "any", emoji_level: "any" };
    expect((await service.from("predefined_messages").insert({ ...base, status: "approved" })).error).not.toBeNull();
    expect((await service.from("predefined_messages").insert({ ...base, status: "approved", approved_at: new Date().toISOString() })).error).toBeNull();
    expect((await service.from("predefined_messages").insert({ ...base, status: "draft" })).error).not.toBeNull(); // doublon
    expect((await service.from("predefined_messages").insert({ ...base, register: "tu", status: "draft" })).error).toBeNull(); // autre ton : autorisé
  });

  it("RLS : un client anonyme ne voit aucune ligne des deux tables", async () => {
    const voices = await anon.from("brand_voice_profiles").select("*").eq("organization_id", org);
    const messages = await anon.from("predefined_messages").select("*").eq("organization_id", org);
    expect(voices.data ?? []).toEqual([]);
    expect(messages.data ?? []).toEqual([]);
  });

  it("supprimer l'organisation supprime profil et messages (cascade)", async () => {
    const { data: tmp } = await service.from("organizations").insert({ name: "C3 voice tmp", slug: `c3-voice-tmp-${Date.now()}`, is_demo: true }).select("id").single();
    const id = tmp!.id as string;
    await service.from("brand_voice_profiles").insert({ organization_id: id });
    await service.from("predefined_messages").insert({ organization_id: id, key: "thanks", body: "De rien" });
    await service.from("organizations").delete().eq("id", id);
    expect((await service.from("brand_voice_profiles").select("organization_id").eq("organization_id", id)).data).toEqual([]);
    expect((await service.from("predefined_messages").select("id").eq("organization_id", id)).data).toEqual([]);
  });
});
