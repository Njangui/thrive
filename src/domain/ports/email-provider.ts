/**
 * EmailProvider — port métier (Lot L, comme demandé dans
 * 00_CONVENTIONS_COMMUNES_V3.md : "aucun fournisseur d'email n'existe
 * dans ce projet", à combler en suivant le pattern déjà établi pour
 * MessagingProvider/AIProvider/PaymentProvider).
 *
 * L'application appelle uniquement cette interface via
 * `getEmailProvider()` (registry.ts) — jamais un SDK/fetch Resend
 * directement en dehors de `infrastructure/providers/email/*`.
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  /** Optionnel — généré depuis `html` par Resend si omis (confirmé, voir resend/client.ts). */
  text?: string;
}

export interface SendEmailResult {
  /**
   * true seulement si l'email a réellement été transmis à un fournisseur
   * externe. Toujours false pour le fallback console (voir
   * console-log/adapter.ts) — jamais un faux succès quand rien n'a été
   * envoyé (cahier 00_CONVENTIONS_COMMUNES_V3.md, Partie EmailProvider).
   */
  delivered: boolean;
  /** Id du message côté fournisseur, quand disponible (ex: `id` Resend). */
  providerMessageId?: string;
}

export interface EmailProvider {
  readonly providerName: string;
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
}
