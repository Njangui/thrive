import { hasFeature } from "./entitlements-service";
import { getSocialAccountByAccountId } from "./social-account-registry-service";

/**
 * Lot O — messagerie unifiée : quels canaux entrants une organisation
 * peut-elle recevoir, et avec quelles réponses automatiques ?
 * WhatsApp et Telegram sont toujours acceptés (leurs propres quotas de
 * comptes s'appliquent à la connexion) ; Messenger dès Starter, Instagram
 * en Pro (`facebook_messenger` / `instagram_messages`).
 */
export const INBOX_ENTITLEMENT_BY_CHANNEL: Record<string, string | null> = {
  whatsapp: null,
  telegram: null,
  facebook: "facebook_messenger",
  instagram: "instagram_messages",
};

export const INBOX_CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  facebook: "Messenger",
  instagram: "Instagram",
};

export interface InboxChannelDecision {
  allowed: boolean;
  autoReply: boolean;
  reason?: string;
}

export async function evaluateInboxChannel(
  organizationId: string,
  channel: string,
  providerAccountId?: string | null,
): Promise<InboxChannelDecision> {
  if (!(channel in INBOX_ENTITLEMENT_BY_CHANNEL)) return { allowed: true, autoReply: true };
  const entitlementKey = INBOX_ENTITLEMENT_BY_CHANNEL[channel];
  if (!entitlementKey) return { allowed: true, autoReply: true };

  if (!(await hasFeature(organizationId, entitlementKey))) {
    return { allowed: false, autoReply: false, reason: `${INBOX_CHANNEL_LABELS[channel] ?? channel} n'est pas inclus dans l'offre.` };
  }
  // Messenger / Instagram : le compte doit appartenir à l'organisation (registre) ; le réglage
  // « réponses automatiques » est porté par compte.
  const account = providerAccountId ? await getSocialAccountByAccountId(providerAccountId) : null;
  if (!account || account.organizationId !== organizationId || account.status !== "connected") {
    return { allowed: false, autoReply: false, reason: "Compte social inconnu ou déconnecté pour cette organisation." };
  }
  return { allowed: true, autoReply: account.autoReplyMessages };
}
