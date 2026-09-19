import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getMessagingProvider, getSocialPublishingProvider } from "@/infrastructure/providers/registry";
import { getTelegramChannelStatus } from "./telegram-channel-service";
import { listConnectedGroups, createBroadcast } from "./whatsapp-group-service";
import { getProductsByIds, type CatalogProductSummary } from "./catalog-service";
import { env } from "@/lib/env";
import { ValidationError } from "@/lib/errors";

export type PublicationTargetType = "social" | "telegram" | "whatsapp_group";
export interface PublicationTarget { id: string; type: PublicationTargetType; platform: string; label: string; accountId: string; available: boolean; reason?: string; }
export interface PublicationInput {
  organizationId: string;
  actorUserId: string;
  productIds: string[];
  content?: string | null;
  mediaUrls?: string[];
  mediaType?: "image" | "video" | "audio" | "file";
  targets: PublicationTarget[];
  scheduledFor?: string | null;
}
export interface PublicationResult { published: number; scheduled: number; failed: Array<{ target: string; error: string }>; }

export function buildCatalogPublicationContent(products: CatalogProductSummary[], customContent?: string | null): string {
  const prefix = customContent?.trim();
  const lines: string[] = [];
  if (prefix) lines.push(prefix, "");
  for (const product of products) {
    lines.push(`🛍️ ${product.name}`);
    lines.push(`💰 ${product.unitPrice.toLocaleString("fr-FR")} FCFA`);
    if (product.categoryName) lines.push(`🏷️ ${product.categoryName}`);
    if (product.description) lines.push(product.description);
    if (product.slug) lines.push(`${env.NEXT_PUBLIC_APP_URL}/produits/${product.slug}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

export async function listOmnichannelPublicationTargets(organizationId: string): Promise<PublicationTarget[]> {
  const targets: PublicationTarget[] = [];
  try {
    const social = await getSocialPublishingProvider(organizationId);
    const accounts = await social.listAccounts();
    for (const account of accounts) targets.push({ id: `social:${account.accountId}`, type: "social", platform: account.platform, label: account.username ? `@${account.username}` : account.platform, accountId: account.accountId, available: true });
  } catch { /* aucun réseau social connecté */ }

  try {
    const telegram = await getTelegramChannelStatus(organizationId);
    if (telegram.connected) {
      const supabase = getSupabaseServiceClient();
      const { data: conversations } = await supabase.from("conversations").select("external_thread_id, channel, contacts(full_name)").eq("organization_id", organizationId).eq("channel", "telegram").not("external_thread_id", "is", null).order("last_message_at", { ascending: false }).limit(50);
      const seen = new Set<string>();
      for (const row of conversations ?? []) {
        const id = String(row.external_thread_id);
        if (seen.has(id)) continue;
        seen.add(id);
        const contact = (row as unknown as { contacts?: { full_name?: string | null } }).contacts?.full_name;
        targets.push({ id: `telegram:${id}`, type: "telegram", platform: "telegram", label: contact ? `Telegram · ${contact}` : `Telegram · ${id}`, accountId: id, available: true });
      }
      targets.push({ id: "telegram:manual", type: "telegram", platform: "telegram", label: "Telegram · autre canal/groupe", accountId: "", available: true });
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
  const content = buildCatalogPublicationContent(products, input.content);
  const mediaUrls = input.mediaUrls?.filter(Boolean) ?? products.map((p) => p.imageUrl).filter((url): url is string => Boolean(url));
  const scheduledDate = validateFutureDate(input.scheduledFor);
  const result: PublicationResult = { published: 0, scheduled: 0, failed: [] };

  const socialTargets = targets.filter((t) => t.type === "social");
  if (socialTargets.length) {
    let provider;
    try { provider = await getSocialPublishingProvider(input.organizationId); } catch (error) { provider = null; const message = error instanceof Error ? error.message : String(error); for (const target of socialTargets) result.failed.push({ target: target.label, error: message }); }
    if (provider) {
      // Une cible à la fois : un échec YouTube (par exemple sans vidéo) ne
      // doit jamais transformer une publication Instagram/Facebook réussie
      // en échec global. Le provider composite reste responsable de choisir
      // le connecteur concret derrière chaque plateforme.
      for (const target of socialTargets) {
        const supabase = getSupabaseServiceClient();
        const { data: postRow, error: postInsertError } = await supabase.from("social_posts").insert({ organization_id: input.organizationId, product_id: productIds.length === 1 ? productIds[0] : null, content, media_urls: mediaUrls, status: scheduledDate ? "scheduled" : "draft", scheduled_for: scheduledDate?.toISOString() ?? null, timezone: "Africa/Douala" }).select("id").single();
        if (postInsertError || !postRow) { result.failed.push({ target: target.label, error: postInsertError?.message ?? "Impossible d'enregistrer la publication." }); continue; }
        try {
          const request = { content, mediaUrls, targets: [{ platform: target.platform, accountId: target.accountId }], timezone: "Africa/Douala" };
          const providerResult = scheduledDate ? await provider.schedulePost({ ...request, scheduledFor: scheduledDate.toISOString() }) : await provider.publishPost({ ...request, publishNow: true });
          await supabase.from("social_posts").update({ provider_post_id: providerResult.providerPostId, status: scheduledDate ? "scheduled" : "published", error_message: null }).eq("id", postRow.id);
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

  for (const target of targets.filter((t) => t.type === "telegram")) {
    try {
      if (!target.accountId) throw new ValidationError("Renseignez le @canal ou l'identifiant du groupe Telegram.");
      const provider = await getMessagingProvider(input.organizationId, "telegram");
      const attachmentUrl = mediaUrls[0];
      if (scheduledDate) {
        const supabase = getSupabaseServiceClient();
        const { error } = await supabase.from("telegram_publications").insert({ organization_id: input.organizationId, created_by: input.actorUserId, content, target_chat_id: target.accountId, target_label: target.label, status: "scheduled", scheduled_for: scheduledDate.toISOString(), attachment_url: attachmentUrl ?? null, attachment_type: attachmentUrl ? (input.mediaType ?? "image") : null });
        if (error) throw new Error(error.message);
        result.scheduled++;
      } else {
        await provider.sendMessage(input.organizationId, { to: target.accountId, channel: "telegram", content, attachmentUrl, attachmentType: attachmentUrl ? (input.mediaType ?? "image") : undefined });
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
        const provider = await getMessagingProvider(input.organizationId, "zernio");
        const groups = await listConnectedGroups(input.organizationId);
        const byId = new Map(groups.map((g) => [g.id, g]));
        const imageUrl = products.length === 1 ? products[0]?.imageUrl : undefined;
        for (const groupId of groupIds) {
          const group = byId.get(groupId);
          if (!group?.isSendable) throw new ValidationError(`Le groupe ${group?.name ?? groupId} n'est pas encore activé.`);
          await provider.sendMessage(input.organizationId, { to: group.externalId, channel: "whatsapp", content, externalThreadId: group.externalId, attachmentUrl: imageUrl ?? undefined, attachmentType: imageUrl ? "image" : undefined });
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
