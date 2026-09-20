import type {
  MessagingProvider,
  NormalizedContact,
  NormalizedConversation,
  OutboundMessage,
  SendMessageResult,
  WhatsAppGroupSummary,
} from "@/domain/ports/messaging-provider";
import { ZernioClient } from "./client";

/**
 * Implémentation Zernio du port MessagingProvider. Aucun service
 * applicatif ne doit importer ZernioClient directement — uniquement cet
 * adapter, obtenu via le ProviderRegistry.
 */
export class ZernioAdapter implements MessagingProvider {
  readonly providerName = "zernio";

  constructor(
    private readonly client: ZernioClient,
    private readonly profileId: string,
    private readonly accountId: string,
  ) {}

  async sendMessage(_organizationId: string, message: OutboundMessage): Promise<SendMessageResult> {
    // CONFIRMÉ (docs.zernio.com) : répondre nécessite le conversationId
    // Zernio, pas juste un numéro de téléphone — il n'existe pas d'envoi
    // "à froid" confirmé dans la doc consultée. En V1 (section 13 doc 2 :
    // on répond toujours à un message entrant), c'est le seul flux utilisé
    // — le webhook fournit toujours externalThreadId.
    if (!message.externalThreadId) {
      throw new Error(
        "ZernioAdapter.sendMessage nécessite externalThreadId (conversationId Zernio) — " +
          "aucun endpoint d'envoi à froid n'est confirmé dans la documentation officielle. " +
          "Voir docs.zernio.com avant d'ajouter un tel flux (section 14 doc 2).",
      );
    }

    // UN SEUL bouton CTA URL par message WhatsApp (contrainte réelle du
    // type `cta_url`, voir ZernioInteractiveCtaUrl) : avec 0 ou 2+ boutons
    // demandés, on ne peut pas représenter ça fidèlement en interactif —
    // repli sur le message texte tel quel (l'appelant garde alors ses
    // liens dans le texte).
    // ⚠️ Conversations 1:1 uniquement : ne jamais passer `buttons` pour un
    // groupe WhatsApp (messages interactifs non pris en charge par l'API
    // Groupes — voir ZernioInteractiveCtaUrl et OutboundMessage.buttons).
    const singleButton = message.buttons?.length === 1 ? message.buttons[0] : undefined;

    // Pas de combinaison interactive + pièce jointe : `header` (image/
    // vidéo/document) est la seule façon confirmée d'attacher un média à
    // un message `cta_url` (doc Meta), pas le champ `attachmentUrl` du
    // flux texte simple — jamais mélangé les deux sans confirmation.
    const response = await this.client.sendInboxMessage(message.externalThreadId, singleButton
      ? {
          accountId: this.accountId,
          interactive: {
            type: "cta_url",
            body: { text: message.content },
            action: { name: "cta_url", parameters: { display_text: singleButton.text, url: singleButton.url } },
          },
        }
      : {
          accountId: this.accountId,
          // `message` est optionnel dans l'API : pour une pièce jointe seule
          // (ou un vocal), on l'omet plutôt que d'envoyer une chaîne vide.
          message: message.content || undefined,
          attachmentUrl: message.attachmentUrl,
          attachmentType: message.attachmentType,
        });

    return {
      providerMessageId: response.id,
      status: response.status === "sent" ? "sent" : "queued",
    };
  }

  async getConversation(
    _organizationId: string,
    externalThreadId: string,
  ): Promise<NormalizedConversation | null> {
    // Le thread est déjà connu depuis le webhook (voir mapper.ts) — pas de
    // resynchronisation nécessaire pour le workflow central en V1.
    return { externalThreadId, channel: "whatsapp" };
  }

  async getContact(_organizationId: string, externalContactId: string): Promise<NormalizedContact | null> {
    // Pas d'endpoint de lookup contact confirmé dans la documentation
    // consultée — le nom/téléphone du contact viennent déjà du payload
    // webhook (conversation.contactName/contactPhone, voir mapper.ts).
    // On ne devine pas un endpoint (section 14 doc 2) : ce contact reste
    // donc non enrichi si appelé hors contexte webhook, pour l'instant.
    return { externalContactId };
  }

  async markAsRead(_organizationId: string, _externalMessageId: string): Promise<void> {
    // Pas d'endpoint "mark as read" confirmé dans la documentation
    // consultée pour l'inbox Zernio — non implémenté plutôt que deviné.
  }

  /** Utilisé par le ProviderRegistry pour vérifier la config à la connexion. */
  async listConnectedAccounts() {
    return this.client.listAccounts(this.profileId);
  }

  /**
   * Lot F — CONFIRMÉ (docs.zernio.com/platforms/whatsapp/groups) :
   * GET /whatsapp/wa-groups, paginé, sur le compte WhatsApp connecté.
   * Propage l'erreur telle quelle (ex: numéro en mode Coexistence) plutôt
   * que de la masquer — voir whatsapp-group-service.ts pour la gestion.
   */
  async listWhatsAppGroups(_organizationId: string): Promise<WhatsAppGroupSummary[]> {
    const groups = await this.client.listAllWhatsAppGroups(this.accountId);
    return groups.map((group) => ({
      externalId: group.id,
      name: group.subject,
      createdAt: group.createdAt ?? null,
    }));
  }
}
