import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getSocialPublishingProvider } from "@/infrastructure/providers/registry";
import { AppError, AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";

/**
 * C5 — annulation, reprogrammation et listage des publications programmées.
 *
 * Deux familles, deux mécanismes :
 *  - `social` (Facebook, Instagram, TikTok, LinkedIn, X, Pinterest, YouTube) :
 *    passe par Zernio. L'annulation = `DELETE /posts/{id}` (brouillon ou post
 *    programmé ; un post publié ne se supprime pas par cette route).
 *  - `telegram` : canal DIRECT (bot du tenant), hors Zernio. Annulation =
 *    changement de statut dans `telegram_publications` (le cron ne traite que
 *    `scheduled`), sans appel externe.
 *
 * Règle d'honnêteté (déjà posée par marketing-service::pauseScheduledPostsForProduct) :
 * on ne marque JAMAIS « annulé » si le fournisseur n'a pas confirmé. Une
 * annulation échouée laisse le statut intact et la trace dans `error_message`.
 *
 * Isolation : ces services tournent en service-role, donc CHAQUE entrée vérifie
 * que l'acteur est membre de l'organisation ciblée (principe 5 du contexte
 * commun) ; les droits fins (rôle, réglages) relèvent du moteur de règles C1.
 */
export interface PublicationActor {
  userId: string;
  organizationId: string;
}

export type PublicationKind = "social" | "telegram";

export type CancelDecision =
  | "cancel_remote" // post lié au fournisseur : l'annuler d'abord chez lui
  | "cancel_local" // jamais transmis au fournisseur, ou canal direct : statut seulement
  | "already_cancelled" // idempotence : rien à faire
  | "refuse";

/** Statuts annulables par famille (le reste est refusé, jamais « forcé »). */
const SOCIAL_CANCELLABLE = new Set(["draft", "scheduled", "paused"]);
const TELEGRAM_CANCELLABLE = new Set(["scheduled"]);

/** Décision pure et testable : que faire d'une demande d'annulation ? */
export function decideCancellation(kind: PublicationKind, status: string, hasProviderPostId: boolean): { decision: CancelDecision; reason?: string } {
  if (status === "cancelled") return { decision: "already_cancelled" };
  if (kind === "telegram") {
    if (TELEGRAM_CANCELLABLE.has(status)) return { decision: "cancel_local" };
    if (status === "processing") return { decision: "refuse", reason: "L'envoi est en cours : il ne peut plus être annulé." };
    return { decision: "refuse", reason: "Cette publication Telegram est déjà traitée." };
  }
  if (SOCIAL_CANCELLABLE.has(status)) return { decision: hasProviderPostId ? "cancel_remote" : "cancel_local" };
  if (status === "published" || status === "partial") {
    return { decision: "refuse", reason: "Une publication déjà diffusée ne peut pas être annulée ici (l'historique est conservé)." };
  }
  return { decision: "refuse", reason: "Cette publication n'est pas annulable dans son état actuel." };
}

/** Erreur Zernio « introuvable » : le post n'existe plus chez eux, l'état voulu est atteint. */
export function isProviderNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\(404\)/.test(message);
}

/** Même règle que l'existant (omnichannel-publication-service::validateFutureDate) : au moins 30 s dans le futur. */
export function parseFutureDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now() + 30_000) {
    throw new ValidationError("Choisissez une date et une heure futures.");
  }
  return date;
}

export async function assertActorInOrganization(actor: PublicationActor): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("organization_id", actor.organizationId)
    .eq("user_id", actor.userId)
    .maybeSingle();
  if (error) throw new Error(`Vérification d'appartenance impossible: ${error.message}`);
  if (!data) throw new AuthorizationError("Vous n'appartenez pas à cette organisation.");
}

export interface CancelResult {
  id: string;
  kind: PublicationKind;
  result: "cancelled" | "already_cancelled";
}

export async function cancelSocialPost(actor: PublicationActor, postId: string): Promise<CancelResult> {
  await assertActorInOrganization(actor);
  const supabase = getSupabaseServiceClient();
  const { data: post, error } = await supabase
    .from("social_posts")
    .select("id, status, provider_post_id")
    .eq("id", postId)
    .eq("organization_id", actor.organizationId)
    .maybeSingle();
  if (error) throw new Error(`Lecture de la publication impossible: ${error.message}`);
  if (!post) throw new NotFoundError("Publication introuvable.");

  const { decision, reason } = decideCancellation("social", post.status as string, Boolean(post.provider_post_id));
  if (decision === "already_cancelled") return { id: postId, kind: "social", result: "already_cancelled" };
  if (decision === "refuse") throw new ValidationError(reason ?? "Annulation impossible.");

  if (decision === "cancel_remote") {
    try {
      const provider = await getSocialPublishingProvider(actor.organizationId);
      await provider.cancelPost(post.provider_post_id as string);
    } catch (cause) {
      // 404 : le post n'existe plus chez le fournisseur (ex. déjà supprimé) → on poursuit.
      if (!isProviderNotFound(cause)) {
        const message = cause instanceof Error ? cause.message : String(cause);
        await supabase
          .from("social_posts")
          .update({ error_message: `Annulation non confirmée par le fournisseur : ${message}`.slice(0, 500) })
          .eq("id", postId)
          .eq("organization_id", actor.organizationId);
        throw new AppError("L'annulation n'a pas pu être confirmée : la publication reste programmée. Réessayez ou annulez sur le compte connecté.", 502, "provider");
      }
    }
  }

  // Mise à jour gardée par le statut : si la publication a changé entre-temps
  // (publiée par le cron), on ne l'écrase pas.
  const { data: updated, error: updateError } = await supabase
    .from("social_posts")
    .update({ status: "cancelled", error_message: null, cancelled_at: new Date().toISOString(), cancelled_by: actor.userId })
    .eq("id", postId)
    .eq("organization_id", actor.organizationId)
    .in("status", [...SOCIAL_CANCELLABLE])
    .select("id")
    .maybeSingle();
  if (updateError) throw new Error(`Annulation impossible: ${updateError.message}`);
  if (!updated) throw new ValidationError("La publication a changé d'état pendant l'annulation. Vérifiez son statut.");

  await supabase
    .from("social_post_targets")
    .update({ status: "cancelled" })
    .eq("post_id", postId)
    .eq("organization_id", actor.organizationId)
    .eq("status", "pending");
  return { id: postId, kind: "social", result: "cancelled" };
}

export async function cancelTelegramPublicationScheduled(actor: PublicationActor, publicationId: string): Promise<CancelResult> {
  await assertActorInOrganization(actor);
  const supabase = getSupabaseServiceClient();
  const { data: row, error } = await supabase
    .from("telegram_publications")
    .select("id, status")
    .eq("id", publicationId)
    .eq("organization_id", actor.organizationId)
    .maybeSingle();
  if (error) throw new Error(`Lecture de la publication Telegram impossible: ${error.message}`);
  if (!row) throw new NotFoundError("Publication Telegram introuvable.");

  const { decision, reason } = decideCancellation("telegram", row.status as string, false);
  if (decision === "already_cancelled") return { id: publicationId, kind: "telegram", result: "already_cancelled" };
  if (decision === "refuse") throw new ValidationError(reason ?? "Annulation impossible.");

  // Garde atomique : le cron passe `scheduled` → `processing` ; si la ligne a
  // déjà basculé, la mise à jour ne touche rien et on le dit.
  const { data: updated, error: updateError } = await supabase
    .from("telegram_publications")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: actor.userId })
    .eq("id", publicationId)
    .eq("organization_id", actor.organizationId)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  if (updateError) throw new Error(`Annulation impossible: ${updateError.message}`);
  if (!updated) throw new ValidationError("L'envoi vient de démarrer : il ne peut plus être annulé.");
  return { id: publicationId, kind: "telegram", result: "cancelled" };
}

export function cancelScheduledPublication(actor: PublicationActor, target: { kind: PublicationKind; id: string }): Promise<CancelResult> {
  return target.kind === "telegram" ? cancelTelegramPublicationScheduled(actor, target.id) : cancelSocialPost(actor, target.id);
}

/**
 * Reprogrammation d'une publication Telegram (canal direct : simple mise à jour
 * de `scheduled_for`, gardée par le statut).
 *
 * Reprogrammation SOCIALE volontairement absente de cette PR : Zernio expose
 * `PUT /posts/{id}` (post programmé modifiable) mais la forme exacte du corps
 * est « à vérifier » ; test le moins coûteux = un post brouillon de test sur le
 * compte de démonstration. Contournement possible en attendant : annuler puis
 * reprogrammer (action `sensitive`, deux étapes confirmées).
 */
export async function rescheduleTelegramPublication(actor: PublicationActor, publicationId: string, newDate: string): Promise<{ id: string; scheduledFor: string }> {
  await assertActorInOrganization(actor);
  const date = parseFutureDate(newDate);
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("telegram_publications")
    .update({ scheduled_for: date.toISOString() })
    .eq("id", publicationId)
    .eq("organization_id", actor.organizationId)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Reprogrammation impossible: ${error.message}`);
  if (!data) throw new NotFoundError("Publication introuvable ou déjà traitée.");
  return { id: publicationId, scheduledFor: date.toISOString() };
}

export interface ScheduledPublication {
  id: string;
  kind: PublicationKind;
  platform: string;
  label: string | null;
  content: string;
  scheduledFor: string;
  status: string;
}

/** Toutes les publications programmées (réseaux + Telegram), de la plus proche à la plus lointaine. */
export async function listScheduledPublications(actor: PublicationActor, limit = 50): Promise<ScheduledPublication[]> {
  await assertActorInOrganization(actor);
  const supabase = getSupabaseServiceClient();
  const [social, telegram] = await Promise.all([
    supabase
      .from("social_posts")
      .select("id, content, status, scheduled_for, social_post_targets(platform)")
      .eq("organization_id", actor.organizationId)
      .eq("status", "scheduled")
      .not("scheduled_for", "is", null)
      .order("scheduled_for", { ascending: true })
      .limit(limit),
    supabase
      .from("telegram_publications")
      .select("id, content, status, scheduled_for, target_label")
      .eq("organization_id", actor.organizationId)
      .eq("status", "scheduled")
      .not("scheduled_for", "is", null)
      .order("scheduled_for", { ascending: true })
      .limit(limit),
  ]);
  if (social.error) throw new Error(`Lecture des publications programmées impossible: ${social.error.message}`);
  if (telegram.error) throw new Error(`Lecture des publications Telegram programmées impossible: ${telegram.error.message}`);

  const items: ScheduledPublication[] = [];
  for (const row of social.data ?? []) {
    const targets = (row.social_post_targets as Array<{ platform: string }> | null) ?? [];
    items.push({
      id: row.id as string,
      kind: "social",
      platform: targets[0]?.platform ?? "social",
      label: null,
      content: row.content as string,
      scheduledFor: row.scheduled_for as string,
      status: row.status as string,
    });
  }
  for (const row of telegram.data ?? []) {
    items.push({
      id: row.id as string,
      kind: "telegram",
      platform: "telegram",
      label: (row.target_label as string | null) ?? null,
      content: row.content as string,
      scheduledFor: row.scheduled_for as string,
      status: row.status as string,
    });
  }
  return items.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor)).slice(0, limit);
}
