/**
 * StepUpPort — authentification renforcée (C2, contrat partagé avec C1).
 *
 * Rôle : prouver, au moment d'une action sensible, que c'est bien le membre
 * (et pas quelqu'un qui a volé son téléphone ou échangé sa SIM) qui valide.
 * Un « défi » (challenge) est lié à l'EMPREINTE exacte de l'action : il ne vaut
 * que pour elle, une seule fois, pendant une durée courte.
 *
 * Qui décide de la méthode exigée ? Le moteur de règles de C1 (`evaluateAction`)
 * choisit `allowedMethods` selon le risque (ex. remboursement : PIN ou lien
 * dashboard, JAMAIS le bouton Telegram seul). Ce port ne décide pas, il vérifie.
 */
export type StepUpMethod = "pin" | "dashboard_link" | "telegram_button";
export type StepUpChannel = "dashboard" | "telegram" | "whatsapp";

export interface CreateChallengeInput {
  organizationId: string;
  membershipId: string;
  channel: StepUpChannel;
  /** Libellé métier ('refund', 'price_change'…) : affichage et audit. */
  purpose: string;
  /** sha256 hex de l'action (voir computeActionFingerprint). */
  actionFingerprint: string;
  allowedMethods: StepUpMethod[];
  /** Lien vers la carte d'approbation de C1 (`pending_actions`), si elle existe. */
  pendingActionId?: string;
  /** Durée de validité (secondes) ; bornée à 60-900, 300 par défaut. */
  ttlSeconds?: number;
}

export interface CreatedChallenge {
  challengeId: string;
  expiresAt: string;
  allowedMethods: StepUpMethod[];
  /** Jeton du lien dashboard — en clair UNE seule fois (seul son hachage est stocké). */
  linkToken?: string;
}

export type PinVerification =
  | { ok: true }
  | { ok: false; reason: "not_set" }
  | { ok: false; reason: "invalid"; attemptsLeft: number }
  | { ok: false; reason: "locked"; lockedUntil: string };

export type SetPinResult =
  | { ok: true }
  | { ok: false; reason: "format" | "too_weak" | "current_pin_required" | "current_pin_invalid" | "locked" };

export type ApproveFailure =
  | "not_found"
  | "forbidden"
  | "method_not_allowed"
  | "expired"
  | "not_pending"
  | "pin_not_set"
  | "pin_invalid"
  | "locked";

export type ApproveResult =
  | { ok: true; challengeId: string; method: StepUpMethod }
  | { ok: false; reason: ApproveFailure; attemptsLeft?: number; lockedUntil?: string };

export type ConsumeResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_approved" | "expired" | "fingerprint_mismatch" | "already_consumed" };

export interface StepUpPort {
  hasPin(membershipId: string): Promise<boolean>;
  /** Définit un PIN (premier réglage) ou le change (exige l'ancien). */
  setPin(input: { organizationId: string; membershipId: string; pin: string; currentPin?: string }): Promise<SetPinResult>;
  /** Supprime le PIN (réinitialisation depuis une session dashboard authentifiée). Audité. */
  resetPin(input: { organizationId: string; membershipId: string; resetByUserId: string }): Promise<void>;
  verifyPin(membershipId: string, pin: string): Promise<PinVerification>;

  createChallenge(input: CreateChallengeInput): Promise<CreatedChallenge>;
  approveWithPin(input: { challengeId: string; membershipId: string; pin: string }): Promise<ApproveResult>;
  /** Lien ouvert dans le dashboard : `userId` vient de la SESSION, jamais du lien. */
  approveWithDashboardLink(input: { linkToken: string; userId: string }): Promise<ApproveResult>;
  /** `membershipId` vient de l'identité Telegram résolue (resolveActor), jamais du callback brut. */
  approveWithTelegramButton(input: { challengeId: string; membershipId: string }): Promise<ApproveResult>;
  reject(input: { challengeId: string; membershipId: string }): Promise<boolean>;
  /**
   * Le défi est-il DÉJÀ approuvé (ex. via le lien dashboard ouvert à part) et non
   * expiré, pour CE membre ? Lecture seule : ne consomme rien.
   */
  isApproved(input: { challengeId: string; membershipId: string }): Promise<boolean>;

  /** Usage unique, atomique : à appeler par le moteur de règles juste avant d'exécuter l'action. */
  consume(input: {
    challengeId: string;
    organizationId: string;
    membershipId: string;
    actionFingerprint: string;
  }): Promise<ConsumeResult>;
}
