/**
 * NotificationProvider — port métier (section 28).
 * Utilisé pour notifier un admin/employé (pas le client final, qui passe
 * par MessagingProvider). V1 peut n'implémenter qu'un canal (ex: email ou
 * WhatsApp interne) sans que le domaine ne le sache.
 */

export interface NotificationRequest {
  /**
   * Optionnel : le premier appelant réel de ce port (alertes plateforme
   * du programme d'affiliation, voir affiliate-service.ts) n'est scopé à
   * AUCUNE organisation — ni `organizationId` ni `recipientUserId` n'ont
   * de sens pour "l'opérateur flexco " dans son ensemble. Un futur usage
   * PAR TENANT (ex: notifier l'owner d'une organisation) les renseignera.
   */
  organizationId?: string;
  recipientUserId?: string;
  title: string;
  body: string;
  // "telegram" ajouté pour les alertes opérateur plateforme (programme
  // d'affiliation) — adapter dans infrastructure/providers/telegram/,
  // ENTIÈREMENT indépendant de MessagingProvider/ZernioAdapter (canal
  // whatsapp ci-dessous) : aucun import croisé entre les deux.
  channel?: "email" | "sms" | "push" | "whatsapp" | "telegram";
  relatedEntityType?: string;
  relatedEntityId?: string;
}

export interface NotificationProvider {
  readonly providerName: string;

  send(request: NotificationRequest): Promise<{ delivered: boolean }>;
}
