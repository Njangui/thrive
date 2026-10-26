import { describe, expect, it, vi } from "vitest";
import type { Actor } from "@/application/agents/contracts";
import type { AuditEvent } from "@/application/agents/audit";
import { createConsentService, type ConsentRepository } from "./consent-service";
import { createFeedbackService, type FeedbackRepository } from "./feedback-service";
import { computeAgentQuality } from "./feedback-metrics";
import { createTrainingExporter, pseudonymize, type ExportRow } from "./training-export";

const RUN = "22222222-0000-0000-0000-000000000001";
const actor = (over: Partial<Actor> = {}): Actor => ({ userId: "u1", tenantId: "t1", role: "owner", extraPermissions: [], channel: "dashboard", ...over });

describe("feedback-service", () => {
  const mk = () => {
    const repo: FeedbackRepository = { record: vi.fn(async () => "recorded" as const), recordOutcome: vi.fn(async () => undefined) };
    return { repo, svc: createFeedbackService(repo) };
  };

  it("enregistre avec le tenant et l'utilisateur de l'ACTEUR (jamais ceux de l'entrée)", async () => {
    const { repo, svc } = mk();
    await svc.submitFeedback(actor(), { runId: RUN, rating: -1, reasonCode: "tone", comment: "  trop sec  ", tenantId: "autre", actorId: "autre" });
    expect(repo.record).toHaveBeenCalledWith({ tenantId: "t1", runId: RUN, actorId: "u1", rating: -1, reasonCode: "tone", comment: "trop sec" });
  });

  it("ignore la raison pour un retour positif", async () => {
    const { repo, svc } = mk();
    await svc.submitFeedback(actor(), { runId: RUN, rating: 1, reasonCode: "tone" });
    expect(repo.record).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: undefined }));
  });

  it.each([
    { runId: "pas-un-uuid", rating: 1 }, { runId: RUN, rating: 0 }, { runId: RUN, rating: 1, reasonCode: "x" },
    { runId: RUN, rating: 1, comment: "x".repeat(501) }, null, "texte",
  ])("refuse un retour invalide %o", async (bad) => {
    const { repo, svc } = mk();
    await expect(svc.submitFeedback(actor(), bad)).rejects.toMatchObject({ code: "feedback_invalid" });
    expect(repo.record).not.toHaveBeenCalled();
  });

  it.each(["customer", "scheduler"] as const)("canal %s refusé", async (channel) => {
    const { svc } = mk();
    await expect(svc.submitFeedback(actor({ channel }), { runId: RUN, rating: 1 })).rejects.toMatchObject({ code: "feedback_invalid" });
  });

  it("résultats : refuse un type inconnu et tout texte libre long dans meta", async () => {
    const { repo, svc } = mk();
    await svc.recordOutcome(actor(), { kind: "draft_sent", toolName: "notes.add", meta: { chars: 120 } });
    expect(repo.recordOutcome).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1", kind: "draft_sent" }));
    await expect(svc.recordOutcome(actor(), { kind: "autre" as never })).rejects.toMatchObject({ code: "feedback_invalid" });
    await expect(svc.recordOutcome(actor(), { kind: "draft_sent", meta: { texte: "x".repeat(101) } })).rejects.toMatchObject({ code: "feedback_invalid" });
  });
});

describe("consent-service", () => {
  const mk = (outcome: "granted" | "revoked" | "forbidden" = "granted") => {
    const repo: ConsentRepository = { has: vi.fn(async () => false), record: vi.fn(async () => outcome) };
    const events: AuditEvent[] = [];
    return { repo, events, svc: createConsentService({ repo, audit: { record: async (e) => { events.push(e); } } }) };
  };
  const input = { scope: "feedback_export" as const, granted: true, policyVersion: "v1" };

  it("le propriétaire sur le tableau de bord décide, et la décision est auditée", async () => {
    const { repo, events, svc } = mk();
    expect(await svc.decide(actor(), input)).toBe("granted");
    expect(repo.record).toHaveBeenCalledWith({ tenantId: "t1", scope: "feedback_export", granted: true, decidedBy: "u1", policyVersion: "v1" });
    expect(events[0]).toMatchObject({ toolName: "training.consent", risk: "sensitive", event: "executed" });
  });

  it.each([
    actor({ role: "admin" }), actor({ role: "manager" }), actor({ channel: "telegram" }), actor({ channel: "whatsapp" }),
    actor({ channel: "scheduler" }), actor({ channel: "customer" }),
  ])("refusé pour %o, sans toucher à la base", async (a) => {
    const { repo, svc } = mk();
    await expect(svc.decide(a, input)).rejects.toMatchObject({ code: "consent_forbidden" });
    expect(repo.record).not.toHaveBeenCalled();
  });

  it("refus de la base (non propriétaire réel) => erreur, aucun audit de succès", async () => {
    const { events, svc } = mk("forbidden");
    await expect(svc.decide(actor(), input)).rejects.toMatchObject({ code: "consent_forbidden" });
    expect(events).toHaveLength(0);
  });

  it("portée inconnue ou version de politique absente refusées", async () => {
    const { svc } = mk();
    await expect(svc.decide(actor(), { ...input, scope: "tout" as never })).rejects.toMatchObject({ code: "consent_forbidden" });
    await expect(svc.decide(actor(), { ...input, policyVersion: "" })).rejects.toMatchObject({ code: "consent_forbidden" });
  });

  it("le retrait est possible et audité", async () => {
    const { events, svc } = mk("revoked");
    expect(await svc.decide(actor(), { ...input, granted: false })).toBe("revoked");
    expect(events[0]?.paramsRedacted).toMatchObject({ granted: false });
  });
});

describe("training-export", () => {
  const SECRET = "s".repeat(40);
  const row: ExportRow = {
    runId: RUN, agentName: "employee", promptVersion: "v1", modelTier: "small", runStatus: "completed",
    rating: -1, reasonCode: "tone", outcomes: ["draft_sent"], createdAt: "2026-10-09T10:15:00Z",
  };
  const mk = (over: { enabled?: boolean; secret?: string | undefined; consent?: boolean } = {}) => {
    const repo = { rows: vi.fn(async () => [row]) };
    const exporter = createTrainingExporter({
      repo, consents: { has: async () => over.consent ?? true },
      enabled: over.enabled ?? true, secret: "secret" in over ? over.secret : SECRET,
    });
    return { repo, exporter };
  };

  it("désactivé par défaut : aucun accès aux données", async () => {
    const { repo, exporter } = mk({ enabled: false });
    await expect(exporter.export({ tenantId: "t1" })).rejects.toMatchObject({ code: "export_disabled" });
    expect(repo.rows).not.toHaveBeenCalled();
  });

  it.each([{ secret: undefined }, { secret: "court" }, { consent: false }])("refusé sans verrou %o", async (over) => {
    const { repo, exporter } = mk(over);
    await expect(exporter.export({ tenantId: "t1" })).rejects.toMatchObject({ code: "export_disabled" });
    expect(repo.rows).not.toHaveBeenCalled();
  });

  it("pseudonymise : ni run, ni tenant, ni utilisateur, ni horodatage précis", async () => {
    const { exporter } = mk();
    const out = await exporter.export({ tenantId: "t1" });
    const json = JSON.stringify(out);
    expect(json).not.toContain(RUN);
    expect(json).not.toContain("t1");
    expect(json).not.toContain("10:15");
    expect(out[0]).toMatchObject({ day: "2026-10-09", rating: -1, outcomes: ["draft_sent"] });
    expect(out[0]?.pseudoRunId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("pseudonyme stable pour un tenant, différent d'un tenant à l'autre et d'un secret à l'autre", () => {
    expect(pseudonymize(SECRET, "t1", RUN)).toBe(pseudonymize(SECRET, "t1", RUN));
    expect(pseudonymize(SECRET, "t1", RUN)).not.toBe(pseudonymize(SECRET, "t2", RUN));
    expect(pseudonymize(SECRET, "t1", RUN)).not.toBe(pseudonymize("a".repeat(40), "t1", RUN));
  });

  it("borne la limite demandée", async () => {
    const { repo, exporter } = mk();
    await exporter.export({ tenantId: "t1", limit: 10 ** 9 });
    await exporter.export({ tenantId: "t1", limit: -5 });
    expect(repo.rows).toHaveBeenNthCalledWith(1, "t1", null, 5000);
    expect(repo.rows).toHaveBeenNthCalledWith(2, "t1", null, 1);
  });
});

describe("feedback-metrics", () => {
  it("satisfaction et principales raisons par agent et version de prompt", () => {
    const rows = [
      { agentName: "employee", promptVersion: "v1", rating: 1, reasonCode: null },
      { agentName: "employee", promptVersion: "v1", rating: -1, reasonCode: "tone" },
      { agentName: "employee", promptVersion: "v1", rating: -1, reasonCode: "tone" },
      { agentName: "employee", promptVersion: "v1", rating: -1, reasonCode: "wrong_info" },
      { agentName: "employee", promptVersion: "v2", rating: 1, reasonCode: null },
    ];
    expect(computeAgentQuality(rows)).toEqual([
      { agentName: "employee", promptVersion: "v1", total: 4, positive: 1, satisfaction: 0.25, topReasons: [{ reason: "tone", count: 2 }, { reason: "wrong_info", count: 1 }] },
      { agentName: "employee", promptVersion: "v2", total: 1, positive: 1, satisfaction: 1, topReasons: [] },
    ]);
    expect(computeAgentQuality([])).toEqual([]);
  });
});
