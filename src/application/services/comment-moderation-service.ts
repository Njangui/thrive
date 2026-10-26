import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { requireMembership } from "./auth-service";
import { findOrCreateOpenLead } from "./lead-service";
import { DEFAULT_COMMENT_SETTINGS, FAIL_SAFE_COMMENT_SETTINGS, type CommentAssistantSettings, type CommentProduct } from "./comment-assistant";
import { normalizeMessage } from "./message-intents";
import { ValidationError } from "@/lib/errors";

/**
 * C3 — accès base de l'assistant des commentaires (livrable G, migration 0144).
 *
 * Isolation (principe 5) : client service-role, donc CHAQUE requête filtre sur
 * `organization_id`. Les fonctions « runtime » ne LÈVENT JAMAIS : un commentaire
 * doit toujours pouvoir être traité, quitte à retomber sur le comportement d'avant
 * (réglages de repli = rien de nouveau). Seul `saveCommentSettings` exige un
 * propriétaire / administrateur.
 */

type SettingsRow = Record<string, unknown>;

function settingsFromRow(row: SettingsRow): CommentAssistantSettings {
  const bool = (key: string, fallback: boolean) => (typeof row[key] === "boolean" ? (row[key] as boolean) : fallback);
  return {
    usePostProduct: bool("use_post_product", DEFAULT_COMMENT_SETTINGS.usePostProduct),
    inviteToDm: bool("invite_to_dm", DEFAULT_COMMENT_SETTINGS.inviteToDm),
    createLeads: bool("create_leads", DEFAULT_COMMENT_SETTINGS.createLeads),
    hideSpam: bool("hide_spam", DEFAULT_COMMENT_SETTINGS.hideSpam),
    complaintPublicAck: bool("complaint_public_ack", DEFAULT_COMMENT_SETTINGS.complaintPublicAck),
    replyToPraise: bool("reply_to_praise", DEFAULT_COMMENT_SETTINGS.replyToPraise),
  };
}

/** Réglages du commerçant ; défauts s'il n'a rien réglé ; réglages de repli (aucun comportement nouveau) si la lecture échoue. Ne lève jamais. */
export async function loadCommentSettings(organizationId: string): Promise<CommentAssistantSettings> {
  try {
    const { data, error } = await getSupabaseServiceClient().from("comment_assistant_settings").select("*").eq("organization_id", organizationId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? settingsFromRow(data as SettingsRow) : DEFAULT_COMMENT_SETTINGS;
  } catch (error) {
    console.warn(`[comments] réglages illisibles (org ${organizationId}), comportement d'avant:`, error instanceof Error ? error.message : error);
    return FAIL_SAFE_COMMENT_SETTINGS;
  }
}

export async function getCommentSettings(organizationId: string): Promise<CommentAssistantSettings> {
  await requireMembership(organizationId, ["owner", "admin"]);
  return loadCommentSettings(organizationId);
}

const SETTING_COLUMNS: Record<keyof CommentAssistantSettings, string> = {
  usePostProduct: "use_post_product",
  inviteToDm: "invite_to_dm",
  createLeads: "create_leads",
  hideSpam: "hide_spam",
  complaintPublicAck: "complaint_public_ack",
  replyToPraise: "reply_to_praise",
};

/** Modifie les réglages indiqués (les autres sont conservés). Refuse tout ce qui n'est pas un booléen connu. */
export async function saveCommentSettings(organizationId: string, patch: Partial<CommentAssistantSettings>): Promise<CommentAssistantSettings> {
  await requireMembership(organizationId, ["owner", "admin"]);
  const row: Record<string, unknown> = { organization_id: organizationId };
  for (const [key, value] of Object.entries(patch)) {
    const column = SETTING_COLUMNS[key as keyof CommentAssistantSettings];
    if (!column) throw new ValidationError(`Réglage inconnu : ${key}`);
    if (typeof value !== "boolean") throw new ValidationError(`Réglage « ${key} » : vrai ou faux attendu`);
    row[column] = value;
  }
  const { error } = await getSupabaseServiceClient().from("comment_assistant_settings").upsert(row, { onConflict: "organization_id" });
  if (error) throw new Error(`Erreur enregistrement réglages commentaires: ${error.message}`);
  return loadCommentSettings(organizationId);
}

/**
 * Produit mis en avant par la publication (`social_posts.product_id`), s'il est ACTIF.
 * Le prix vient de la base, jamais du texte du commentaire ni d'un modèle. Ne lève jamais.
 */
export async function findPostProduct(organizationId: string, providerPostId: string): Promise<CommentProduct | null> {
  try {
    const supabase = getSupabaseServiceClient();
    const { data: posts, error: postError } = await supabase
      .from("social_posts")
      .select("id, product_id")
      .eq("organization_id", organizationId)
      .eq("provider_post_id", providerPostId)
      .not("product_id", "is", null)
      .limit(1);
    if (postError) throw new Error(postError.message);
    const productId = posts?.[0]?.product_id as string | undefined;
    if (!productId) return null;

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, name, slug, unit_price, compare_at_price, promotion_ends_at, status")
      .eq("organization_id", organizationId)
      .eq("id", productId)
      .eq("status", "active")
      .maybeSingle();
    if (productError) throw new Error(productError.message);
    if (!product) return null;

    const unitPrice = Number(product.unit_price);
    const compareAt = product.compare_at_price === null || product.compare_at_price === undefined ? null : Number(product.compare_at_price);
    const endsAt = product.promotion_ends_at ? new Date(String(product.promotion_ends_at)) : null;
    return {
      id: String(product.id),
      name: String(product.name),
      slug: (product.slug as string | null) ?? null,
      unitPrice,
      compareAtPrice: compareAt,
      isPromo: compareAt !== null && compareAt > unitPrice && (endsAt === null || endsAt > new Date()),
    };
  } catch (error) {
    console.warn(`[comments] produit de la publication illisible (org ${organizationId}):`, error instanceof Error ? error.message : error);
    return null;
  }
}

export interface CommentLeadInput {
  platform: string;
  accountId: string;
  authorExternalId?: string | null;
  authorName?: string | null;
}

/** Clé stable d'un commentateur : identifiant de plateforme de préférence, nom public sinon ; `null` si on ne sait pas qui c'est. */
export function socialContactKey(input: CommentLeadInput): string | null {
  const who = input.authorExternalId?.trim() || (input.authorName ? `name:${normalizeMessage(input.authorName).replace(/ /g, "-")}` : "");
  return who && who !== "name:" ? `${input.platform}:${input.accountId}:${who}` : null;
}

/**
 * Prospect créé depuis une intention d'achat explicite : contact (nom public + clé de plateforme,
 * JAMAIS le texte du commentaire ni de numéro) puis lead ouvert (réutilisé s'il existe déjà).
 * Retourne l'identifiant du lead, ou `null` (auteur inconnu, erreur). Ne lève jamais.
 */
export async function createLeadFromComment(organizationId: string, input: CommentLeadInput): Promise<string | null> {
  try {
    const key = socialContactKey(input);
    if (!key) return null;
    const supabase = getSupabaseServiceClient();

    const findContact = async () => {
      const { data, error } = await supabase.from("contacts").select("id").eq("organization_id", organizationId).eq("metadata->>social_key", key).maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.id as string | undefined) ?? null;
    };

    let contactId = await findContact();
    if (!contactId) {
      const { data, error } = await supabase
        .from("contacts")
        .insert({ organization_id: organizationId, full_name: input.authorName?.trim() || null, source_channel: `${input.platform}_comment`, metadata: { social_key: key, platform: input.platform, account_id: input.accountId } })
        .select("id")
        .single();
      if (error || !data) {
        contactId = await findContact(); // course : un autre commentaire l'a créé entre-temps (index unique)
        if (!contactId) throw new Error(error?.message ?? "contact non créé");
      } else {
        contactId = String(data.id);
      }
    }
    const lead = await findOrCreateOpenLead(organizationId, contactId, `comment_${input.platform}`);
    return String(lead.id);
  } catch (error) {
    console.warn(`[comments] prospect non créé (org ${organizationId}):`, error instanceof Error ? error.message : error);
    return null;
  }
}
