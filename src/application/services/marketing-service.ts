import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getSocialPublishingProvider } from "@/infrastructure/providers/registry";
import type { SocialPostTarget } from "@/domain/ports/social-publishing-provider";
import type { SocialPostStatusUpdatedEvent } from "@/domain/events/domain-events";
import { env } from "@/lib/env";
import { canUseFeature } from "./entitlements-service";
import { trackEvent } from "./analytics-service";
import { notifyOrgAdmins } from "./notification-service";
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

      // Lot M, Partie 2 (résout le TODO signalé par RAPPORT_LOT_H.md,
      // §4/§TODO) : `trackEvent("publication_published")` ne se déclenche
      // plus ici, à la PROGRAMMATION — il se déclenche maintenant dans
      // `handlePostStatusWebhook` ci-dessous, au moment de la confirmation
      // webhook réelle (`post.published`/`post.partial`/
      // `post.platform.published`) que Zernio a effectivement diffusé la
      // publication sur au moins une plateforme.
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

// ---------------------------------------------------------------------------
// Lot M — lecture pour l'UI (statut réel par plateforme, pas seulement
// "programmé"). Ce lot ferme la synchronisation des RÉSULTATS ; le Lot H
// n'avait jamais construit d'écran pour les publications (recherché dans
// tout src/app, aucune route ne l'utilisait) — voir RAPPORT_LOT_M.md pour
// le choix de scope : une liste, pas le constructeur de campagne
// lui-même (sélection de produits/comptes), qui reste hors du périmètre
// de CE lot ("groupes + synchronisation des publications").
// ---------------------------------------------------------------------------

export interface PostTargetStatus {
  platform: string;
  status: string;
  platformPostUrl: string | null;
  errorMessage: string | null;
}

export interface PostListItem {
  id: string;
  content: string;
  status: string;
  scheduledFor: string | null;
  errorMessage: string | null;
  createdAt: string;
  targets: PostTargetStatus[];
}

export async function listRecentPosts(organizationId: string, limit = 30): Promise<PostListItem[]> {
  const supabase = getSupabaseServiceClient();

  const { data: posts, error } = await supabase
    .from("social_posts")
    .select("id, content, status, scheduled_for, error_message, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`listRecentPosts(${organizationId}) error:`, error.message);
    return [];
  }
  if (!posts || posts.length === 0) return [];

  const postIds = posts.map((p) => p.id as string);
  const { data: targets, error: targetsError } = await supabase
    .from("social_post_targets")
    .select("post_id, platform, status, platform_post_url, error_message")
    .eq("organization_id", organizationId)
    .in("post_id", postIds);

  if (targetsError) {
    console.error(`listRecentPosts(${organizationId}) targets error:`, targetsError.message);
  }

  const targetsByPost = new Map<string, PostTargetStatus[]>();
  for (const t of targets ?? []) {
    const list = targetsByPost.get(t.post_id as string) ?? [];
    list.push({
      platform: t.platform as string,
      status: t.status as string,
      platformPostUrl: (t.platform_post_url as string | null) ?? null,
      errorMessage: (t.error_message as string | null) ?? null,
    });
    targetsByPost.set(t.post_id as string, list);
  }

  return posts.map((p) => ({
    id: p.id as string,
    content: p.content as string,
    status: p.status as string,
    scheduledFor: (p.scheduled_for as string | null) ?? null,
    errorMessage: (p.error_message as string | null) ?? null,
    createdAt: p.created_at as string,
    targets: targetsByPost.get(p.id as string) ?? [],
  }));
}

/** Statuts `social_posts`/`social_post_targets` que ce lot est capable de refléter (voir domain-events.ts). */
const CONFIRMABLE_STATUSES = new Set(["published", "partial"]);

/**
 * Traite la confirmation webhook Zernio qu'une publication a été
 * effectivement diffusée (ou a échoué) — voir mapper.ts::mapZernioPostEventToDomainEvent
 * et app/api/webhooks/zernio/route.ts. Retrouve la ligne `social_posts`
 * par `provider_post_id`, scopée par organisation (défense en profondeur,
 * même si `provider_post_id` est déjà unique côté Zernio) — jamais par
 * confiance aveugle dans `event.organizationId` seul.
 *
 * Idempotent par construction : chaque mise à jour est un UPDATE ciblé
 * par clé (id de post / (post_id, platform, provider_account_id)),
 * jamais un INSERT — un même état reçu plusieurs fois (webhook_events
 * déduplique déjà l'event id exact côté route.ts ; ceci protège en plus
 * contre deux events DIFFÉRENTS qui décriraient le même aboutissement,
 * ex: un `post.published` agrégé ET un `post.platform.published` pour la
 * même plateforme) aboutit au même état final, jamais dupliqué.
 */
export async function handlePostStatusWebhook(
  event: SocialPostStatusUpdatedEvent,
): Promise<{ handled: boolean }> {
  const supabase = getSupabaseServiceClient();
  const { organizationId, payload } = event;

  const { data: postRow, error: postError } = await supabase
    .from("social_posts")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("provider_post_id", payload.providerPostId)
    .maybeSingle();

  if (postError) {
    console.error(
      `handlePostStatusWebhook: lecture social_posts échouée (provider_post_id=${payload.providerPostId}):`,
      postError.message,
    );
    return { handled: false };
  }
  if (!postRow) {
    // Post inconnu de ce tenant (ou d'un autre tenant — la résolution en
    // amont via resolveOrganizationIdByProviderPostId aurait déjà échoué
    // dans ce cas précis, donc ce cas ne devrait normalement pas se
    // produire ; gardé en défense en profondeur, pas une erreur bloquante).
    console.warn(
      `handlePostStatusWebhook: aucun social_posts pour provider_post_id=${payload.providerPostId} (org ${organizationId})`,
    );
    return { handled: false };
  }

  const previousStatus = postRow.status as string;

  if (payload.overallStatus) {
    const { error: updateError } = await supabase
      .from("social_posts")
      .update({ status: payload.overallStatus, error_message: payload.overallErrorMessage ?? null })
      .eq("id", postRow.id);
    if (updateError) {
      console.error(`handlePostStatusWebhook: échec update social_posts (${postRow.id}):`, updateError.message);
    }
  }

  // Une ligne social_post_targets existe déjà par cible depuis la
  // programmation (createCampaignFromProducts) — on la retrouve par clé
  // plutôt que d'en insérer une nouvelle.
  for (const target of payload.targets) {
    const { error: targetError } = await supabase
      .from("social_post_targets")
      .update({
        status: target.status,
        platform_post_id: target.platformPostId ?? null,
        platform_post_url: target.platformPostUrl ?? null,
        error_message: target.errorMessage ?? null,
      })
      .eq("post_id", postRow.id)
      .eq("platform", target.platform)
      .eq("provider_account_id", target.accountId);

    if (targetError) {
      console.error(
        `handlePostStatusWebhook: échec update social_post_targets (post ${postRow.id}, plateforme ${target.platform}):`,
        targetError.message,
      );
    }
  }

  const failedPlatforms = payload.targets.filter((t) => t.status === "failed").map((t) => t.platform);
  const anyFailure = payload.overallStatus === "failed" || payload.overallStatus === "partial" || failedPlatforms.length > 0;

  if (anyFailure) {
    // Best-effort — notifyOrgAdmins ne lève jamais (notification-service.ts).
    await notifyOrgAdmins({
      organizationId,
      title: payload.overallStatus === "failed" ? "Publication échouée" : "Publication partiellement échouée",
      body:
        failedPlatforms.length > 0
          ? `Échec sur : ${failedPlatforms.join(", ")}.${payload.overallErrorMessage ? ` ${payload.overallErrorMessage}` : ""}`
          : (payload.overallErrorMessage ?? "La publication a échoué chez le fournisseur."),
      relatedEntityType: "social_post",
      relatedEntityId: postRow.id,
    });
  }

  // `trackEvent("publication_published")` se déclenche ICI — la
  // confirmation webhook réelle — plus à la programmation (voir
  // createCampaignFromProducts ci-dessus). "partial" compte : au moins
  // une plateforme a réellement été atteinte. Gardé par `previousStatus`
  // pour ne compter qu'UNE fois par post même si plusieurs events
  // différents (agrégé + par-plateforme) confirment le même aboutissement
  // l'un après l'autre — webhook_events (route.ts) ne déduplique que
  // l'event id exact, pas ce cas.
  const trulyPublished =
    payload.overallStatus === "published" ||
    payload.overallStatus === "partial" ||
    payload.targets.some((t) => t.status === "published");

  if (trulyPublished && !CONFIRMABLE_STATUSES.has(previousStatus)) {
    await trackEvent(organizationId, "publication_published", "social_post", postRow.id, {
      providerPostId: payload.providerPostId,
    });
  }

  return { handled: true };
}
