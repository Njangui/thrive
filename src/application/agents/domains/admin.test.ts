import { describe, expect, it, vi } from "vitest";
import { createPendingActionService } from "../pending-actions";
import { createActionEvaluator } from "../rule-engine";
import { createAgentKernel } from "../tool-registry";
import { createTenantScopedDb } from "../tenant-scoped-db";
import { executeTool, type RuntimeDeps } from "../execute-tool";
import { InMemoryAuditSink, InMemoryPendingRepo, InMemorySettingsRepo } from "../testing/in-memory";
import { FakeSupabase } from "../testing/fake-supabase";
import type { Actor } from "../contracts";
import { buildAdminTools, maskEmail, type AdminServices } from "./admin";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const owner: Actor = { userId: U1, tenantId: "t1", membershipId: "m1", role: "owner", extraPermissions: [], channel: "dashboard" };

function setup() {
  const calls: Record<string, unknown[]> = {};
  const rec = (name: string, ret?: unknown) => vi.fn(async (...a: unknown[]) => { (calls[name] ??= []).push(a); return ret; });
  const alerts = { triggers: { outage: { enabled: true } }, quietEnabled: false, quietStart: "22:00", quietEnd: "07:00", escalationDelayMinutes: 15, fallbackMembershipId: null };
  const s = {
    listMembers: rec("listMembers", [{ userId: U1, role: "owner", email: "boss@example.com", joinedAt: "x" }, { userId: U2, role: "manager", email: "awa@example.com", joinedAt: "x" }]),
    listInvitations: rec("listInvitations", [{ id: U2, email: "new@example.com", role: "employee", status: "pending", expiresAt: "x" }]),
    invite: rec("invite", { invitationId: U2, emailDelivered: false, inviteUrl: "https://x/invite/accept?token=SECRET" }), revokeInvitation: rec("revokeInvitation"),
    setRole: rec("setRole"), removeMember: rec("removeMember"),
    listFaqs: rec("listFaqs", [{ id: U2, question: "Horaires ?", answer: "9h-18h", keywords: ["horaires"], isActive: true }]),
    createFaq: rec("createFaq", { faqId: U2 }), updateFaq: rec("updateFaq"), deleteFaq: rec("deleteFaq"),
    getBusiness: rec("getBusiness", { name: "Chez Awa", description: "Resto", phone: "+237600000000", whatsappNumber: null, email: null, address: "Douala", openingHours: { lundi: "8h-17h" } }),
    updateBusiness: rec("updateBusiness"), getAlertSettings: rec("getAlertSettings", alerts), saveAlertSettings: rec("saveAlertSettings"),
    subscription: rec("subscription", { planName: "Pro", status: "active", usage: [] }), credits: rec("credits", { includedCredits: 100, addonCredits: 0, usedCredits: 5, remainingCredits: 95 }),
  } as unknown as AdminServices;
  const kernel = createAgentKernel();
  for (const { tool, roles } of buildAdminTools(s)) kernel.registerTool(tool, { roles });
  const settings = new InMemorySettingsRepo();
  settings.withDefaults("t1", { profile: "autonomous" });
  const pending = createPendingActionService({ repo: new InMemoryPendingRepo(), matrix: kernel.matrix });
  const deps: RuntimeDeps = {
    registry: kernel.registry, evaluate: createActionEvaluator({ settings, matrix: kernel.matrix, pending }), pending, audit: new InMemoryAuditSink(),
    usage: { charge: async () => ({ status: "charged" }) }, makeDb: (t) => createTenantScopedDb(new FakeSupabase({}) as never, t),
  };
  const run = (toolName: string, input: unknown, actor: Actor = owner) => executeTool(deps, actor, { toolName, input, runId: "r" });
  return { calls, run, kernel };
}

describe("outils d'administration", () => {
  it("accès (invitation, rôle, retrait) et suppression de FAQ : TOUJOURS validés, même en mode autonome", async () => {
    const { run, calls } = setup();
    for (const [tool, input] of [
      ["team.invite", { email: "a@b.co", role: "manager" }], ["team.setRole", { userId: U2, role: "admin" }], ["team.remove", { userId: U2 }], ["faq.delete", { faqId: U2 }],
    ] as const) expect((await run(tool, input)).status).toBe("pending_confirmation");
    expect(calls.invite ?? calls.setRole ?? calls.removeMember ?? calls.deleteFaq).toBeUndefined();
  });

  it("le rôle propriétaire ne s'attribue pas depuis le chat ; un email invalide est refusé", async () => {
    const { run } = setup();
    expect((await run("team.invite", { email: "a@b.co", role: "owner" })).status).toBe("denied");
    expect((await run("team.setRole", { userId: U2, role: "owner" })).status).toBe("denied");
    expect((await run("team.invite", { email: "pas-un-email", role: "manager" })).status).toBe("denied");
  });

  it("on ne modifie pas son propre accès ; le jeton d'invitation n'est jamais renvoyé", async () => {
    const { kernel, calls } = setup();
    const ctx = { actor: owner, db: undefined, runId: "r", usage: undefined } as never;
    await expect(kernel.registry.get("team.setRole")!.run(ctx, { userId: U1, role: "manager" })).rejects.toThrow();
    await expect(kernel.registry.get("team.remove")!.run(ctx, { userId: U1 })).rejects.toThrow();
    expect(calls.setRole).toBeUndefined();
    const out = await kernel.registry.get("team.invite")!.run(ctx, { email: "a@b.co", role: "manager" });
    expect(JSON.stringify(out)).not.toContain("SECRET");
  });

  it("emails masqués dans la liste d'équipe", async () => {
    const { run } = setup();
    const r = (await run("team.list", {})) as { output: unknown };
    expect(JSON.stringify(r.output)).not.toContain("boss@example.com");
    expect(maskEmail("awa@example.com")).toBe("aw***@example.com");
  });

  it("texte de FAQ et fiche entreprise : validés avant d'être visibles des clients ; activer/désactiver reste libre", async () => {
    const { run, calls } = setup();
    expect((await run("faq.create", { question: "Q ?", answer: "R", keywords: ["q"] })).status).toBe("pending_confirmation");
    expect((await run("faq.update", { faqId: U2, answer: "Nouveau" })).status).toBe("pending_confirmation");
    expect((await run("business.update", { phone: "+237611111111" })).status).toBe("pending_confirmation");
    expect((await run("faq.setActive", { faqId: U2, active: false })).status).toBe("ok");
    expect(calls.createFaq).toBeUndefined();
    expect(calls.updateBusiness).toBeUndefined();
  });

  it("la mise à jour de la fiche conserve les champs non fournis", async () => {
    const { kernel, calls } = setup();
    await kernel.registry.get("business.update")!.run({ actor: owner, db: undefined, runId: "r", usage: undefined } as never, { phone: "+237611111111", openingHours: { mardi: "9h-17h" } });
    expect((calls.updateBusiness![0] as [string, Record<string, unknown>])[1]).toMatchObject({ name: "Chez Awa", description: "Resto", address: "Douala", phone: "+237611111111", openingHours: { lundi: "8h-17h", mardi: "9h-17h" } });
  });

  it("alertes : fusion avec l'existant ; lecture de l'abonnement sans aucun outil de modification", async () => {
    const { run, calls, kernel } = setup();
    expect((await run("alerts.update", { quietEnabled: true })).status).toBe("ok");
    expect((calls.saveAlertSettings![0] as [string, { triggers: unknown; quietEnabled: boolean }])[1]).toMatchObject({ quietEnabled: true, triggers: { outage: { enabled: true } } });
    expect((await run("subscription.status", {})).status).toBe("ok");
    expect(kernel.registry.list().filter((t) => t.domain === "subscription" && t.risk !== "read")).toEqual([]);
  });

  it("rôles : gérant → FAQ seulement ; employé et client → rien", async () => {
    const { run } = setup();
    const manager = { ...owner, role: "manager" as const };
    expect((await run("faq.list", {}, manager)).status).toBe("ok");
    expect((await run("team.list", {}, manager)).status).toBe("denied");
    expect((await run("credits.status", {}, manager)).status).toBe("denied");
    expect((await run("faq.list", {}, { ...owner, role: "employee" })).status).toBe("denied");
    expect((await run("faq.list", {}, { ...owner, channel: "customer" })).status).toBe("denied");
  });
});
