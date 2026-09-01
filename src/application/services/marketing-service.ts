import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getSocialPublishingProvider } from "@/infrastructure/providers/registry";
import type { SocialPostTarget } from "@/domain/ports/social-publishing-provider";
import { env } from "@/lib/env";
import { canUseFeature } from "./entitlements-service";
import { trackEvent } from "./analytics-service";
import { NotFoundError, QuotaExceededError, ValidationError } from "@/lib/errors";

export interface CreateCampaignFromProductsInput {
  organizationId: string;
  name: string;
  productIds: string[];
  targets: SocialPostTarget[]; // ex: [{platform:'facebook',accountId:'...'}, {platform:'instagram',accountId:'...'}]
  /** Premier créneau, format 'YYYY-MM-DDTHH:mm:ss' (sans offset — voir timezone) */
  firstSlotAt: string;
  intervalHours: number;
  timezone?: string;
  /** Reprendre une campagne existante (idempotence — section 29 : "éviter les doublons involontaires") */
  existingCampaignId?: string;
}

export interface CreateCampaignFromProductsResult {
  campaignId: string;
  scheduled: string[]; // product ids publiés avec succès
  skipped: string[]; // déjà planifiés lors d'un appel précédent
  failed: { productId: string; error: string }[]; // erreur Zernio isolée (section 43)
}

/** Décale une chaîne 'YYYY-MM-DDTHH:mm:ss' de N heures, sans dépendance externe. */
export function addHoursToNaiveIso(naiveIso: string, hours: number): string {
  const asUtc = new Date(`${naiveIso}Z`);
  asUtc.setUTCHours(asUtc.getUTCHours() + hours);
  return asUtc.toISOString().slice(0, 19);
}

/**
 * Sections 29/30 : sélection multiple de produits -> une publication par
 * produit -> programmation étalée -> transmission à Zernio. Le contenu est
 * construit automatiquement depuis le catalogue (source de vérité unique,
 * section 2) : l'admin n'a rien à ressaisir.
 */
export async function createCampaignFromProducts(
  input: CreateCampaignFromProductsInput,
): Promise<CreateCampaignFromProductsResult> {
  // Lot B (section 62) — exemple d'intégration du pattern d'enforcement
  // dans un flux existant. Vérifié CÔTÉ SERVEUR, jamais seulement masqué
  // au frontend. On compare le nombre de comptes distincts ciblés par
  // CETTE campagne à `social_accounts` (limite "par action" plutôt que
  // cumulative — voir entitlements-service.ts : il n'existe aujourd'hui
  // aucune table "comptes sociaux connectés" dans ce projet pour compter
  // un cumul réel, donc on ne devine pas ce modèle de données ; on borne
  // ce qu'une seule campagne peut cibler à la fois, ce qui reste une
  // vérification server-side réelle et utile). Absence de ligne
  // `plan_entitlements` = illimité (canUseFeature), donc un tenant de
  // démo créé avant ce lot n'est jamais cassé par cette vérification.
  const distinctAccountCount = new Set(input.targets.map((t) => t.accountId)).size;
  const entitlement = await canUseFeature(input.organizationId, "social_accounts", distinctAccountCount);
  if (!entitlement.allowed) {
    throw new QuotaExceededError(
      "Vous avez atteint la limite de votre offre. Passez à Business pour publier sur davantage de comptes à la fois.",
    );
  }

  const supabase = getSupabaseServiceClient();

  let campaignId: string;
  if (input.existingCampaignId) {
    campaignId = input.existingCampaignId;
  } else {
    const { data: campaign, error: campaignError } = await supabase
      .from("social_campaigns")
      .insert({ organization_id: input.organizationId, name: input.name, status: "active" })
      .select("id")
      .single();
    if (campaignError || !campaign) {
      throw new Error(`Impossible de créer la campagne: ${campaignError?.message}`);
    }
    campaignId = campaign.id;
  }

  // Idempotence : les produits déjà liés à un post de cette campagne sont
  // ignorés plutôt que republiés (retry-safe, section 29).
  const { data: existingPosts } = await supabase
    .from("social_posts")
    .select("product_id")
    .eq("campaign_id", campaignId);
  const alreadyScheduled = new Set((existingPosts ?? []).map((p) => p.product_id));

  const productsToSchedule = input.productIds.filter((id) => !alreadyScheduled.has(id));
  const skipped = input.productIds.filter((id) => alreadyScheduled.has(id));

  if (productsToSchedule.length === 0) {
    return { campaignId, scheduled: [], skipped, failed: [] };
  }

  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, name, description, unit_price, slug, status, product_images(url, position)")
    .eq("organization_id", input.organizationId)
    .in("id", productsToSchedule);

  if (productsError) {
    throw new Error(`Erreur lecture produits pour campagne: ${productsError.message}`);
  }

  const socialProvider = await getSocialPublishingProvider(input.organizationId);

  const scheduled: string[] = [];
  const failed: { productId: string; error: string }[] = [];

  for (const [i, product] of (products ?? []).entries()) {
    // Section 52 : un produit OUT_OF_STOCK/inactive ne doit pas être
    // sélectionné pour une nouvelle publication.
    if (product.status !== "active") {
      failed.push({ productId: product.id, error: `Produit non actif (statut: ${product.status})` });
      continue;
    }

    const images = ((product as unknown as { product_images?: { url: string; position: number }[] })
      .product_images ?? [])
      .sort((a, b) => a.position - b.position)
      .map((img) => img.url);

    const publicUrl = product.slug ? `${env.NEXT_PUBLIC_APP_URL}/produits/${product.slug}` : null;
    const content = [
      product.name,
      `${Number(product.unit_price).toLocaleString("fr-FR")} FCFA`,
      product.description,
      publicUrl,
    ]
      .filter(Boolean)
      .join("\n\n");

    const scheduledFor = addHoursToNaiveIso(input.firstSlotAt, i * input.intervalHours);

    const { data: postRow, error: postInsertError } = await supabase
      .from("social_posts")
      .insert({
        organization_id: input.organizationId,
        campaign_id: campaignId,
        product_id: product.id,
        content,
        media_urls: images,
        status: "draft",
        scheduled_for: scheduledFor,
        timezone: input.timezone ?? "Africa/Douala",
      })
      .select("id")
      .single();

    if (postInsertError || !postRow) {
      failed.push({ productId: product.id, error: postInsertError?.message ?? "insert failed" });
      continue;
    }

    try {
      const result = await socialProvider.schedulePost({
        content,
        mediaUrls: images,
        targets: input.targets,
        scheduledFor,
        timezone: input.timezone ?? "Africa/Douala",
      });

      await supabase
        .from("social_posts")
        .update({ status: "scheduled", provider_post_id: result.providerPostId })
        .eq("id", postRow.id);

      await supabase.from("social_post_targets").insert(
        input.targets.map((t) => ({
          organization_id: input.organizationId,
          post_id: postRow.id,
          platform: t.platform,
          provider_account_id: t.accountId,
          status: "pending",
        })),
      );

      scheduled.push(product.id);

      // Lot H, Partie 2 (master prompt §55) — ⚠️ ce projet n'a PAS encore de
      // sync webhook `post.*` qui confirmerait qu'une publication programmée
      // a réellement été diffusée (docs/ROADMAP.md, point 2 : ce sync
      // n'existe pas). `publication_published` est donc déclenché ici, au
      // moment où la PROGRAMMATION auprès de Zernio réussit (le "job de
      // publication" du point de vue de cette app), pas au moment de la
      // diffusion réelle en aval. Décision documentée plutôt que de laisser
      // planer l'ambiguïté — à corriger (déplacer vers le futur handler
      // webhook) quand ce sync sera construit.
      await trackEvent(input.organizationId, "publication_published", "social_post", postRow.id, {
        productId: product.id,
      });
    } catch (providerError) {
      // Section 43 : une erreur Zernio isolée ne doit jamais casser le
      // reste de la campagne — on marque CE post en échec et on continue.
      const message = providerError instanceof Error ? providerError.message : String(providerError);
      await supabase.from("social_posts").update({ status: "failed", error_message: message }).eq("id", postRow.id);
      failed.push({ productId: product.id, error: message });
    }
  }

  return { campaignId, scheduled, skipped, failed };
}

/**
 * Section 52 doc 2 : si un produit devient OUT_OF_STOCK, les publications
 * encore programmées le concernant doivent pouvoir passer à PAUSED plutôt
 * que de partir automatiquement. Appelé depuis catalog-service au moment
 * du flip de statut — jamais l'inverse (le catalogue reste la source de
 * vérité, section 2).
 */
export async function pauseScheduledPostsForProduct(organizationId: string, productId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { data: posts, error } = await supabase
    .from("social_posts")
    .select("id, provider_post_id")
    .eq("organization_id", organizationId)
    .eq("product_id", productId)
    .eq("status", "scheduled");

  if (error) {
    console.error(`pauseScheduledPostsForProduct(${productId}) lecture échouée:`, error.message);
    return;
  }
  if (!posts || posts.length === 0) return;

  let socialProvider;
  try {
    socialProvider = await getSocialPublishingProvider(organizationId);
  } catch (providerError) {
    // Pas de provider connecté = rien à annuler côté Zernio, mais on
    // marque quand même côté interne pour rester cohérent avec le stock.
    console.warn(`pauseScheduledPostsForProduct: aucun SocialPublishingProvider pour org ${organizationId}`);
  }

  for (const post of posts) {
    if (socialProvider && post.provider_post_id) {
      try {
        await socialProvider.cancelPost(post.provider_post_id);
      } catch (cancelError) {
        // Section 43 : erreur provider isolée, ne bloque pas le reste.
        console.warn(`Annulation Zernio échouée pour post ${post.id}:`, cancelError);
      }
    }
    await supabase.from("social_posts").update({ status: "paused" }).eq("id", post.id);
  }
}

// ============================================================
// Lecture pour le dashboard — jusqu'ici `createCampaignFromProducts` et
// `pauseScheduledPostsForProduct` n'étaient appelées que par l'API interne
// (catalog-service) et aucun test manuel ; aucun écran `/dashboard/marketing`
// n'existait pour les déclencher ou en voir le résultat (voir
// docs/ROADMAP.md, point 3, pour `getAnalytics`). Ce qui suit est le
// premier point d'entrée dashboard de ce module.
// ============================================================

export interface CampaignPostCounts {
  draft: number;
  scheduled: number;
  published: number;
  failed: number;
  partial: number;
  cancelled: number;
  paused: number;
}

function emptyCounts(): CampaignPostCounts {
  return { draft: 0, scheduled: 0, published: 0, failed: 0, partial: 0, cancelled: 0, paused: 0 };
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  totalPosts: number;
  counts: CampaignPostCounts;
}

export async function listCampaigns(organizationId: string): Promise<CampaignSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data: campaigns, error } = await supabase
    .from("social_campaigns")
    .select("id, name, status, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(`Erreur lecture campagnes: ${error.message}`);
  if (!campaigns || campaigns.length === 0) return [];

  const campaignIds = campaigns.map((c) => c.id);
  const { data: posts, error: postsError } = await supabase
    .from("social_posts")
    .select("campaign_id, status")
    .in("campaign_id", campaignIds);

  if (postsError) throw new Error(`Erreur lecture publications: ${postsError.message}`);

  return campaigns.map((c) => {
    const ownPosts = (posts ?? []).filter((p) => p.campaign_id === c.id);
    const counts = emptyCounts();
    for (const p of ownPosts) {
      if (p.status in counts) counts[p.status as keyof CampaignPostCounts]++;
    }
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      createdAt: c.created_at,
      totalPosts: ownPosts.length,
      counts,
    };
  });
}

export interface CampaignPostTargetDetail {
  platform: string;
  accountId: string;
  status: string;
  platformPostUrl: string | null;
  errorMessage: string | null;
}

export interface CampaignPostDetail {
  id: string;
  productId: string | null;
  productName: string | null;
  productSlug: string | null;
  content: string;
  mediaUrls: string[];
  status: string;
  scheduledFor: string | null;
  timezone: string | null;
  providerPostId: string | null;
  errorMessage: string | null;
  targets: CampaignPostTargetDetail[];
}

export interface CampaignDetail extends CampaignSummary {
  posts: CampaignPostDetail[];
}

export async function getCampaignDetail(organizationId: string, campaignId: string): Promise<CampaignDetail> {
  const supabase = getSupabaseServiceClient();

  const { data: campaign, error: campaignError } = await supabase
    .from("social_campaigns")
    .select("id, name, status, created_at")
    .eq("organization_id", organizationId)
    .eq("id", campaignId)
    .maybeSingle();

  if (campaignError) throw new Error(`Erreur lecture campagne: ${campaignError.message}`);
  if (!campaign) throw new NotFoundError("Campagne introuvable.");

  const { data: postRows, error: postsError } = await supabase
    .from("social_posts")
    .select(
      "id, product_id, content, media_urls, status, scheduled_for, timezone, provider_post_id, error_message, products(name, slug)",
    )
    .eq("organization_id", organizationId)
    .eq("campaign_id", campaignId)
    .order("scheduled_for", { ascending: true });

  if (postsError) throw new Error(`Erreur lecture publications: ${postsError.message}`);

  const postIds = (postRows ?? []).map((p) => p.id);
  const { data: targetRows, error: targetsError } =
    postIds.length > 0
      ? await supabase
          .from("social_post_targets")
          .select("post_id, platform, provider_account_id, status, platform_post_url, error_message")
          .in("post_id", postIds)
      : { data: [] as never[], error: null };

  if (targetsError) throw new Error(`Erreur lecture cibles: ${targetsError.message}`);

  const counts = emptyCounts();
  const posts: CampaignPostDetail[] = (postRows ?? []).map((p) => {
    if (p.status in counts) counts[p.status as keyof CampaignPostCounts]++;
    const product = (p as unknown as { products?: { name?: string; slug?: string } | null }).products;
    return {
      id: p.id,
      productId: p.product_id,
      productName: product?.name ?? null,
      productSlug: product?.slug ?? null,
      content: p.content,
      mediaUrls: p.media_urls ?? [],
      status: p.status,
      scheduledFor: p.scheduled_for,
      timezone: p.timezone,
      providerPostId: p.provider_post_id,
      errorMessage: p.error_message,
      targets: (targetRows ?? [])
        .filter((t) => t.post_id === p.id)
        .map((t) => ({
          platform: t.platform,
          accountId: t.provider_account_id,
          status: t.status,
          platformPostUrl: t.platform_post_url,
          errorMessage: t.error_message,
        })),
    };
  });

  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    createdAt: campaign.created_at,
    totalPosts: posts.length,
    counts,
    posts,
  };
}

/**
 * Annule une publication pas encore diffusée (brouillon ou programmée).
 * CONFIRMÉ (social-publishing-provider.ts::cancelPost) : un post déjà
 * publié ne peut pas être annulé — on applique la même garde ici plutôt
 * que de laisser Zernio renvoyer une erreur opaque à l'écran.
 */
export async function cancelCampaignPost(organizationId: string, postId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { data: post, error } = await supabase
    .from("social_posts")
    .select("id, status, provider_post_id")
    .eq("organization_id", organizationId)
    .eq("id", postId)
    .maybeSingle();

  if (error) throw new Error(`Erreur lecture publication: ${error.message}`);
  if (!post) throw new NotFoundError("Publication introuvable.");
  if (post.status !== "draft" && post.status !== "scheduled") {
    throw new ValidationError("Seule une publication en brouillon ou programmée peut être annulée.");
  }

  if (post.provider_post_id) {
    const socialProvider = await getSocialPublishingProvider(organizationId);
    await socialProvider.cancelPost(post.provider_post_id);
  }

  await supabase.from("social_posts").update({ status: "cancelled" }).eq("id", postId);
}

/** Vérifie si un SocialPublishingProvider est connecté, sans lever — pour affichage proactif d'un bandeau côté écran plutôt que d'attendre l'échec à la soumission. */
export async function checkSocialProviderConnected(organizationId: string): Promise<string | null> {
  try {
    await getSocialPublishingProvider(organizationId);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export interface TopPublicationEntry {
  providerPostId: string;
  platform: string;
  status: string | null;
  productName: string | null;
  productSlug: string | null;
  campaignName: string | null;
  contentPreview: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  engagement: number;
}

export interface GetTopPublicationsResult {
  entries: TopPublicationEntry[];
  error: string | null;
}

/**
 * ROADMAP.md, point 3 : `getAnalytics` existe côté SocialPublishingProvider
 * mais aucun écran dashboard ne l'appelait — premier appel réel. Erreur
 * provider retournée honnêtement dans `error` plutôt que de faire planter
 * la page (même approche que `listAvailableGroupsFromZernio` côté groupes
 * WhatsApp).
 */
export async function getTopPublications(organizationId: string, limit = 10): Promise<GetTopPublicationsResult> {
  let socialProvider;
  try {
    socialProvider = await getSocialPublishingProvider(organizationId);
  } catch (err) {
    return { entries: [], error: err instanceof Error ? err.message : String(err) };
  }

  let raw;
  try {
    raw = await socialProvider.getAnalytics({ sortBy: "engagement", limit });
  } catch (err) {
    return { entries: [], error: err instanceof Error ? err.message : String(err) };
  }

  if (raw.length === 0) return { entries: [], error: null };

  const supabase = getSupabaseServiceClient();
  const providerPostIds = raw.map((r) => r.providerPostId);
  const { data: localPosts } = await supabase
    .from("social_posts")
    .select("provider_post_id, content, status, products(name, slug), social_campaigns(name)")
    .eq("organization_id", organizationId)
    .in("provider_post_id", providerPostIds);

  const localByProviderId = new Map((localPosts ?? []).map((p) => [p.provider_post_id, p]));

  const entries: TopPublicationEntry[] = raw.map((r) => {
    const local = localByProviderId.get(r.providerPostId) as
      | {
          content?: string;
          status?: string;
          products?: { name?: string; slug?: string } | null;
          social_campaigns?: { name?: string } | null;
        }
      | undefined;
    const views = r.views ?? 0;
    const likes = r.likes ?? 0;
    const comments = r.comments ?? 0;
    const shares = r.shares ?? 0;
    const clicks = r.clicks ?? 0;
    return {
      providerPostId: r.providerPostId,
      platform: r.platform,
      status: local?.status ?? null,
      productName: local?.products?.name ?? null,
      productSlug: local?.products?.slug ?? null,
      campaignName: local?.social_campaigns?.name ?? null,
      contentPreview: local?.content ? local.content.slice(0, 120) : null,
      views,
      likes,
      comments,
      shares,
      clicks,
      engagement: likes + comments + shares + clicks,
    };
  });

  return { entries, error: null };
}
