import { hasFeature } from "./entitlements-service";

/**
 * Lot O — politique de messagerie par offre (freemium v2).
 *
 *  - `semi_automatic` (Discover) : réponses automatiques UNIQUEMENT à
 *    partir de contenus que le commerçant a lui-même renseignés — FAQ,
 *    informations de l'entreprise (horaires, adresse, contact) et
 *    catalogue. Jamais d'IA générative ; tout autre message est escaladé
 *    à un humain avec un accusé de réception poli.
 *  - `automatic` (Starter/Pro) : même chaîne, puis l'IA en dernier
 *    recours (crédits IA), avec escalade si l'IA est indisponible.
 *  - `off` : aucune réponse automatique (les messages sont notifiés).
 */
export type MessagingMode = "automatic" | "semi_automatic" | "off";

export interface MessagingPolicy {
  mode: MessagingMode;
  /** L'IA générative peut-elle répondre en dernier recours ? */
  allowAI: boolean;
}

/** Dérivation pure (testable sans base) : `automatic` l'emporte sur `semi_automatic`. */
export function deriveMessagingPolicy(flags: { automatic: boolean; semiAutomatic: boolean }): MessagingPolicy {
  if (flags.automatic) return { mode: "automatic", allowAI: true };
  if (flags.semiAutomatic) return { mode: "semi_automatic", allowAI: false };
  return { mode: "off", allowAI: false };
}

export async function resolveMessagingPolicy(organizationId: string): Promise<MessagingPolicy> {
  const [automatic, semiAutomatic] = await Promise.all([
    hasFeature(organizationId, "automatic_messaging"),
    hasFeature(organizationId, "semi_automatic_messaging"),
  ]);
  return deriveMessagingPolicy({ automatic, semiAutomatic });
}
