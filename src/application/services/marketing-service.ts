import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getSocialPublishingProvider } from "@/infrastructure/providers/registry";
import type { SocialPostTarget } from "@/domain/ports/social-publishing-provider";
import { env } from "@/lib/env";
import { canUseFeature } from "./entitlements-service";
import { QuotaExceededError } from "@/lib/errors";

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
