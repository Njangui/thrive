import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: () => ({}) }));
import {
  applyProspectingTemplateStatus, approveCampaign, createCampaignFromCsv, ensureProspectingTemplates, previewCampaign, recordProspectInbound, runProspectingTick, setCampaignStatus,
  type ProspectingDeps,
} from "./prospecting-service";
import { makeProspectingStore as makeStore } from "@/application/agents/testing/in-memory-prospecting";

const ORG = "org-flexco";
const OWNER = "user-1";

const CSV = (count: number) => ["nom;téléphone;entreprise", ...Array.from({ length: count }, (_, i) => `Contact${i};6${String(70000000 + i)};Ent${i}`)].join("\n");
// Lundi 26/10/2026 11h00 à Douala (UTC+1)
const MON_11H = new Date("2026-10-26T10:00:00Z");

let clock = MON_11H;
let sent: { phone: string; template: string; params: string[] }[] = [];
let failNext = 0;
let notified: string[] = [];
let env: ReturnType<typeof makeStore>;
let deps: ProspectingDeps;

beforeEach(() => {
  clock = MON_11H; sent = []; failNext = 0; notified = [];
  env = makeStore();
  deps = {
    store: env.store,
    getAccountId: async () => "acc1",
    sendTemplate: async (i) => { if (failNext > 0) { failNext--; throw new Error("meta refuse"); } sent.push({ phone: i.participantId, template: i.templateName, params: i.templateParams }); },
    createTemplate: async () => ({ id: "t1", status: "PENDING" }),
    notify: async (_o, title) => { notified.push(title); },
    now: () => clock,
  };
});

async function approvedCampaign(count = 3, opts: { dailyCap?: number } = {}) {
  const s = await createCampaignFromCsv(ORG, OWNER, { name: "Test", csv: CSV(count), ...opts }, deps);
  env.templates.intro = "APPROVED"; env.templates.followup = "APPROVED";
  const preview = await previewCampaign(ORG, s.campaignId, deps);
  await approveCampaign(ORG, OWNER, s.campaignId, { fingerprint: preview.fingerprint, consentBasis: "Clients ayant demandé des informations en boutique" }, deps);
  return s.campaignId;
}

describe("création et import", () => {
  it("refuse un fichier sans numéro valide ou sans colonne téléphone", async () => {
    await expect(createCampaignFromCsv(ORG, OWNER, { name: "x", csv: "nom,ville\nA,B" }, deps)).rejects.toThrow(/colonne de téléphone/);
    await expect(createCampaignFromCsv(ORG, OWNER, { name: "x", csv: "tel\nabc" }, deps)).rejects.toThrow(/Aucun numéro valide/);
  });
  it("refuse un plafond hors bornes", async () => {
    await expect(createCampaignFromCsv(ORG, OWNER, { name: "x", csv: CSV(1), dailyCap: 5000 }, deps)).rejects.toThrow(/Plafond/);
  });
  it("les numéros déjà désinscrits ne sont pas importés", async () => {
    env.optOuts.add("+237670000001");
    const s = await createCampaignFromCsv(ORG, OWNER, { name: "x", csv: CSV(3) }, deps);
    expect(s.imported).toBe(2);
    expect(s.optedOut).toBe(1);
  });
});

describe("validation par le propriétaire", () => {
  it("l'aperçu montre le texte exact, les règles et l'état des modèles", async () => {
    const s = await createCampaignFromCsv(ORG, OWNER, { name: "x", csv: CSV(3) }, deps);
    const p = await previewCampaign(ORG, s.campaignId, deps);
    expect(p.samples[0]!.intro).toMatch(/^Bonjour Contact0, ici l'équipe Flexco/);
    expect(p.rules.join(" ")).toMatch(/STOP/);
    expect(p.templatesReady).toBe(false);
  });
  it("refus sans base de contact, ou si la liste a changé depuis l'aperçu", async () => {
    const s = await createCampaignFromCsv(ORG, OWNER, { name: "x", csv: CSV(3) }, deps);
    const p = await previewCampaign(ORG, s.campaignId, deps);
    await expect(approveCampaign(ORG, OWNER, s.campaignId, { fingerprint: p.fingerprint, consentBasis: "court" }, deps)).rejects.toThrow(/base de contact/);
    await env.store.insertProspects(ORG, s.campaignId, [{ fullName: "Intrus", company: null, sector: null, city: null, phoneE164: "+237655999888", email: null, extra: {} }]);
    await expect(approveCampaign(ORG, OWNER, s.campaignId, { fingerprint: p.fingerprint, consentBasis: "Clients ayant demandé des informations" }, deps)).rejects.toThrow(/ont changé/);
  });
  it("isolation : une autre organisation ne voit ni ne valide la campagne", async () => {
    const s = await createCampaignFromCsv(ORG, OWNER, { name: "x", csv: CSV(1) }, deps);
    await expect(previewCampaign("autre-org", s.campaignId, deps)).rejects.toThrow(/introuvable/);
  });
});

describe("envoi", () => {
  it("rien ne part sans validation", async () => {
    await createCampaignFromCsv(ORG, OWNER, { name: "x", csv: CSV(3) }, deps);
    env.templates.intro = "APPROVED";
    await runProspectingTick(deps);
    expect(sent).toEqual([]);
  });
  it("envoie le modèle avec le prénom, jamais de texte libre", async () => {
    await approvedCampaign(2);
    const r = await runProspectingTick(deps);
    expect(r.sent).toBe(2);
    expect(sent.map((s) => s.template)).toEqual(["flexco_prospection_v1", "flexco_prospection_v1"]);
    expect(sent[0]!.params).toEqual(["Contact0"]);
    expect(sent[0]!.phone).toBe("237670000000");
  });
  it("modèle non approuvé : aucun envoi", async () => {
    await approvedCampaign(2);
    env.templates.intro = "PENDING";
    await runProspectingTick(deps);
    expect(sent).toEqual([]);
  });
  it("hors plage horaire et le dimanche : aucun envoi", async () => {
    await approvedCampaign(2);
    clock = new Date("2026-10-26T19:30:00Z"); // 20h30 Douala
    await runProspectingTick(deps);
    clock = new Date("2026-10-25T10:00:00Z"); // dimanche
    await runProspectingTick(deps);
    expect(sent).toEqual([]);
  });
  it("plafond quotidien respecté sur plusieurs passages, reprend le lendemain", async () => {
    await approvedCampaign(10, { dailyCap: 4 });
    await runProspectingTick(deps);
    await runProspectingTick(deps);
    expect(sent).toHaveLength(4);
    clock = new Date("2026-10-27T10:00:00Z");
    await runProspectingTick(deps);
    expect(sent).toHaveLength(8);
  });
  it("une relance et une seule, après le délai, uniquement sans réponse", async () => {
    await approvedCampaign(2, { dailyCap: 50 });
    await runProspectingTick(deps);
    expect(sent).toHaveLength(2);
    await recordProspectInbound(ORG, "+237670000000", "Bonjour, qui êtes-vous ?", deps); // répond
    clock = new Date("2026-10-27T10:00:00Z"); // 1 jour : trop tôt
    await runProspectingTick(deps);
    expect(sent).toHaveLength(2);
    clock = new Date("2026-10-29T11:00:00Z"); // > 72 h
    await runProspectingTick(deps);
    const followups = sent.filter((s) => s.template === "flexco_relance_v1");
    expect(followups).toHaveLength(1);
    expect(followups[0]!.phone).toBe("237670000001"); // pas celui qui a répondu
    clock = new Date("2026-11-05T10:00:00Z");
    await runProspectingTick(deps);
    expect(sent.filter((s) => s.template === "flexco_relance_v1")).toHaveLength(1);
  });
  it("campagne terminée quand tout est traité", async () => {
    const id = await approvedCampaign(1);
    await runProspectingTick(deps);
    clock = new Date("2026-10-29T11:00:00Z");
    const r = await runProspectingTick(deps);
    expect(r.completed).toBe(1);
    expect(env.campaigns.get(id)!.status).toBe("completed");
  });
  it("trois échecs d'affilée : campagne suspendue, propriétaire prévenu, pas d'insistance", async () => {
    const id = await approvedCampaign(10);
    failNext = 99;
    const r = await runProspectingTick(deps);
    expect(r.paused).toBe(1);
    expect(env.campaigns.get(id)!.status).toBe("paused");
    expect(notified).toContain("Campagne de prospection suspendue");
    expect(env.prospects.filter((p) => p.status === "failed")).toHaveLength(3);
  });
  it("liste modifiée après validation : suspendue sans envoi", async () => {
    const id = await approvedCampaign(2);
    await env.store.insertProspects(ORG, id, [{ fullName: null, company: null, sector: null, city: null, phoneE164: "+237655111222", email: null, extra: {} }]);
    const r = await runProspectingTick(deps);
    expect(r.paused).toBe(1);
    expect(sent).toEqual([]);
    await expect(setCampaignStatus(ORG, id, "resume", deps)).rejects.toThrow(/validation n'est plus valable/);
  });
  it("STOP reçu entre deux passages : jamais recontacté, même dans une autre campagne", async () => {
    await approvedCampaign(2, { dailyCap: 1 });
    await runProspectingTick(deps); // contacte Contact0
    const out = await recordProspectInbound(ORG, "+237670000000", "STOP", deps);
    expect(out).toEqual({ isProspect: true, kind: "opt_out" });
    clock = new Date("2026-10-29T11:00:00Z");
    await runProspectingTick(deps);
    expect(sent.filter((s) => s.phone === "237670000000")).toHaveLength(1); // pas de relance
    const second = await createCampaignFromCsv(ORG, OWNER, { name: "bis", csv: CSV(2) }, deps);
    expect(second.imported).toBe(1);
    expect(second.optedOut).toBe(1);
  });
  it("opt-out enregistré juste avant l'envoi : le numéro est écarté", async () => {
    await approvedCampaign(2);
    env.optOuts.add("+237670000000");
    await runProspectingTick(deps);
    expect(sent.map((s) => s.phone)).toEqual(["237670000001"]);
    expect(env.prospects.find((p) => p.phoneE164 === "+237670000000")!.status).toBe("opted_out");
  });
  it("pause : plus aucun envoi ; annulation définitive", async () => {
    const id = await approvedCampaign(3);
    await setCampaignStatus(ORG, id, "pause", deps);
    await runProspectingTick(deps);
    expect(sent).toEqual([]);
    await setCampaignStatus(ORG, id, "resume", deps);
    await setCampaignStatus(ORG, id, "cancel", deps);
    await runProspectingTick(deps);
    expect(sent).toEqual([]);
    await expect(setCampaignStatus(ORG, id, "resume", deps)).rejects.toThrow(/terminée/);
  });
});

describe("réponses entrantes", () => {
  it("numéro inconnu : pas un prospect (flux client normal)", async () => {
    await approvedCampaign(1);
    expect(await recordProspectInbound(ORG, "+237699000000", "Bonjour", deps)).toEqual({ isProspect: false });
  });
  it("refus : désinscrit définitivement ; intérêt : marqué intéressé", async () => {
    await approvedCampaign(2);
    expect(await recordProspectInbound(ORG, "+237670000000", "Je ne suis pas intéressé", deps)).toEqual({ isProspect: true, kind: "refusal" });
    expect(env.optOuts.has("+237670000000")).toBe(true);
    expect(await recordProspectInbound(ORG, "+237670000001", "OUI présentez-moi", deps)).toEqual({ isProspect: true, kind: "interested" });
    expect(env.prospects.find((p) => p.phoneE164 === "+237670000001")!.status).toBe("interested");
  });
});

describe("modèles Meta", () => {
  it("soumission idempotente", async () => {
    const a = await ensureProspectingTemplates(ORG, deps);
    expect(a.submitted).toEqual(["intro", "followup"]);
    const b = await ensureProspectingTemplates(ORG, deps);
    expect(b.submitted).toEqual([]);
  });
  it("sans compte WhatsApp : rien n'est soumis", async () => {
    deps.getAccountId = async () => null;
    expect(await ensureProspectingTemplates(ORG, deps)).toMatchObject({ ok: false, reason: "no_account" });
  });
  it("statut reçu du webhook : appliqué, refus notifié, modèle étranger ignoré", async () => {
    expect(await applyProspectingTemplateStatus(ORG, { name: "flexco_prospection_v1", status: "approved" }, deps)).toBe(true);
    expect(env.templates.intro).toBe("APPROVED");
    await applyProspectingTemplateStatus(ORG, { name: "flexco_relance_v1", status: "REJECTED", reason: "x" }, deps);
    expect(notified).toContain("Modèle de prospection refusé ou suspendu");
    expect(await applyProspectingTemplateStatus(ORG, { name: "autre" }, deps)).toBe(false);
  });
});
