import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "./__fixtures__/fake-supabase";

const fake = vi.hoisted(() => ({ current: null as null | { client: unknown; tables: Record<string, Record<string, unknown>[]>; state: { failTables: Set<string>; rpcCalls: Array<{ name: string; args: Record<string, unknown> }>; rpcImpl: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> } } }));
const mockRequireMembership = vi.fn();
const mockResolveBusinessInfo = vi.fn();

vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: () => fake.current!.client }));
vi.mock("@/infrastructure/tenant/resolve-request-tenant", () => ({ getTenantPublicOrigin: async () => "https://b.example" }));
vi.mock("./auth-service", () => ({ requireMembership: (...a: unknown[]) => mockRequireMembership(...a) }));
vi.mock("./business-info-resolver", () => ({ resolveBusinessInfo: (...a: unknown[]) => mockResolveBusinessInfo(...a) }));

import { saveFaqLearningSettings, getFaqLearningSettings, recordQuestionForLearning, recordFaqHit, resolveFaqAnswerVariables, listFaqCandidates, decideFaqCandidate, getFaqSavings, listFaqsDueForReview, markFaqReviewed } from "./faq-learning-service";
import { ValidationError, NotFoundError, AuthorizationError } from "@/lib/errors";

const ORG = "org_1";
const CATALOG = "https://b.example/produits";
const DAY = 86_400_000;
let db: ReturnType<typeof createFakeSupabase>;

const enable = (threshold = 3) => db.tables.faq_learning_settings!.push({ organization_id: ORG, enabled: true, weekly_threshold: threshold });
const ask = (question: string, over: { resolution?: "ai" | "verify"; replyText?: string | null } = {}) => recordQuestionForLearning(ORG, { question, resolution: over.resolution ?? "ai", replyText: over.replyText ?? null, catalogUrl: CATALOG });
const candidates = () => db.tables.faq_candidates!;

beforeEach(() => {
  db = createFakeSupabase(
    { faq_learning_settings: [], faq_question_log: [], faq_candidates: [], faqs: [], products: [], faq_hit_daily: [], delivery_zones: [], delivery_settings: [] },
    // DEFAULT du schéma 0143 (la fausse base ne lit pas le SQL).
    { faq_candidates: { status: "pending", occurrences: 1, keywords: [] } },
  );
  fake.current = db;
  mockRequireMembership.mockReset().mockResolvedValue({ userId: "user_1", organizationId: ORG, role: "owner" });
  mockResolveBusinessInfo.mockReset().mockResolvedValue(null);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("réglages — opt-in", () => {
  it("désactivé par défaut : aucune question n'est conservée", async () => {
    expect(await ask("Vous livrez à Douala ?")).toBe(false);
    expect(db.tables.faq_question_log).toHaveLength(0);
    expect((await getFaqLearningSettings(ORG)).enabled).toBe(false);
  });

  it("réservé propriétaire / administrateur ; seuil borné", async () => {
    const s = await saveFaqLearningSettings(ORG, { enabled: true, weeklyThreshold: 999 });
    expect(mockRequireMembership).toHaveBeenCalledWith(ORG, ["owner", "admin"]);
    expect(s).toEqual({ enabled: true, weeklyThreshold: 50 });
    mockRequireMembership.mockRejectedValue(new AuthorizationError("non"));
    await expect(saveFaqLearningSettings(ORG, { enabled: true })).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("recordQuestionForLearning", () => {
  it("propose une FAQ quand la même question revient au seuil, pas avant", async () => {
    enable(3);
    expect(await ask("Vous livrez à Douala ?")).toBe(false);
    expect(await ask("Livraison possible sur Douala ?")).toBe(false);
    expect(candidates()).toHaveLength(0);
    expect(await ask("Livrez-vous sur Douala ?")).toBe(true);
    expect(candidates()).toHaveLength(1);
    expect(candidates()[0]!).toMatchObject({ organization_id: ORG, status: "pending", occurrences: 3, keywords: ["douala livrez"] });
  });

  it("met à jour le compteur au lieu de re-proposer", async () => {
    enable(3);
    for (const q of ["Vous livrez à Douala ?", "Livraison possible sur Douala ?", "Livrez-vous sur Douala ?"]) await ask(q);
    expect(await ask("Livrez-vous à Douala svp ?")).toBe(false);
    expect(candidates()).toHaveLength(1);
    expect(candidates()[0]!.occurrences).toBe(4);
  });

  it("sépare les sujets : deux propositions distinctes", async () => {
    enable(2);
    for (const q of ["Vous livrez à Douala ?", "Quels sont vos horaires ?", "Livraison sur Douala possible ?", "Vos horaires d'ouverture svp"]) await ask(q);
    expect(candidates()).toHaveLength(2);
  });

  it("pré-remplit la réponse seulement si elle ne contient rien de périssable", async () => {
    enable(2);
    await ask("Vous livrez à Douala ?", { replyText: "Oui, nous livrons à Douala. Voir le catalogue : https://b.example/produits" });
    await ask("Livraison possible sur Douala ?", { replyText: "La livraison coûte 1 500 FCFA." });
    expect(candidates()[0]!.suggested_answer).toBe("Oui, nous livrons à Douala. Voir le catalogue : {catalog_url}");
  });

  it("une proposition issue de « je vérifie » part sans réponse (le propriétaire rédige la sienne)", async () => {
    enable(2);
    await ask("Vous livrez à Douala ?", { resolution: "verify", replyText: "Je vérifie cette information auprès de l'équipe et je reviens vers vous très vite." });
    await ask("Livraison possible sur Douala ?", { resolution: "verify" });
    expect(candidates()[0]!.suggested_answer).toBeNull();
  });

  it("minimisation : numéro et email retirés, aucun identifiant de client ni de conversation conservé", async () => {
    enable(3);
    await ask("Rappelez-moi au 699 12 34 56 ou awa@mail.cm pour la livraison");
    const row = db.tables.faq_question_log![0]!;
    expect(row!.question).toBe("Rappelez-moi au [numéro] ou [email] pour la livraison");
    expect(Object.keys(row).sort()).toEqual(["created_at", "id", "organization_id", "question", "resolution", "suggested_answer", "tokens"]);
  });

  it("ISOLATION : les questions d'une autre entreprise ne comptent jamais", async () => {
    enable(3);
    const now = new Date().toISOString();
    for (let i = 0; i < 5; i++) db.tables.faq_question_log!.push({ id: `x${i}`, organization_id: "org_2", question: "Vous livrez à Douala ?", tokens: ["douala", "livrez"], resolution: "ai", suggested_answer: null, created_at: now });
    expect(await ask("Vous livrez à Douala ?")).toBe(false);
    expect(candidates()).toHaveLength(0);
  });

  it("ignore les questions de plus d'une semaine", async () => {
    enable(3);
    const old = new Date(Date.now() - 10 * DAY).toISOString();
    for (let i = 0; i < 5; i++) db.tables.faq_question_log!.push({ id: `o${i}`, organization_id: ORG, question: "Vous livrez à Douala ?", tokens: ["douala", "livrez"], resolution: "ai", suggested_answer: null, created_at: old });
    expect(await ask("Vous livrez à Douala ?")).toBe(false);
  });

  it("ne lève jamais : une panne de base ne doit pas empêcher de répondre", async () => {
    enable(3);
    db.state.failTables.add("faq_question_log");
    await expect(ask("Vous livrez à Douala ?")).resolves.toBe(false);
  });

  it("refus : pas de re-proposition pendant le délai, puis de nouveau possible", async () => {
    enable(2);
    for (const q of ["Vous livrez à Douala ?", "Livraison possible sur Douala ?"]) await ask(q);
    const id = String(candidates()[0]!.id);
    await decideFaqCandidate(ORG, id, { action: "reject" });
    expect(candidates()[0]!).toMatchObject({ status: "rejected" });
    expect(await ask("Livrez-vous sur Douala ?")).toBe(false);
    expect(candidates()).toHaveLength(1);
    candidates()[0]!.cooldown_until = new Date(Date.now() - DAY).toISOString();
    expect(await ask("Livrez-vous sur Douala encore ?")).toBe(true);
    expect(candidates()).toHaveLength(2);
  });
});

describe("decideFaqCandidate", () => {
  const seed = (over: Record<string, unknown> = {}) => {
    db.tables.faq_candidates!.push({ id: "c1", organization_id: ORG, question: "Vous livrez à Douala ?", suggested_answer: "Oui, nous livrons à Douala.", keywords: ["douala livrez"], status: "pending", ...over });
  };

  it("valider crée la FAQ (origine « learned », relecture dans 90 jours) et lie la proposition", async () => {
    seed();
    const out = await decideFaqCandidate(ORG, "c1", { action: "approve" });
    const faq = db.tables.faqs![0];
    expect(faq).toMatchObject({ organization_id: ORG, question: "Vous livrez à Douala ?", answer: "Oui, nous livrons à Douala.", keywords: ["douala livrez"], is_active: true, source: "learned" });
    expect(String(faq!.review_at)).toBe(new Date(Date.now() + 90 * DAY).toISOString().slice(0, 10));
    expect(candidates()[0]!).toMatchObject({ status: "approved", decided_by: "user_1", faq_id: faq!.id });
    expect(out.faqId).toBe(faq!.id);
  });

  it("modifier avant de valider : la version du propriétaire est publiée", async () => {
    seed();
    await decideFaqCandidate(ORG, "c1", { action: "approve", answer: "Oui, partout à Douala : {hours}", keywords: ["livraison douala"] });
    expect(db.tables.faqs![0]).toMatchObject({ answer: "Oui, partout à Douala : {hours}", keywords: ["livraison douala"] });
  });

  it("refus des réponses invalides, la proposition reste disponible", async () => {
    seed({ suggested_answer: null });
    await expect(decideFaqCandidate(ORG, "c1", { action: "approve" })).rejects.toBeInstanceOf(ValidationError); // pas de réponse
    await expect(decideFaqCandidate(ORG, "c1", { action: "approve", answer: "Voir {prix_du_jour}" })).rejects.toBeInstanceOf(ValidationError); // variable inconnue
    await expect(decideFaqCandidate(ORG, "c1", { action: "approve", answer: "Oui", keywords: [] })).rejects.toBeInstanceOf(ValidationError); // pas de mot-clé
    expect(candidates()[0]!.status).toBe("pending");
    expect(db.tables.faqs).toHaveLength(0);
  });

  it("une proposition ne se valide qu'une fois (pas de FAQ en double)", async () => {
    seed();
    await decideFaqCandidate(ORG, "c1", { action: "approve" });
    await expect(decideFaqCandidate(ORG, "c1", { action: "approve" })).rejects.toBeInstanceOf(ValidationError);
    expect(db.tables.faqs).toHaveLength(1);
  });

  it("échec de création de la FAQ : la proposition redevient disponible", async () => {
    seed();
    db.state.failTables.add("faqs");
    await expect(decideFaqCandidate(ORG, "c1", { action: "approve" })).rejects.toThrow();
    expect(candidates()[0]!).toMatchObject({ status: "pending", decided_at: null });
  });

  it("ISOLATION et droits : autre entreprise introuvable ; rôle exigé", async () => {
    seed({ organization_id: "org_2" });
    await expect(decideFaqCandidate(ORG, "c1", { action: "reject" })).rejects.toBeInstanceOf(NotFoundError);
    mockRequireMembership.mockRejectedValue(new AuthorizationError("non"));
    await expect(decideFaqCandidate(ORG, "c1", { action: "reject" })).rejects.toBeInstanceOf(AuthorizationError);
    expect(mockRequireMembership).toHaveBeenCalledWith(ORG, ["owner", "admin"]);
  });

  it("listFaqCandidates : seulement les propositions en attente de cette entreprise, les plus fréquentes d'abord", async () => {
    seed({ id: "a", occurrences: 3 });
    seed({ id: "b", occurrences: 9 });
    seed({ id: "c", occurrences: 20, status: "rejected" });
    seed({ id: "d", occurrences: 50, organization_id: "org_2" });
    expect((await listFaqCandidates(ORG)).map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("variables dynamiques au moment de répondre", () => {
  it("sans variable : texte inchangé, aucune lecture en base", async () => {
    expect(await resolveFaqAnswerVariables(ORG, "Oui, nous livrons.")).toBe("Oui, nous livrons.");
    expect(mockResolveBusinessInfo).not.toHaveBeenCalled();
  });

  it("horaires, adresse, contact, lien catalogue : valeurs ACTUELLES", async () => {
    mockResolveBusinessInfo.mockImplementation(async (_o: string, topic: string) => (topic === "hours" ? "lundi : 9h-18h" : topic === "address" ? "Akwa, Douala" : null));
    expect(await resolveFaqAnswerVariables(ORG, "Ouvert {hours} — {address} — {catalog_url}")).toBe("Ouvert lundi : 9h-18h — Akwa, Douala — https://b.example/produits");
  });

  it("valeur introuvable (horaires non renseignés) → null : la FAQ n'est pas utilisée plutôt que périmée", async () => {
    expect(await resolveFaqAnswerVariables(ORG, "Ouvert {hours}")).toBeNull();
  });

  it("prix actuel d'un produit actif ; produit inactif, absent ou d'une autre entreprise → null", async () => {
    db.tables.products!.push({ organization_id: ORG, slug: "sac-cuir", status: "active", unit_price: 15000 }, { organization_id: ORG, slug: "vieux", status: "archived", unit_price: 1 }, { organization_id: "org_2", slug: "autre", status: "active", unit_price: 1 });
    expect((await resolveFaqAnswerVariables(ORG, "Le sac : {price:sac-cuir}"))?.replace(/[\u202f\u00a0]/g, " ")).toBe("Le sac : 15 000 FCFA");
    expect(await resolveFaqAnswerVariables(ORG, "{price:vieux}")).toBeNull();
    expect(await resolveFaqAnswerVariables(ORG, "{price:absent}")).toBeNull();
    expect(await resolveFaqAnswerVariables(ORG, "{price:autre}")).toBeNull();
  });

  it("variable inconnue → null ; jamais d'exception", async () => {
    expect(await resolveFaqAnswerVariables(ORG, "Voir {prix_du_jour}")).toBeNull();
    mockResolveBusinessInfo.mockRejectedValue(new Error("boom"));
    await expect(resolveFaqAnswerVariables(ORG, "Ouvert {hours}")).resolves.toBeNull();
  });
});

describe("variables de livraison dans les FAQ", () => {
  const zone = (over: Record<string, unknown> = {}) => ({ organization_id: ORG, name: "Douala", slug: "douala", aliases: [], fee_amount: 1500, is_free: false, free_above_amount: null, eta_text: "24 à 48 h", is_active: true, ...over });
  const flatText = (t: string | null) => (t ?? "").replace(/[\u202f\u00a0]/g, " ");

  it("{delivery:zone} : frais et délai ACTUELS de la zone", async () => {
    db.tables.delivery_zones!.push(zone());
    expect(flatText(await resolveFaqAnswerVariables(ORG, "Pour Douala : {delivery:douala}."))).toBe("Pour Douala : Douala : frais de livraison : 1 500 FCFA, délai : 24 à 48 h.");
    db.tables.delivery_zones![0]!.fee_amount = 2000; // le tarif change : la FAQ suit, sans être réécrite
    expect(flatText(await resolveFaqAnswerVariables(ORG, "{delivery:douala}"))).toContain("2 000 FCFA");
  });

  it("{delivery_zones} : liste des zones actives ; aucune zone → null (FAQ non utilisée)", async () => {
    expect(await resolveFaqAnswerVariables(ORG, "Nous livrons à : {delivery_zones}")).toBeNull();
    db.tables.delivery_zones!.push(zone(), zone({ name: "Yaoundé", slug: "yaounde" }));
    expect(await resolveFaqAnswerVariables(ORG, "Nous livrons à : {delivery_zones}")).toBe("Nous livrons à : Douala, Yaoundé");
  });

  it("zone inconnue, désactivée ou d'une autre entreprise → null : jamais de réponse périmée", async () => {
    db.tables.delivery_zones!.push(zone({ slug: "kribi", name: "Kribi", is_active: false }), zone({ organization_id: "org_2", slug: "garoua", name: "Garoua" }));
    expect(await resolveFaqAnswerVariables(ORG, "{delivery:inconnue}")).toBeNull();
    expect(await resolveFaqAnswerVariables(ORG, "{delivery:kribi}")).toBeNull();
    expect(await resolveFaqAnswerVariables(ORG, "{delivery:garoua}")).toBeNull();
  });
});

describe("usages, économies, relecture", () => {
  it("recordFaqHit appelle la fonction SQL avec l'organisation et n'échoue jamais", async () => {
    await recordFaqHit(ORG, "f1");
    expect(db.state.rpcCalls[0]).toEqual({ name: "faq_record_hit", args: { p_organization_id: ORG, p_faq_id: "f1" } });
    db.state.rpcImpl = async () => ({ data: null, error: { message: "boom" } });
    await expect(recordFaqHit(ORG, "f1")).resolves.toBeUndefined();
  });

  it("crédits économisés = réponses servies par les FAQ sur la période, de cette entreprise", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const old = new Date(Date.now() - 60 * DAY).toISOString().slice(0, 10);
    db.tables.faq_hit_daily!.push({ organization_id: ORG, faq_id: "f1", day: today, hits: 12 }, { organization_id: ORG, faq_id: "f2", day: today, hits: 3 }, { organization_id: ORG, faq_id: "f1", day: old, hits: 100 }, { organization_id: "org_2", faq_id: "f9", day: today, hits: 999 });
    expect(await getFaqSavings(ORG, 30)).toEqual({ days: 30, faqAnswers: 15, creditsSaved: 15 });
  });

  it("FAQ à relire : actives, date atteinte, de cette entreprise ; relecture marquée repart pour 90 jours", async () => {
    const d = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
    db.tables.faqs!.push(
      { id: "due", organization_id: ORG, question: "A", is_active: true, review_at: d(-1), source: "owner" },
      { id: "later", organization_id: ORG, question: "B", is_active: true, review_at: d(30), source: "owner" },
      { id: "off", organization_id: ORG, question: "C", is_active: false, review_at: d(-5), source: "owner" },
      { id: "never", organization_id: ORG, question: "D", is_active: true, review_at: null, source: "owner" },
      { id: "other", organization_id: "org_2", question: "E", is_active: true, review_at: d(-5), source: "owner" },
    );
    expect((await listFaqsDueForReview(ORG)).map((f) => f.id)).toEqual(["due"]);
    await markFaqReviewed(ORG, "due");
    expect(db.tables.faqs!.find((f) => f.id === "due")!.review_at).toBe(d(90));
    await expect(markFaqReviewed(ORG, "other")).rejects.toBeInstanceOf(NotFoundError);
  });
});
