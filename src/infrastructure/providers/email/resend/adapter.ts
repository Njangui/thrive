import type { EmailProvider, SendEmailInput, SendEmailResult } from "@/domain/ports/email-provider";
import { ResendClient } from "./client";

export class ResendAdapter implements EmailProvider {
  readonly providerName = "resend";

  constructor(
    private readonly client: ResendClient,
    private readonly fromAddress: string,
  ) {}

  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const result = await this.client.sendEmail({
      from: this.fromAddress,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    });

    return { delivered: true, providerMessageId: result.id };
  }
}
