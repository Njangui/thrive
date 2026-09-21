import { assertPublicationMediaAvailable, telegramVideoLimitErrorForUrl } from "./catalog-video-service";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getMessagingProvider, getSocialPublishingProvider, getWhatsAppGroupsProvider } from "@/infrastructure/providers/registry";
import { listTelegramDestinations } from "./telegram-destination-service";
import { listConnectedGroups, createBroadcast } from "./whatsapp-group-service";
import { getProductsByIds, buildProductButtons, type CatalogProductSummary } from "./catalog-service";
import { getTenantPublicOrigin } from "@/infrastructure/tenant/resolve-request-tenant";
import { ValidationError } from "@/lib/errors";
import { isFeatureEnabled, hasFeature } from "./entitlements-service";
import { normalizeFirstComment, queueTikTokFirstComment } from "./first-comment-service";

export type PublicationTargetType = "social" | "telegram" | "whatsapp_group";

const SOCIAL_ENTITLEMENT_BY_PLATFORM: Record<string, string> = {
  facebook: "facebook_pages",
  instagram: "instagram_accounts",
  linkedin: "linkedin_pages",
  tiktok: "tiktok_accounts",
  youtube: "youtube_accounts",
  twitter: "twitter_accounts",
};
export interface PublicationTarget { /** Lot O : `telegram_bots.id` du bot émetteur (cibles Telegram). */ providerAccountId?: string; id: string; type: PublicationTargetType; platform: string; label: string; accountId: string; available: boolean; reason?: string; }
export interface PublicationInput {
  organizationId: string;
  actorUserId: string;
  productIds: string[];
  content?: string | null;
  mediaUrls?: string[];
  mediaType?: "image" | "video" | "audio" | "file";
  targets: PublicationTarget[];
  scheduledFor?: string | null;
  /** Lot O : premier commentaire automatique (Facebook, Instagram, LinkedIn via Zernio ; TikTok via job différé). */
  firstComment?: string | null;
}
export interface PublicationResult { published: number; scheduled: number; failed: Array<{ target: string; error: string }>; }

/**
 * `origin` = domaine public RÉEL du tenant (getTenantPublicOrigin, jamais
 * env.NEXT_PUBLIC_APP_URL — corrigé le 19/09/2026, un lien produit
 * partagé sur le canal Telegram d'un tenant pointait vers le domaine
 * générique de la plateforme au lieu du sien, 404 pour le client final).
 *
 * `includeLinks` (def. true) : Telegram affiche un bouton "Voir
 * plus"/"Voir : {produit}" sous le message (voir buildProductButtons +
 * OutboundMessage.buttons) — dans ce cas l'appelant passe `false` pour ne
 * pas aussi répéter le lien en clair dans le texte. Les réseaux sociaux et
 * les groupes WhatsApp n'ont pas de bouton équivalent (groupes : messages
 * interactifs non pris en charge, voir OutboundMessage.buttons) : le lien
 * en texte y reste le seul moyen d'atteindre la fiche produit.
 */
export function buildCatalogPublicationContent(
  products: CatalogProductSummary[],
  origin: string,
  customContent?: string | null,
  includeLinks = true,
): string {
  const prefix = customContent?.trim();
  const lines: string[] = [];
  if (prefix) lines.push(prefix, "");
  for (const product of products) {
    lines.push(`🛍️ ${product.name}`);
    lines.push(`💰 ${product.unitPrice.toLocaleString("fr-FR")} FCFA`);
    if (product.categoryName) lines.push(`🏷️ ${product.categoryName}`);
    if (product.description) lines.push(product.description);
    if (includeLinks && product.slug) lines.push(`${origin}/produits/${product.slug}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

export async function listOmnichannelPublicationTargets(organizationId: string): Promise<PublicationTarget[]> {
  const targets: PublicationTarget[] = [];
  try {
    const social = await getSocialPublishingProvider(organizationId);
    const accounts = await social.listAccounts();
    for (const account of accounts) {
      if (account.platform === "whatsapp") continue; // WhatsApp de messagerie se gère dans la boîte, pas comme cible de publication sociale.
      const entitlementKey = SOCIAL_ENTITLEMENT_BY_PLATFORM[account.platform];
      const entitlement = entitlementKey ? await isFeatureEnabled(organizationId, entitlementKey).then((r) => ({ allowed: r.enabled })) : { allowed: false };
      targets.push({
        id: `social:${account.accountId}`,
        type: "social",
        platform: account.platform,
        label: account.username ? `@${account.username}` : account.platform,
        accountId: account.accountId,
        available: entitlement.allowed,
        reason: entitlement.allowed ? undefined : `Canal non inclus dans votre offre (${account.platform}).`,
      });
    }
  } catch { /* aucun réseau social connecté */ }

  try {
    // Lot O : canaux et groupes Telegram ENREGISTRÉS (quotas cumulés), par bot.
    const destinations = await listTelegramDestinations(organizationId, { activeOnly: true });
    for (const destination of destinations) {
      const kindLabel = destination.kind === "channel" ? "canal" : "groupe";
      targets.push({
        id: `telegram:${destination.id}`,
        type: "telegram",
        platform: "telegram",
        label: `Telegram · ${destination.title ?? destination.username ?? destination.chatId} (${kindLabel})`,
        accountId: destination.chatId,
        providerAccountId: destination.botId,
        available: true,
      });
    }
  } catch { /* Telegram absent */ }

  try {
    const groups = await listConnectedGroups(organizationId);
    for (const group of groups) targets.push({ id: `whatsapp_group:${group.id}`, type: "whatsapp_group", platform: "whatsapp", label: `WhatsApp · ${group.name}`, accountId: group.id, available: group.isSendable, reason: group.isSendable ? undefined : "Le groupe doit d'abord recevoir un message pour être activé." });
  } catch { /* WhatsApp groups absent */ }

  return targets;
}

function validateFutureDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now() + 30_000) throw new ValidationError("Choisissez une date et une heure futures.");
  return date;
}

export async function publishOmnichannel(input: PublicationInput): Promise<PublicationResult> {
  const targetMap = new Map(input.targets.map((target) => [target.id, target]));
  const targets = [...targetMap.values()].filter((t) => t.available);
  if (!targets.length) throw new ValidationError("Sélectionnez au moins un canal disponible.");
  const productIds = [...new Set(input.productIds)];
  if (!productIds.length) throw new ValidationError("Sélectionnez au moins un produit du catalogue.");
  const products = await getProductsByIds(input.organizationId, productIds);
  if (products.length !== productIds.length) throw new ValidationError("Un ou plusieurs produits sont introuvables.");
  const tenantOrigin = await getTenantPublicOrigin(input.organizationId);
  const content = buildCatalogPublicationContent(products, tenantOrigin, input.content);
  // Telegram affiche un bouton "Voir plus" par produit (reply_markup) —
  // le lien en clair n'y est donc pas répété dans le texte (includeLinks=false),
  // contrairement au texte envoyé aux réseaux sociaux/groupes WhatsApp
  // ci-dessous, qui n'ont pas d'équivalent (voir buildProductButtons).
  const telegramContent = buildCatalogPublicationContent(products, tenantOrigin, input.content, false);
  const telegramButtons = buildProductButtons(products, tenantOrigin);
  const mediaUrls = input.mediaUrls?.filter(Boolean) ?? products.map((p) => p.imageUrl).filter((url): url is string => Boolean(url));
  const scheduledDate = validateFutureDate(input.scheduledFor);
  const firstComment = normalizeFirstComment(input.firstComment);
  // Garde-fou « 7 jours Zernio » (voir catalog-video-service.ts). Deux niveaux :
  //  1. ici, pour TOUTES les cibles : le fichier doit exister MAINTENANT
  //     (une vidéo déjà expirée ne peut plus être publiée nulle part) ;
  //  2. par cible, plus bas, pour la DATE de programmation — uniquement pour
  //     les cibles qui relisent le fichier au jour J (réseaux via Zernio,
  //     Telegram). YouTube est exclu : l'adaptateur le téléverse chez YouTube
  //     dès la programmation (privé + `publishAt`), c'est YouTube qui publie
  //     à l'heure dite — la limite de 7 jours ne s'y applique donc pas.
  await assertPublicationMediaAvailable(input.organizationId, mediaUrls, null);
  const result: PublicationResult = { published: 0, scheduled: 0, failed: [] };

  const socialTargets = targets.filter((t) => t.type === "social");
  if (socialTargets.length) {
    const uniquePlatformAccounts = new Map<string, Set<string>>();
    for (const target of socialTargets) {
      const set = uniquePlatformAccounts.get(target.platform) ?? new Set<string>();
      set.add(target.accountId);
      uniquePlatformAccounts.set(target.platform, set);
    }
    const blockedSocialTargets = new Set<string>();
    for (const platform of uniquePlatformAccounts.keys()) {
      const entitlementKey = SOCIAL_ENTITLEMENT_BY_PLATFORM[platform];
      if (!entitlementKey) {
        for (const target of socialTargets.filter((item) => item.platform === platform)) blockedSocialTargets.add(target.id);
        continue;
      }
      const entitlement = await isFeatureEnabled(input.organizationId, entitlementKey).then((r) => ({ allowed: r.enabled }));
      if (!entitlement.allowed) {
        for (const target of socialTargets.filter((item) => item.platform === platform)) {
          blockedSocialTargets.add(target.id);
          result.failed.push({ target: target.label, error: `La limite ${platform} de votre offre est atteinte.` });
        }
      }
    }
    const publishableSocialTargets = socialTargets.filter((target) => !blockedSocialTargets.has(target.id));
    let provider;
    try { provider = await getSocialPublishingProvider(input.organizationId); } catch (error) { provider = null; const message = error instanceof Error ? error.message : String(error); for (const target of socialTargets) result.failed.push({ target: target.label, error: message }); }
    if (provider) {
      // Une cible à la fois : un échec YouTube (par exemple sans vidéo) ne
      // doit jamais transformer une publication Instagram/Facebook réussie
      // en échec global. Le provider composite reste responsable de choisir
      // le connecteur concret derrière chaque plateforme.
      for (const target of publishableSocialTargets) {
        if (scheduledDate && target.platform !== "youtube") {
          try {
            await assertPublicationMediaAvailable(input.organizationId, mediaUrls, scheduledDate);
          } catch (error) {
            result.failed.push({ target: target.label, error: error instanceof Error ? error.message : String(error) });
            continue;
          }
        }
        const supabase = getSupabaseServiceClient();
        const { data: postRow, error: postInsertError } = await supabase.from("social_posts").insert({ organization_id: input.organizationId, product_id: productIds.length === 1 ? productIds[0] : null, content, media_urls: mediaUrls, status: scheduledDate ? "scheduled" : "draft", scheduled_for: scheduledDate?.toISOString() ?? null, timezone: "Africa/Douala" }).select("id").single();
        if (postInsertError || !postRow) { result.failed.push({ target: target.label, error: postInsertError?.message ?? "Impossible d'enregistrer la publication." }); continue; }
        try {
          const request = { content, mediaUrls, targets: [{ platform: target.platform, accountId: target.accountId }], timezone: "Africa/Douala", ...(firstComment ? { firstComment } : {}) };
          const providerResult = scheduledDate ? await provider.schedulePost({ ...request, scheduledFor: scheduledDate.toISOString() }) : await provider.publishPost({ ...request, publishNow: true });
          await supabase.from("social_posts").update({ provider_post_id: providerResult.providerPostId, status: scheduledDate ? "scheduled" : "published", error_message: null, first_comment: firstComment ?? null }).eq("id", postRow.id);
          // TikTok : Zernio ne publie pas de `firstComment` — job différé (URL de la vidéo connue plus tard).
          if (firstComment && target.platform === "tiktok") await queueTikTokFirstComment({ organizationId: input.organizationId, socialPostId: postRow.id as string, accountId: target.accountId, content: firstComment });
          await supabase.from("social_post_targets").insert({ organization_id: input.organizationId, post_id: postRow.id, platform: target.platform, provider_account_id: target.accountId, status: scheduledDate ? "pending" : "published" });
          if (scheduledDate) result.scheduled++; else result.published++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await supabase.from("social_posts").update({ status: "failed", error_message: message }).eq("id", postRow.id);
          await supabase.from("social_post_targets").insert({ organization_id: input.organizationId, post_id: postRow.id, platform: target.platform, provider_account_id: target.accountId, status: "failed", error_message: message });
          result.failed.push({ target: target.label, error: message });
        }
      }
    }
  }

  const telegramTargets = targets.filter((t) => t.type === "telegram");
  if (telegramTargets.length > 0) {
    const telegramQuota = { allowed: (await hasFeature(input.organizationId, "telegram_channels")) || (await hasFeature(input.organizationId, "telegram_groups")) };
    if (!telegramQuota.allowed) {
      for (const target of telegramTargets) {
        result.failed.push({ target: target.label, error: "Les groupes/canaux Telegram ne sont pas inclus dans votre offre." });
      }
    }
  }

  for (const target of telegramTargets) {
    if (result.failed.some((failure) => failure.target === target.label && failure.error.includes("Telegram ne sont pas inclus") || failure.error.includes("groupes/canaux Telegram"))) continue;
    try {
      if (!target.accountId) throw new ValidationError("Renseignez le @canal ou l'identifiant du groupe Telegram.");
      // Telegram : la vidéo est relue chez Zernio AU JOUR de la publication.
      if (scheduledDate) await assertPublicationMediaAvailable(input.organizationId, mediaUrls, scheduledDate);
      const provider = await getMessagingProvider(input.organizationId, "telegram", target.providerAccountId);
      const attachmentUrl = mediaUrls[0];
      // Telegram limite à 20 Mo un fichier envoyé par URL : mieux vaut un
      // échec explicite pour CETTE cible que des erreurs opaques de l'API.
      if (attachmentUrl && (input.mediaType ?? "image") === "video") {
        const limitMessage = await telegramVideoLimitErrorForUrl(input.organizationId, attachmentUrl);
        if (limitMessage) throw new ValidationError(limitMessage);
      }
      if (scheduledDate) {
        const supabase = getSupabaseServiceClient();
        const { error } = await supabase.from("telegram_publications").insert({ organization_id: input.organizationId, created_by: input.actorUserId, bot_id: target.providerAccountId ?? null, destination_id: target.id.startsWith("telegram:") ? target.id.slice("telegram:".length) : null, content: telegramContent, buttons: telegramButtons.length ? telegramButtons : null, target_chat_id: target.accountId, target_label: target.label, status: "scheduled", scheduled_for: scheduledDate.toISOString(), attachment_url: attachmentUrl ?? null, attachment_type: attachmentUrl ? (input.mediaType ?? "image") : null });
        if (error) throw new Error(error.message);
        result.scheduled++;
      } else {
        await provider.sendMessage(input.organizationId, { to: target.accountId, channel: "telegram", content: telegramContent, attachmentUrl, attachmentType: attachmentUrl ? (input.mediaType ?? "image") : undefined, uploadBinary: Boolean(attachmentUrl && (input.mediaType ?? "image") !== "image"), buttons: telegramButtons.length ? telegramButtons : undefined });
        result.published++;
      }
    } catch (error) { result.failed.push({ target: target.label, error: error instanceof Error ? error.message : String(error) }); }
  }

  const whatsappTargets = targets.filter((t) => t.type === "whatsapp_group");
  if (whatsappTargets.length) {
    try {
      const groupIds = whatsappTargets.map((t) => t.accountId);
      if (scheduledDate) {
        await createBroadcast(input.organizationId, productIds, groupIds, scheduledDate.toISOString(), input.actorUserId);
        result.scheduled += groupIds.length;
      } else {
        // Groupes WhatsApp : numéro DÉDIÉ (provider_type='whatsapp_groups', lot WhatsApp Coexistence),
        // jamais le profil de messagerie 1:1 — un numéro en Coexistence ne supporte pas l'API Groupes.
        // Même fournisseur que whatsapp-group-service.ts (listage, diffusion programmée).
        const provider = await getWhatsAppGroupsProvider(input.organizationId);
        const groups = await listConnectedGroups(input.organizationId);
        const byId = new Map(groups.map((g) => [g.id, g]));
        const imageUrl = products.length === 1 ? products[0]?.imageUrl : undefined;
        for (const groupId of groupIds) {
          const group = byId.get(groupId);
          if (!group?.isSendable || !group.zernioConversationId) throw new ValidationError(`Le groupe ${group?.name ?? groupId} n'est pas encore activé.`);
          // `externalThreadId` = la conversation Zernio du groupe (`zernioConversationId`),
          // PAS l'identifiant du groupe WhatsApp (`externalId`) — corrigé fusion #17 : la
          // diffusion programmée (whatsapp-group-service.ts) utilisait déjà la bonne valeur,
          // seul cet envoi immédiat confondait les deux et échouait à chaque envoi.
          // Liens produit gardés EN TEXTE (`content`), aucun bouton : les messages
          // interactifs ne sont pas pris en charge dans les groupes (voir OutboundMessage.buttons).
          await provider.sendMessage(input.organizationId, { to: group.externalId, channel: "whatsapp", content, externalThreadId: group.zernioConversationId, attachmentUrl: imageUrl ?? undefined, attachmentType: imageUrl ? "image" : undefined });
          result.published++;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const target of whatsappTargets) result.failed.push({ target: target.label, error: message });
    }
  }

  if (!result.published && !result.scheduled) throw new ValidationError(result.failed[0]?.error ?? "Aucune publication n'a pu être créée.");
  return result;
}
