/**
 * Formes de données CONFIRMÉES sur resend.com/docs (consulté le 31 août
 * 2026, même rigueur que pour Zernio/NotchPay — jamais deviné) :
 * - Base URL : https://api.resend.com
 * - Auth : header `Authorization: Bearer <clé>` (comme Zernio, à la
 *   différence de NotchPay qui n'a pas de préfixe "Bearer").
 * - POST /emails — envoi. Réponse succès : `{ "id": "<uuid>" }` UNIQUEMENT
 *   (voir resend.com/docs/api-reference/emails/send-email).
 * - Erreur : corps JSON `{ statusCode, name, message }` (confirmé via le
 *   SDK officiel Go, `InvalidRequestError`, qui documente le contrat REST
 *   sous-jacent — resend.com/docs/api-reference/errors pour le détail par
 *   code).
 * - Limitation opérationnelle CONFIRMÉE (resend.com/docs/knowledge-base/403-error-resend-dev-domain) :
 *   tant qu'aucun domaine n'est vérifié dans le compte Resend, l'adresse
 *   d'expédition `*@resend.dev` ne peut envoyer QUE vers l'adresse email
 *   du titulaire du compte — pas vers un destinataire arbitraire (donc pas
 *   vers un vrai email d'invitation d'équipe). Voir RAPPORT_LOT_L.md pour
 *   comment ce lot absorbe cette contrainte sans bloquer la fonctionnalité.
 */

export interface ResendSendEmailPayload {
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
}

export interface ResendSendEmailResponse {
  id: string;
}

export interface ResendErrorResponse {
  statusCode: number;
  name: string;
  message: string;
}
