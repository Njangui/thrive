/**
 * Erreurs applicatives typées — section 48 : séparer validation error,
 * authorization error, provider error, database error, AI error, webhook
 * error. Permet aux routes de mapper vers le bon status HTTP sans exposer
 * de détails internes au client (jamais de stack trace / message DB brut).
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly kind: "validation" | "authorization" | "authentication" | "provider" | "database" | "ai" | "webhook" | "not_found" | "quota",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Authentification requise") {
    super(message, 401, "authentication");
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "Action non autorisée pour ce rôle") {
    super(message, 403, "authorization");
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, "validation");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Ressource introuvable") {
    super(message, 404, "not_found");
  }
}

/**
 * Lot B (section 62) : levée par `canUseFeature()` / les points
 * d'application (ex: marketing-service.ts) quand une action dépasse la
 * limite du plan de l'organisation. 403 plutôt que 402 : aucun paiement
 * réel n'est intégré dans ce lot (hors scope), donc pas de sémantique
 * "paiement requis" à proprement parler — juste "non autorisé par
 * l'offre actuelle". Le message doit rester en vocabulaire non technique
 * (section 00_CONVENTIONS_COMMUNES.md), directement affichable au
 * commerçant.
 */
export class QuotaExceededError extends AppError {
  constructor(message: string) {
    super(message, 403, "quota");
  }
}

/** Réponse JSON safe pour le client — jamais le message brut d'une erreur non-AppError. */
export function toClientErrorResponse(error: unknown): { status: number; body: { error: string } } {
  if (error instanceof AppError) {
    return { status: error.httpStatus, body: { error: error.message } };
  }
  // Erreur non anticipée : on logge le détail côté serveur (à l'appelant de
  // le faire avant d'appeler cette fonction) mais on ne le renvoie jamais
  // au client (section 48 : ne jamais exposer d'info sensible).
  return { status: 500, body: { error: "Erreur interne" } };
}
