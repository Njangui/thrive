import { getNotificationProvider } from "@/infrastructure/providers/registry";

export type PlatformTelegramEvent =
  | "ORGANIZATION_CREATED"
  | "ORGANIZATION_SUSPENDED"
  | "ORGANIZATION_ACTIVATED"
  | "ORGANIZATION_PLAN_CHANGED"
  | "SUBSCRIPTION_PAYMENT_COMPLETED"
  | "SUBSCRIPTION_PAYMENT_FAILED"
  | "SUBSCRIPTION_EXPIRED"
  | "TELEGRAM_CHANNEL_CONNECTED"
  | "TELEGRAM_CHANNEL_DISCONNECTED"
  | "PROVIDER_CONNECTION_LOST"
  | "AFFILIATE_APPLICATION_CREATED"
  | "AFFILIATE_FRAUD_DETECTED"
  | "AFFILIATE_PAYOUT_REQUESTED"
  | "AFFILIATE_PAYOUT_PAID"
  | "AFFILIATE_PAYOUT_REJECTED"
  | "AFFILIATE_APPROVED"
  | "AFFILIATE_REJECTED"
  | "AFFILIATE_SUSPENDED"
  | "DOMAIN_REQUESTED"
  | "DOMAIN_REQUEST_RESOLVED"
  | "ADDON_CREATED"
  | "ADDON_UPDATED"
  | "AI_CREDITS_GRANTED";

const EVENT_LABELS: Record<PlatformTelegramEvent, { icon: string; label: string }> = {
  ORGANIZATION_CREATED: { icon: "🆕", label: "Nouvelle entreprise" },
  ORGANIZATION_SUSPENDED: { icon: "⛔", label: "Entreprise suspendue" },
  ORGANIZATION_ACTIVATED: { icon: "✅", label: "Entreprise réactivée" },
  ORGANIZATION_PLAN_CHANGED: { icon: "💳", label: "Forfait modifié" },
  SUBSCRIPTION_PAYMENT_COMPLETED: { icon: "💰", label: "Paiement confirmé" },
  SUBSCRIPTION_PAYMENT_FAILED: { icon: "⚠️", label: "Paiement échoué" },
  SUBSCRIPTION_EXPIRED: { icon: "⏰", label: "Abonnement expiré" },
  TELEGRAM_CHANNEL_CONNECTED: { icon: "📲", label: "Bot Telegram connecté" },
  TELEGRAM_CHANNEL_DISCONNECTED: { icon: "🔌", label: "Bot Telegram déconnecté" },
  PROVIDER_CONNECTION_LOST: { icon: "🔴", label: "Connexion fournisseur perdue" },
  AFFILIATE_APPLICATION_CREATED: { icon: "🤝", label: "Nouvelle candidature affilié" },
  AFFILIATE_FRAUD_DETECTED: { icon: "🚨", label: "Alerte anti-fraude" },
  AFFILIATE_PAYOUT_REQUESTED: { icon: "💸", label: "Demande de paiement affilié" },
  AFFILIATE_PAYOUT_PAID: { icon: "🏦", label: "Paiement affilié effectué" },
  AFFILIATE_PAYOUT_REJECTED: { icon: "↩️", label: "Paiement affilié rejeté" },
  AFFILIATE_APPROVED: { icon: "👍", label: "Affilié approuvé" },
  AFFILIATE_REJECTED: { icon: "👎", label: "Affilié refusé" },
  AFFILIATE_SUSPENDED: { icon: "⛔", label: "Affilié suspendu" },
  DOMAIN_REQUESTED: { icon: "🌐", label: "Demande de domaine" },
  DOMAIN_REQUEST_RESOLVED: { icon: "🌐", label: "Domaine traité" },
  ADDON_CREATED: { icon: "🧩", label: "Add-on créé" },
  ADDON_UPDATED: { icon: "🧩", label: "Add-on modifié" },
  AI_CREDITS_GRANTED: { icon: "✨", label: "Crédits IA attribués" },
};

export interface PlatformTelegramEventDetails {
  organizationId?: string | null;
  entityType?: string;
  entityId?: string | null;
  details?: Record<string, string | number | boolean | null | undefined>;
}

/**
 * Canal Telegram de l'opérateur : notification de supervision, pas canal
 * client. Tous les événements passent ici avec un code explicite afin de
 * ne jamais dépendre d'un regex sur le titre d'une notification tenant.
 */
export async function notifyPlatformAdminTelegram(
  event: PlatformTelegramEvent,
  details: PlatformTelegramEventDetails = {},
): Promise<void> {
  try {
    const notifier = await getNotificationProvider();
    const meta = EVENT_LABELS[event];
    const lines = [
      `${meta.icon} tokoo  · ${meta.label}`,
      details.organizationId ? `Entreprise : ${details.organizationId}` : "Portée : plateforme",
      details.entityType ? `Type : ${details.entityType}` : null,
      details.entityId ? `ID : ${details.entityId}` : null,
      ...Object.entries(details.details ?? {}).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => `${key} : ${String(value)}`),
    ].filter(Boolean);

    await notifier.send({
      title: `${meta.icon} ${meta.label}`,
      body: lines.slice(1).join("\n"),
      channel: "telegram",
      relatedEntityType: details.entityType,
      relatedEntityId: details.entityId ?? details.organizationId ?? undefined,
    });
  } catch (error) {
    console.warn(`[telegram-admin] notification ${event} non envoyée:`, error);
  }
}

/** Compatibilité pour les services qui envoient déjà une alerte opérateur textuelle. */
export async function notifyPlatformAdminMessage(
  title: string,
  body: string,
  relatedEntityType?: string,
  relatedEntityId?: string,
): Promise<void> {
  try {
    const notifier = await getNotificationProvider();
    await notifier.send({ title: `tokoo  · ${title}`, body, channel: "telegram", relatedEntityType, relatedEntityId });
  } catch (error) {
    console.warn("[telegram-admin] message opérateur non envoyé:", error);
  }
}
