import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeDb } from "../../../tests/helpers/fake-supabase";
import { SupabaseStepUpAdapter } from "./supabase-step-up-adapter";
import { computeActionFingerprint } from "@/application/channels/action-fingerprint";

const ORG = "org-a";
const MEM = "mem-1";
const OTHER_MEM = "mem-2";
const PIN = "493817";
const PEPPER = "poivre-de-test-1234567";

let db: FakeDb;
let clock: number;
let adapter: SupabaseStepUpAdapter;
const fingerprint = computeActionFingerprint("orders.refund", { orderId: "o1", amount: 5000 });

/** Émule en mémoire les fonctions SQL step_up_record_failure / _success (mêmes règles que la migration 0120). */
function installPinRpcs(): void {
  db.rpcHandlers.step_up_record_failure = (args) => {
    const row = db.rows("step_up_pins").find((r) => r.membership_id === args.p_membership_id)!;
    let attempts = (row.failed_attempts as number) + 1;
    let lockout = row.lockout_count as number;
    let lockedUntil = row.locked_until as string | null;
    if (attempts >= (args.p_max_attempts as number)) {
      const seconds = Math.min((args.p_base_lock_seconds as number) * 2 ** lockout, 86400);
      lockedUntil = new Date(clock + seconds * 1000).toISOString();
      lockout += 1;
      attempts = 0;
    }
    Object.assign(row, { failed_attempts: attempts, lockout_count: lockout, locked_until: lockedUntil });
    return { data: [{ failed_attempts: attempts, locked_until: lockedUntil, lockout_count: lockout }], error: null };
  };
  db.rpcHandlers.step_up_record_success = (args) => {
    const row = db.rows("step_up_pins").find((r) => r.membership_id === args.p_membership_id)!;
    Object.assign(row, { failed_attempts: 0, lockout_count: 0, locked_until: null });
    return { data: null, error: null };
  };
}

beforeEach(async () => {
  db = new FakeDb();
  clock = Date.parse("2026-10-07T10:00:00Z");
  adapter = new SupabaseStepUpAdapter(db as unknown as SupabaseClient, PEPPER, () => clock);
  installPinRpcs();
  db.defaults.step_up_challenges = { status: "pending" }; // `default 'pending'` de la migration 0120
  db.seed("memberships", [
    { id: MEM, organization_id: ORG, user_id: "user-1" },
    { id: OTHER_MEM, organization_id: ORG, user_id: "user-2" },
  ]);
  await adapter.setPin({ organizationId: ORG, membershipId: MEM, pin: PIN });
});

describe("PIN", () => {
  it("n'enregistre jamais le PIN en clair et trace la création", async () => {
    expect(JSON.stringify(db.rows("step_up_pins"))).not.toContain(PIN);
    expect(db.rows("audit_logs").map((r) => r.action)).toContain("STEP_UP_PIN_SET");
  });

  it("refuse un PIN faible ou mal formé, sans rien écrire", async () => {
    expect(await adapter.setPin({ organizationId: ORG, membershipId: OTHER_MEM, pin: "123456" })).toEqual({ ok: false, reason: "too_weak" });
    expect(await adapter.setPin({ organizationId: ORG, membershipId: OTHER_MEM, pin: "12" })).toEqual({ ok: false, reason: "format" });
    expect(await adapter.hasPin(OTHER_MEM)).toBe(false);
  });

  it("changer le PIN exige l'ancien", async () => {
    expect(await adapter.setPin({ organizationId: ORG, membershipId: MEM, pin: "718293" })).toEqual({ ok: false, reason: "current_pin_required" });
    expect(await adapter.setPin({ organizationId: ORG, membershipId: MEM, pin: "718293", currentPin: "000999" })).toEqual({
      ok: false,
      reason: "current_pin_invalid",
    });
    expect(await adapter.setPin({ organizationId: ORG, membershipId: MEM, pin: "718293", currentPin: PIN })).toEqual({ ok: true });
    expect((await adapter.verifyPin(MEM, "718293")).ok).toBe(true);
    expect((await adapter.verifyPin(MEM, PIN)).ok).toBe(false);
  });

  it("compte les essais restants puis verrouille au 5e échec, même avec le bon PIN ensuite", async () => {
    for (const expectedLeft of [4, 3, 2, 1]) {
      expect(await adapter.verifyPin(MEM, "000999")).toEqual({ ok: false, reason: "invalid", attemptsLeft: expectedLeft });
    }
    const fifth = await adapter.verifyPin(MEM, "000999");
    expect(fifth).toMatchObject({ ok: false, reason: "locked" });
    expect(await adapter.verifyPin(MEM, PIN)).toMatchObject({ ok: false, reason: "locked" });

    clock += 5 * 60 * 1000 + 1; // fin du premier verrouillage (5 min)
    expect((await adapter.verifyPin(MEM, PIN)).ok).toBe(true);
  });

  it("verrouillage progressif : 5 min, puis 10 min au palier suivant", async () => {
    for (let i = 0; i < 5; i++) await adapter.verifyPin(MEM, "000999");
    clock += 5 * 60 * 1000 + 1;
    for (let i = 0; i < 4; i++) await adapter.verifyPin(MEM, "000999");
    const second = await adapter.verifyPin(MEM, "000999");
    expect(second.ok === false && second.reason === "locked" && new Date(second.lockedUntil).getTime() - clock).toBe(10 * 60 * 1000);
  });

  it("un succès remet les compteurs à zéro", async () => {
    await adapter.verifyPin(MEM, "000999");
    await adapter.verifyPin(MEM, "000999");
    expect((await adapter.verifyPin(MEM, PIN)).ok).toBe(true);
    expect(await adapter.verifyPin(MEM, "000999")).toEqual({ ok: false, reason: "invalid", attemptsLeft: 4 });
  });

  it("not_set quand aucun PIN n'existe ; resetPin le supprime et l'audite", async () => {
    expect(await adapter.verifyPin(OTHER_MEM, PIN)).toEqual({ ok: false, reason: "not_set" });
    await adapter.resetPin({ organizationId: ORG, membershipId: MEM, resetByUserId: "user-1" });
    expect(await adapter.hasPin(MEM)).toBe(false);
    expect(db.rows("audit_logs").map((r) => r.action)).toContain("STEP_UP_PIN_RESET");
  });
});

describe("défis (challenges)", () => {
  const base = () => ({
    organizationId: ORG,
    membershipId: MEM,
    channel: "telegram" as const,
    purpose: "refund",
    actionFingerprint: fingerprint,
    allowedMethods: ["pin", "dashboard_link"] as ("pin" | "dashboard_link" | "telegram_button")[],
  });

  it("stocke le hachage du lien, jamais le jeton, et borne la durée de vie", async () => {
    const created = await adapter.createChallenge({ ...base(), ttlSeconds: 99999 });
    expect(created.linkToken).toBeTruthy();
    expect(JSON.stringify(db.rows("step_up_challenges"))).not.toContain(created.linkToken!);
    expect(new Date(created.expiresAt).getTime() - clock).toBe(15 * 60 * 1000);
    expect((await adapter.createChallenge({ ...base(), allowedMethods: ["pin"] })).linkToken).toBeUndefined();
  });

  it("refuse un défi sans méthode autorisée", async () => {
    await expect(adapter.createChallenge({ ...base(), allowedMethods: [] })).rejects.toThrow();
  });

  it("parcours complet : PIN -> approuvé -> consommé UNE seule fois", async () => {
    const { challengeId } = await adapter.createChallenge(base());
    expect(await adapter.approveWithPin({ challengeId, membershipId: MEM, pin: PIN })).toEqual({ ok: true, challengeId, method: "pin" });

    const consume = { challengeId, organizationId: ORG, membershipId: MEM, actionFingerprint: fingerprint };
    expect(await adapter.consume(consume)).toEqual({ ok: true });
    expect(await adapter.consume(consume)).toEqual({ ok: false, reason: "already_consumed" });
  });

  it("un défi non approuvé ne peut pas être consommé", async () => {
    const { challengeId } = await adapter.createChallenge(base());
    expect(await adapter.consume({ challengeId, organizationId: ORG, membershipId: MEM, actionFingerprint: fingerprint })).toEqual({
      ok: false,
      reason: "not_approved",
    });
  });

  it("le défi ne vaut que pour l'empreinte exacte : un montant modifié après le « oui » est refusé", async () => {
    const { challengeId } = await adapter.createChallenge(base());
    await adapter.approveWithPin({ challengeId, membershipId: MEM, pin: PIN });
    const tampered = computeActionFingerprint("orders.refund", { orderId: "o1", amount: 500000 });
    expect(await adapter.consume({ challengeId, organizationId: ORG, membershipId: MEM, actionFingerprint: tampered })).toEqual({
      ok: false,
      reason: "fingerprint_mismatch",
    });
    // Et l'action légitime reste consommable ensuite (l'échec n'a rien brûlé).
    expect((await adapter.consume({ challengeId, organizationId: ORG, membershipId: MEM, actionFingerprint: fingerprint })).ok).toBe(true);
  });

  it("expire : ni approbation ni consommation après le délai", async () => {
    const { challengeId } = await adapter.createChallenge({ ...base(), ttlSeconds: 60 });
    clock += 61_000;
    expect(await adapter.approveWithPin({ challengeId, membershipId: MEM, pin: PIN })).toMatchObject({ ok: false, reason: "expired" });

    const second = await adapter.createChallenge({ ...base(), ttlSeconds: 60 });
    await adapter.approveWithPin({ challengeId: second.challengeId, membershipId: MEM, pin: PIN });
    clock += 61_000;
    expect(await adapter.consume({ challengeId: second.challengeId, organizationId: ORG, membershipId: MEM, actionFingerprint: fingerprint })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("un autre membre ne peut ni approuver ni consommer : le défi lui est « introuvable »", async () => {
    const { challengeId } = await adapter.createChallenge(base());
    await adapter.setPin({ organizationId: ORG, membershipId: OTHER_MEM, pin: "718293" });
    expect(await adapter.approveWithPin({ challengeId, membershipId: OTHER_MEM, pin: "718293" })).toMatchObject({ ok: false, reason: "not_found" });
    expect(await adapter.approveWithTelegramButton({ challengeId, membershipId: OTHER_MEM })).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("isolation inter-tenants : consommer avec un autre organizationId échoue", async () => {
    const { challengeId } = await adapter.createChallenge(base());
    await adapter.approveWithPin({ challengeId, membershipId: MEM, pin: PIN });
    expect(await adapter.consume({ challengeId, organizationId: "org-b", membershipId: MEM, actionFingerprint: fingerprint })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("le bouton Telegram est refusé quand le moteur de règles ne l'a pas autorisé (ex. remboursement)", async () => {
    const { challengeId } = await adapter.createChallenge(base()); // pin + dashboard_link seulement
    expect(await adapter.approveWithTelegramButton({ challengeId, membershipId: MEM })).toMatchObject({
      ok: false,
      reason: "method_not_allowed",
    });
    const lowRisk = await adapter.createChallenge({ ...base(), allowedMethods: ["telegram_button"] });
    expect(await adapter.approveWithTelegramButton({ challengeId: lowRisk.challengeId, membershipId: MEM })).toMatchObject({ ok: true });
  });

  it("mauvais PIN : le défi reste en attente et signale les essais restants ; verrouillage propagé", async () => {
    const { challengeId } = await adapter.createChallenge(base());
    expect(await adapter.approveWithPin({ challengeId, membershipId: MEM, pin: "000999" })).toMatchObject({
      ok: false,
      reason: "pin_invalid",
      attemptsLeft: 4,
    });
    for (let i = 0; i < 4; i++) await adapter.approveWithPin({ challengeId, membershipId: MEM, pin: "000999" });
    expect(await adapter.approveWithPin({ challengeId, membershipId: MEM, pin: PIN })).toMatchObject({ ok: false, reason: "locked" });
    expect(db.rows("step_up_challenges")[0]!.status).toBe("pending");
  });

  it("lien dashboard : valide si la SESSION est celle du propriétaire du défi, sinon forbidden", async () => {
    const created = await adapter.createChallenge(base());
    expect(await adapter.approveWithDashboardLink({ linkToken: created.linkToken!, userId: "user-2" })).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await adapter.approveWithDashboardLink({ linkToken: "jeton-inconnu", userId: "user-1" })).toMatchObject({ ok: false, reason: "not_found" });
    expect(await adapter.approveWithDashboardLink({ linkToken: created.linkToken!, userId: "user-1" })).toMatchObject({ ok: true, method: "dashboard_link" });
    // Le lien est à usage unique : rejouer ne ré-approuve rien.
    expect(await adapter.approveWithDashboardLink({ linkToken: created.linkToken!, userId: "user-1" })).toMatchObject({ ok: false, reason: "not_pending" });
  });

  it("refuser un défi le rend inutilisable et l'audite ; seul son propriétaire peut le refuser", async () => {
    const { challengeId } = await adapter.createChallenge(base());
    expect(await adapter.reject({ challengeId, membershipId: OTHER_MEM })).toBe(false);
    expect(await adapter.reject({ challengeId, membershipId: MEM })).toBe(true);
    expect(await adapter.approveWithPin({ challengeId, membershipId: MEM, pin: PIN })).toMatchObject({ ok: false, reason: "not_pending" });
    expect(db.rows("audit_logs").map((r) => r.action)).toContain("STEP_UP_REJECTED");
  });

  it("deux consommations concurrentes : une seule réussit", async () => {
    const { challengeId } = await adapter.createChallenge(base());
    await adapter.approveWithPin({ challengeId, membershipId: MEM, pin: PIN });
    const input = { challengeId, organizationId: ORG, membershipId: MEM, actionFingerprint: fingerprint };
    const results = await Promise.all([adapter.consume(input), adapter.consume(input)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("isApproved : vrai seulement pour le propriétaire, défi approuvé et non expiré (lecture seule)", async () => {
    const { challengeId } = await adapter.createChallenge(base());
    expect(await adapter.isApproved({ challengeId, membershipId: MEM })).toBe(false);
    await adapter.approveWithPin({ challengeId, membershipId: MEM, pin: PIN });
    expect(await adapter.isApproved({ challengeId, membershipId: MEM })).toBe(true);
    expect(await adapter.isApproved({ challengeId, membershipId: OTHER_MEM })).toBe(false);
    expect(db.rows("step_up_challenges")[0]!.status).toBe("approved"); // rien consommé
    clock += 301_000;
    expect(await adapter.isApproved({ challengeId, membershipId: MEM })).toBe(false);
  });
});
