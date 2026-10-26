import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { hashPin, verifyPinHash } from "@/infrastructure/security/pin-hasher";
import { hashSecret } from "@/application/channels/channel-codes";
import {
  PIN_BASE_LOCK_SECONDS,
  PIN_MAX_ATTEMPTS,
  validatePinFormat,
} from "@/application/channels/pin-policy";
import type {
  ApproveResult,
  ConsumeResult,
  CreateChallengeInput,
  CreatedChallenge,
  PinVerification,
  SetPinResult,
  StepUpMethod,
  StepUpPort,
} from "@/domain/ports/step-up-port";

const DEFAULT_TTL_S = 300;
const MIN_TTL_S = 60;
const MAX_TTL_S = 900;

interface ChallengeRow {
  id: string;
  organization_id: string;
  membership_id: string;
  purpose: string;
  action_fingerprint: string | null;
  allowed_methods: StepUpMethod[];
  status: "pending" | "approved" | "rejected" | "expired" | "consumed";
  expires_at: string;
}

/**
 * Adaptateur Supabase de StepUpPort. Utilise service_role : CHAQUE requête est
 * donc filtrée explicitement par challenge/membership/organisation (règle d'or
 * section 35). Les identifiants d'acteur viennent toujours d'un appelant déjà
 * authentifié (session ou identité de canal résolue), jamais du contenu d'un
 * message.
 */
export class SupabaseStepUpAdapter implements StepUpPort {
  constructor(
    private readonly db: SupabaseClient = getSupabaseServiceClient(),
    private readonly pepper: string | undefined = process.env.STEP_UP_PIN_PEPPER,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async hasPin(membershipId: string): Promise<boolean> {
    const { data, error } = await this.db.from("step_up_pins").select("membership_id").eq("membership_id", membershipId).maybeSingle();
    if (error) throw new Error(`StepUp: lecture PIN impossible: ${error.message}`);
    return Boolean(data);
  }

  async setPin(input: { organizationId: string; membershipId: string; pin: string; currentPin?: string }): Promise<SetPinResult> {
    const format = validatePinFormat(input.pin);
    if (!format.ok) return { ok: false, reason: format.error };

    const existing = await this.hasPin(input.membershipId);
    if (existing) {
      if (!input.currentPin) return { ok: false, reason: "current_pin_required" };
      const check = await this.verifyPin(input.membershipId, input.currentPin);
      if (!check.ok) {
        if (check.reason === "locked") return { ok: false, reason: "locked" };
        return { ok: false, reason: "current_pin_invalid" };
      }
    }

    const pinHash = await hashPin(input.pin, this.pepper);
    const { error } = await this.db.from("step_up_pins").upsert(
      {
        membership_id: input.membershipId,
        organization_id: input.organizationId,
        pin_hash: pinHash,
        failed_attempts: 0,
        lockout_count: 0,
        locked_until: null,
        set_at: new Date(this.now()).toISOString(),
      },
      { onConflict: "membership_id" },
    );
    if (error) throw new Error(`StepUp: enregistrement du PIN impossible: ${error.message}`);
    await this.audit(input.organizationId, null, existing ? "STEP_UP_PIN_CHANGED" : "STEP_UP_PIN_SET", input.membershipId);
    return { ok: true };
  }

  async resetPin(input: { organizationId: string; membershipId: string; resetByUserId: string }): Promise<void> {
    const { error } = await this.db
      .from("step_up_pins")
      .delete()
      .eq("membership_id", input.membershipId)
      .eq("organization_id", input.organizationId);
    if (error) throw new Error(`StepUp: réinitialisation du PIN impossible: ${error.message}`);
    await this.audit(input.organizationId, input.resetByUserId, "STEP_UP_PIN_RESET", input.membershipId);
  }

  async verifyPin(membershipId: string, pin: string): Promise<PinVerification> {
    const { data, error } = await this.db
      .from("step_up_pins")
      .select("pin_hash, locked_until")
      .eq("membership_id", membershipId)
      .maybeSingle();
    if (error) throw new Error(`StepUp: lecture PIN impossible: ${error.message}`);
    if (!data) return { ok: false, reason: "not_set" };

    if (data.locked_until && new Date(data.locked_until as string).getTime() > this.now()) {
      return { ok: false, reason: "locked", lockedUntil: data.locked_until as string };
    }

    const valid = await verifyPinHash(pin, data.pin_hash as string, this.pepper);
    if (valid) {
      const { error: successError } = await this.db.rpc("step_up_record_success", { p_membership_id: membershipId });
      if (successError) console.error("[step-up] réinitialisation des compteurs impossible:", successError.message);
      return { ok: true };
    }

    const { data: failure, error: failureError } = await this.db.rpc("step_up_record_failure", {
      p_membership_id: membershipId,
      p_max_attempts: PIN_MAX_ATTEMPTS,
      p_base_lock_seconds: PIN_BASE_LOCK_SECONDS,
    });
    if (failureError) throw new Error(`StepUp: enregistrement de l'échec impossible: ${failureError.message}`);
    const row = (Array.isArray(failure) ? failure[0] : failure) as
      | { failed_attempts: number; locked_until: string | null }
      | undefined;
    if (row?.locked_until && new Date(row.locked_until).getTime() > this.now()) {
      return { ok: false, reason: "locked", lockedUntil: row.locked_until };
    }
    return { ok: false, reason: "invalid", attemptsLeft: Math.max(0, PIN_MAX_ATTEMPTS - (row?.failed_attempts ?? 0)) };
  }

  async createChallenge(input: CreateChallengeInput): Promise<CreatedChallenge> {
    if (input.allowedMethods.length === 0) throw new Error("StepUp: au moins une méthode de validation est requise.");
    const ttl = Math.min(MAX_TTL_S, Math.max(MIN_TTL_S, input.ttlSeconds ?? DEFAULT_TTL_S));
    const expiresAt = new Date(this.now() + ttl * 1000).toISOString();
    const linkToken = input.allowedMethods.includes("dashboard_link") ? randomBytes(32).toString("base64url") : undefined;

    const { data, error } = await this.db
      .from("step_up_challenges")
      .insert({
        organization_id: input.organizationId,
        membership_id: input.membershipId,
        channel: input.channel,
        purpose: input.purpose,
        action_fingerprint: input.actionFingerprint,
        pending_action_id: input.pendingActionId ?? null,
        allowed_methods: input.allowedMethods,
        link_token_hash: linkToken ? hashSecret(linkToken) : null,
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`StepUp: création du défi impossible: ${error?.message ?? "inconnue"}`);

    return { challengeId: data.id as string, expiresAt, allowedMethods: input.allowedMethods, linkToken };
  }

  async approveWithPin(input: { challengeId: string; membershipId: string; pin: string }): Promise<ApproveResult> {
    const challenge = await this.loadChallenge("id", input.challengeId);
    const gate = this.checkApprovable(challenge, "pin", input.membershipId);
    if (gate) return gate;

    const verification = await this.verifyPin(input.membershipId, input.pin);
    if (!verification.ok) {
      if (verification.reason === "not_set") return { ok: false, reason: "pin_not_set" };
      if (verification.reason === "locked") return { ok: false, reason: "locked", lockedUntil: verification.lockedUntil };
      return { ok: false, reason: "pin_invalid", attemptsLeft: verification.attemptsLeft };
    }
    return this.markApproved(challenge!, "pin");
  }

  async approveWithDashboardLink(input: { linkToken: string; userId: string }): Promise<ApproveResult> {
    const challenge = await this.loadChallenge("link_token_hash", hashSecret(input.linkToken));
    if (!challenge) return { ok: false, reason: "not_found" };

    // Le membre propriétaire du défi doit être l'utilisateur de la SESSION.
    const { data: membership, error } = await this.db
      .from("memberships")
      .select("user_id")
      .eq("id", challenge.membership_id)
      .eq("organization_id", challenge.organization_id)
      .maybeSingle();
    if (error) throw new Error(`StepUp: lecture du membership impossible: ${error.message}`);
    if (!membership || membership.user_id !== input.userId) return { ok: false, reason: "forbidden" };

    const gate = this.checkApprovable(challenge, "dashboard_link", challenge.membership_id);
    if (gate) return gate;
    return this.markApproved(challenge, "dashboard_link");
  }

  async approveWithTelegramButton(input: { challengeId: string; membershipId: string }): Promise<ApproveResult> {
    const challenge = await this.loadChallenge("id", input.challengeId);
    const gate = this.checkApprovable(challenge, "telegram_button", input.membershipId);
    if (gate) return gate;
    return this.markApproved(challenge!, "telegram_button");
  }

  async reject(input: { challengeId: string; membershipId: string }): Promise<boolean> {
    const { data, error } = await this.db
      .from("step_up_challenges")
      .update({ status: "rejected" })
      .eq("id", input.challengeId)
      .eq("membership_id", input.membershipId)
      .eq("status", "pending")
      .select("id, organization_id");
    if (error) throw new Error(`StepUp: refus du défi impossible: ${error.message}`);
    const row = data?.[0];
    if (row) await this.audit(row.organization_id as string, null, "STEP_UP_REJECTED", input.membershipId, input.challengeId);
    return Boolean(row);
  }

  async isApproved(input: { challengeId: string; membershipId: string }): Promise<boolean> {
    const challenge = await this.loadChallenge("id", input.challengeId);
    return Boolean(
      challenge &&
        challenge.membership_id === input.membershipId &&
        challenge.status === "approved" &&
        new Date(challenge.expires_at).getTime() > this.now(),
    );
  }

  async consume(input: {
    challengeId: string;
    organizationId: string;
    membershipId: string;
    actionFingerprint: string;
  }): Promise<ConsumeResult> {
    const nowIso = new Date(this.now()).toISOString();
    // UPDATE conditionnel unique : seul UN appelant peut passer approved -> consumed.
    const { data, error } = await this.db
      .from("step_up_challenges")
      .update({ status: "consumed", consumed_at: nowIso })
      .eq("id", input.challengeId)
      .eq("organization_id", input.organizationId)
      .eq("membership_id", input.membershipId)
      .eq("action_fingerprint", input.actionFingerprint)
      .eq("status", "approved")
      .gt("expires_at", nowIso)
      .select("id");
    if (error) throw new Error(`StepUp: consommation du défi impossible: ${error.message}`);
    if (data && data.length > 0) {
      await this.audit(input.organizationId, null, "STEP_UP_CONSUMED", input.membershipId, input.challengeId);
      return { ok: true };
    }

    // Diagnostic de l'échec (sans révéler d'information à un autre tenant).
    const challenge = await this.loadChallenge("id", input.challengeId);
    if (!challenge || challenge.organization_id !== input.organizationId || challenge.membership_id !== input.membershipId) {
      return { ok: false, reason: "not_found" };
    }
    if (challenge.status === "consumed") return { ok: false, reason: "already_consumed" };
    if (challenge.action_fingerprint !== input.actionFingerprint) return { ok: false, reason: "fingerprint_mismatch" };
    if (challenge.status === "approved" && new Date(challenge.expires_at).getTime() <= this.now()) return { ok: false, reason: "expired" };
    if (challenge.status === "expired") return { ok: false, reason: "expired" };
    return { ok: false, reason: "not_approved" };
  }

  // ---- internes ----------------------------------------------------------

  private async loadChallenge(column: "id" | "link_token_hash", value: string): Promise<ChallengeRow | null> {
    const { data, error } = await this.db
      .from("step_up_challenges")
      .select("id, organization_id, membership_id, purpose, action_fingerprint, allowed_methods, status, expires_at")
      .eq(column, value)
      .maybeSingle();
    if (error) throw new Error(`StepUp: lecture du défi impossible: ${error.message}`);
    return (data as ChallengeRow | null) ?? null;
  }

  /** Vérifie propriétaire, méthode autorisée, statut et expiration. null = approuvable. */
  private checkApprovable(
    challenge: ChallengeRow | null,
    method: StepUpMethod,
    membershipId: string,
  ): Extract<ApproveResult, { ok: false }> | null {
    if (!challenge) return { ok: false, reason: "not_found" };
    // Un défi appartenant à un autre membre est présenté comme introuvable : on
    // ne confirme pas son existence.
    if (challenge.membership_id !== membershipId) return { ok: false, reason: "not_found" };
    if (!challenge.allowed_methods.includes(method)) return { ok: false, reason: "method_not_allowed" };
    if (challenge.status !== "pending") return { ok: false, reason: "not_pending" };
    if (new Date(challenge.expires_at).getTime() <= this.now()) return { ok: false, reason: "expired" };
    return null;
  }

  private async markApproved(challenge: ChallengeRow, method: StepUpMethod): Promise<ApproveResult> {
    const nowIso = new Date(this.now()).toISOString();
    const { data, error } = await this.db
      .from("step_up_challenges")
      .update({ status: "approved", approved_method: method, approved_at: nowIso })
      .eq("id", challenge.id)
      .eq("status", "pending")
      .gt("expires_at", nowIso)
      .select("id");
    if (error) throw new Error(`StepUp: validation du défi impossible: ${error.message}`);
    if (!data || data.length === 0) return { ok: false, reason: "not_pending" };
    await this.audit(challenge.organization_id, null, "STEP_UP_APPROVED", challenge.membership_id, challenge.id, { method, purpose: challenge.purpose });
    return { ok: true, challengeId: challenge.id, method };
  }

  private async audit(
    organizationId: string,
    actorUserId: string | null,
    action: string,
    membershipId: string,
    challengeId?: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    // Piste d'audit : jamais bloquante pour l'authentification elle-même, mais
    // une défaillance est LOGUÉE bruyamment (aucun PIN/jeton dans le message).
    const { error } = await this.db.from("audit_logs").insert({
      organization_id: organizationId,
      actor_user_id: actorUserId,
      action,
      entity_type: challengeId ? "step_up_challenge" : "membership",
      entity_id: challengeId ?? membershipId,
      after_state: { membership_id: membershipId, ...extra },
    });
    if (error) console.error(`[step-up] audit ${action} non écrit:`, error.message);
  }
}
