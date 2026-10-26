/**
 * Client HTTP bas niveau Brevo (ex-Sendinblue) — email transactionnel.
 * Doc officielle : POST https://api.brevo.com/v3/smtp/email, en-tête `api-key`,
 * corps { sender, to, subject, htmlContent, textContent? }, réponse 201 { messageId }.
 * (https://developers.brevo.com/reference/sendtransacemail)
 */
export interface BrevoSendPayload {
  sender: { name?: string; email: string };
  to: { email: string; name?: string }[];
  subject: string;
  htmlContent: string;
  textContent?: string;
}

export class BrevoClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = "https://api.brevo.com",
  ) {}

  async sendEmail(payload: BrevoSendPayload): Promise<{ messageId?: string }> {
    if (!this.apiKey) {
      throw new Error("BREVO_API_KEY manquant — BrevoClient ne devrait pas être instancié sans clé (voir registry.ts::getEmailProvider).");
    }
    const res = await fetch(`${this.baseUrl}/v3/smtp/email`, {
      method: "POST",
      headers: { "api-key": this.apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => null)) as { messageId?: string; code?: string; message?: string } | null;
    if (!res.ok) {
      throw new Error(`Brevo sendEmail failed (${res.status}${body?.code ? ` ${body.code}` : ""}): ${body?.message ?? "réponse illisible"}`);
    }
    return { messageId: body?.messageId };
  }
}
