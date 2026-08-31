/**
 * NotificationProvider — port métier (section 28).
 * Utilisé pour notifier un admin/employé (pas le client final, qui passe
 * par MessagingProvider). V1 peut n'implémenter qu'un canal (ex: email ou
 * WhatsApp interne) sans que le domaine ne le sache.
 */

export interface NotificationRequest {
  organizationId: string;
  recipientUserId: string;
  title: string;
  body: string;
  channel?: "email" | "sms" | "push" | "whatsapp";
  relatedEntityType?: string;
  relatedEntityId?: string;
}

export interface NotificationProvider {
  readonly providerName: string;

  send(request: NotificationRequest): Promise<{ delivered: boolean }>;
}
