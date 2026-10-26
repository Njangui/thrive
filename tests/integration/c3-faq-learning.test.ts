/**
 * C3 — contraintes, fonctions et RLS réelles de 0143_c3_faq_learning.sql contre une vraie
 * instance Supabase. Mêmes garde-fous que tenant-isolation.test.ts : projet de TEST dédié,
 * jamais production ; sans les 3 variables SUPABASE_TEST_*, tout est sauté.
 *
 * Vérifie ce que les tests unitaires (qui simulent la base) ne peuvent pas :
 *  - valeurs par défaut (apprentissage désactivé, origine « owner ») et bornes CHECK ;
 *  - faq_record_hit : compte, n'écrit JAMAIS pour une FAQ d'une autre organisation, refusée à anon ;
 *  - purge du journal (30 jours, plancher de 7 jours) ;
 *  - RLS : un client anonyme ne voit aucune ligne des quatre tables ;
 *  - cascades (organisation, FAQ).
 * Les politiques « propriétaire/administrateur » nécessitent des sessions par rôle :
 * à couvrir avec les rôles de tenant-isolation.test.ts.
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
  console.error("c3-faq-learning.test.ts : SUPABASE_TEST_URL == NEXT_PUBLIC_SUPABASE_URL — suite SAUTÉE par sécurité (utilise un projet de test dédié).");
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe.skipIf(!canRun)("FAQ qui apprend (Supabase réel)", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let orgA = "";
  let orgB = "";
  let faqA = "";
  let faqB = "";

  async function newOrg(label: string): Promise<string> {
    const { data, error } = await service.from("organizations").insert({ name: `C3 faq ${label}`, slug: `c3-faq-${label.toLowerCase()}-${Date.now()}`, is_demo: true }).select("id").single();
    if (error || !data) throw new Error(`Setup org ${label}: ${error?.message}`);
    return data.id as string;
  }
  async function newFaq(org: string, question: string): Promise<string> {
    const { data, error } = await service.from("faqs").insert({ organization_id: org, question, answer: "Oui.", keywords: ["x"], is_active: true }).select("id").single();
    if (error || !data) throw new Error(`Setup faq: ${error?.message}`);
    return data.id as string;
  }

  beforeAll(async () => {
    service = createClient(URL_!, SERVICE!);
    anon = createClient(URL_!, ANON!);
    orgA = await newOrg("A");
    orgB = await newOrg("B");
    faqA = await newFaq(orgA, "Livrez-vous ?");
    faqB = await newFaq(orgB, "Horaires ?");
  });

  afterAll(async () => {
    if (orgA) await service.from("organizations").delete().eq("id", orgA);
    if (orgB) await service.from("organizations").delete().eq("id", orgB);
  });

  it("valeurs par défaut : origine « owner », pas de date de relecture ; apprentissage désactivé", async () => {
    const { data: faq } = await service.from("faqs").select("source, review_at").eq("id", faqA).single();
    expect(faq).toEqual({ source: "owner", review_at: null });
    await service.from("faq_learning_settings").insert({ organization_id: orgA });
    const { data: settings } = await service.from("faq_learning_settings").select("enabled, weekly_threshold").eq("organization_id", orgA).single();
    expect(settings).toEqual({ enabled: false, weekly_threshold: 3 });
  });

  it("bornes : seuil hebdomadaire entre 2 et 50, origine de FAQ connue", async () => {
    expect((await service.from("faq_learning_settings").update({ weekly_threshold: 1 }).eq("organization_id", orgA)).error).not.toBeNull();
    expect((await service.from("faq_learning_settings").update({ weekly_threshold: 51 }).eq("organization_id", orgA)).error).not.toBeNull();
    expect((await service.from("faq_learning_settings").update({ weekly_threshold: 5 }).eq("organization_id", orgA)).error).toBeNull();
    expect((await service.from("faqs").update({ source: "inconnue" }).eq("id", faqA)).error).not.toBeNull();
  });

  it("journal : au moins un mot, 200 caractères, résolution connue", async () => {
    const base = { organization_id: orgA, question: "Vous livrez ?", tokens: ["livrez"], resolution: "ai" };
    expect((await service.from("faq_question_log").insert({ ...base, tokens: [] })).error).not.toBeNull();
    expect((await service.from("faq_question_log").insert({ ...base, question: "x".repeat(201) })).error).not.toBeNull();
    expect((await service.from("faq_question_log").insert({ ...base, resolution: "human" })).error).not.toBeNull();
    expect((await service.from("faq_question_log").insert(base)).error).toBeNull();
  });

  it("proposition : signature non vide, décision datée", async () => {
    const base = { organization_id: orgA, question: "Vous livrez ?", signature: ["livrez"], keywords: ["livrez"] };
    expect((await service.from("faq_candidates").insert({ ...base, signature: [] })).error).not.toBeNull();
    expect((await service.from("faq_candidates").insert({ ...base, status: "approved" })).error).not.toBeNull();
    const ok = await service.from("faq_candidates").insert({ ...base, status: "approved", decided_at: new Date().toISOString() });
    expect(ok.error).toBeNull();
  });

  it("faq_record_hit : compte les usages du jour et met à jour le dernier usage", async () => {
    await service.rpc("faq_record_hit", { p_organization_id: orgA, p_faq_id: faqA });
    await service.rpc("faq_record_hit", { p_organization_id: orgA, p_faq_id: faqA });
    const { data } = await service.from("faq_hit_daily").select("hits").eq("faq_id", faqA);
    expect(data).toEqual([{ hits: 2 }]);
    const { data: faq } = await service.from("faqs").select("last_hit_at").eq("id", faqA).single();
    expect(faq?.last_hit_at).not.toBeNull();
  });

  it("ISOLATION : faq_record_hit n'écrit jamais pour une FAQ d'une autre organisation", async () => {
    await service.rpc("faq_record_hit", { p_organization_id: orgA, p_faq_id: faqB }); // org A + FAQ de B
    await service.rpc("faq_record_hit", { p_organization_id: orgB, p_faq_id: faqA }); // org B + FAQ de A
    expect((await service.from("faq_hit_daily").select("hits").eq("faq_id", faqB)).data).toEqual([]);
    expect((await service.from("faq_hit_daily").select("hits").eq("faq_id", faqA)).data).toEqual([{ hits: 2 }]); // inchangé
    expect((await service.from("faqs").select("last_hit_at").eq("id", faqB).single()).data?.last_hit_at).toBeNull();
  });

  it("DROITS : un client anonyme ne peut appeler ni faq_record_hit ni purge_faq_question_log", async () => {
    expect((await anon.rpc("faq_record_hit", { p_organization_id: orgA, p_faq_id: faqA })).error).not.toBeNull();
    expect((await anon.rpc("purge_faq_question_log", { p_days: 30 })).error).not.toBeNull();
  });

  it("purge : supprime au-delà de 30 jours, garde le récent, plancher de 7 jours", async () => {
    const row = (age: number, q: string) => ({ organization_id: orgA, question: q, tokens: ["purge"], resolution: "ai", created_at: daysAgo(age) });
    await service.from("faq_question_log").insert([row(40, "ancienne"), row(10, "dix jours"), row(3, "trois jours")]);
    const { data: deleted, error } = await service.rpc("purge_faq_question_log", { p_days: 30 });
    expect(error).toBeNull();
    expect(Number(deleted)).toBeGreaterThanOrEqual(1);
    const remaining = (await service.from("faq_question_log").select("question").eq("organization_id", orgA)).data?.map((r) => r.question) ?? [];
    expect(remaining).not.toContain("ancienne");
    expect(remaining).toContain("dix jours");

    await service.rpc("purge_faq_question_log", { p_days: 1 }); // demande 1 jour → plancher 7 jours
    const after = (await service.from("faq_question_log").select("question").eq("organization_id", orgA)).data?.map((r) => r.question) ?? [];
    expect(after).toContain("trois jours");
    expect(after).not.toContain("dix jours");
  });

  it("RLS : un client anonyme ne voit aucune ligne des quatre tables", async () => {
    for (const table of ["faq_learning_settings", "faq_question_log", "faq_candidates", "faq_hit_daily"]) {
      const { data } = await anon.from(table).select("*").eq("organization_id", orgA);
      expect(data ?? []).toEqual([]);
    }
  });

  it("supprimer une FAQ supprime ses compteurs ; supprimer l'organisation supprime tout (cascade)", async () => {
    await service.from("faqs").delete().eq("id", faqA);
    expect((await service.from("faq_hit_daily").select("hits").eq("faq_id", faqA)).data).toEqual([]);

    const tmp = await newOrg("tmp");
    await service.from("faq_learning_settings").insert({ organization_id: tmp });
    await service.from("faq_question_log").insert({ organization_id: tmp, question: "q", tokens: ["q"], resolution: "ai" });
    await service.from("organizations").delete().eq("id", tmp);
    for (const table of ["faq_learning_settings", "faq_question_log"]) {
      expect((await service.from(table).select("organization_id").eq("organization_id", tmp)).data).toEqual([]);
    }
  });
});
