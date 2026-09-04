import type { EmailProvider, SendEmailInput, SendEmailResult } from "@/domain/ports/email-provider";

/**
 * Fallback quand aucune clé API email n'est configurée (cahier Lot L :
 * "le provider doit logger l'email au lieu d'échouer silencieusement...
 * jamais un faux succès non plus"). `delivered: false` sans exception —
 * les appelants (team-service.ts::inviteMember) doivent afficher ce cas
 * clairement (ex: lien d'invitation à partager manuellement) plutôt que
 * de laisser croire qu'un email est parti.
 */
export class ConsoleLogEmailAdapter implements EmailProvider {
  readonly providerName = "console-log";

  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    console.warn(
      `[email] NON ENVOYÉ (RESEND_API_KEY absente) — destinataire: ${input.to}, sujet: "${input.subject}". ` +
        `Configurez RESEND_API_KEY (voir .env.example) pour un envoi réel.`,
    );
    return { delivered: false };
  }
}
