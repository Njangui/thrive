import type { EmailProvider, SendEmailInput, SendEmailResult } from "@/domain/ports/email-provider";
import { BrevoClient } from "./client";

/** Accepte « Nom <adresse@domaine> » ou « adresse@domaine ». */
export function parseSender(from: string): { name?: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  if (m) {
    const name = (m[1] ?? "").replace(/^"|"$/g, "");
    const email = (m[2] ?? "").trim();
    return name ? { name, email } : { email };
  }
  return { email: from.trim() };
}

export class BrevoAdapter implements EmailProvider {
  readonly providerName = "brevo";

  constructor(
    private readonly client: BrevoClient,
    private readonly fromAddress: string,
  ) {}

  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const result = await this.client.sendEmail({
      sender: parseSender(this.fromAddress),
      to: [{ email: input.to }],
      subject: input.subject,
      htmlContent: input.html,
      ...(input.text ? { textContent: input.text } : {}),
    });
    return { delivered: true, providerMessageId: result.messageId };
  }
}
