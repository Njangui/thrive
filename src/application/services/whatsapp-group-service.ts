import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getMessagingProvider } from "@/infrastructure/providers/registry";
import type { WhatsAppGroupSummary } from "@/domain/ports/messaging-provider";
import { canUseFeature } from "./entitlements-service";
import { getProductsByIds, type CatalogProductSummary } from "./catalog-service";
import { notifyOrgAdmins } from "./notification-service";
import { env } from "@/lib/env";
import { NotFoundError, QuotaExceededError, ValidationError } from "@/lib/errors";

/**
 * Lot F — Groupes WhatsApp & diffusion groupée (master prompt §39-40,
 * §43-44). Voir docs/ZERNIO_INTEGRATION.md ("Groupes WhatsApp") pour ce
 * qui est confirmé/limité côté API avant de modifier ce fichier.
 *
 * Point central à garder en tête partout ci-dessous : CONFIRMÉ
 * (docs.zernio.com/platforms/whatsapp/groups) qu'envoyer un message dans
 * un groupe exige une conversation Zernio déjà établie, elle-même créée
 * "automatiquement quand un message de groupe est REÇU" — jamais par un
 * envoi à froid. La réception de messages DANS un groupe est hors scope
 * de ce lot (cahier, section "Hors scope"). Conséquence assumée et
 * honnête : `whatsapp_groups.zernio_conversation_id` reste NULL pour tout
 * groupe connecté par ce lot, et toute diffusion vers ce groupe échoue
 * explicitement plutôt que de simuler un envoi qui n'a jamais eu lieu.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectedGroup {
  id: string;
  externalId: string;
  name: string;
  /** NULLABLE : Zernio ne renvoie pas ce champ (voir types.ts du provider). */
  participantCount: number | null;
  status: "connected" | "disconnected" | "error";
  /**
   * true seulement si une conversation Zernio est déjà établie avec ce
   * groupe — condition réelle et nécessaire pour qu'une diffusion puisse
   * l'atteindre. Piloté par l'UI pour prévenir le commerçant AVANT qu'il
   * programme une diffusion vers un groupe qui ne peut pas encore la
   * recevoir, plutôt que de le découvrir après coup dans l'historique.
   */
  isSendable: boolean;
  connectedAt: string;
}

export interface AvailableZernioGroup {
  externalId: string;
  name: string;
  createdAt: string | null;
  alreadyConnected: boolean;
}

export interface ListAvailableGroupsResult {
  groups: AvailableZernioGroup[];
  /** Erreur provider honnête (jamais masquée par une liste vide silencieuse) — ex: numéro en Coexistence, provider non connecté. */
  error: string | null;
}

export interface ConnectGroupsResult {
  connected: ConnectedGroup[];
  skipped: { externalId: string; reason: string }[];
}

export interface SyncGroupsResult {
  refreshed: number;
  markedError: number;
  error: string | null;
}

export interface BroadcastSummary {
  id: string;
  scheduledAt: string;
  status: "scheduled" | "processing" | "completed" | "failed" | "cancelled";
  productCount: number;
  targetCount: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
}

export interface BroadcastTargetDetail {
  id: string;
  groupId: string;
  groupName: string;
  status: "pending" | "sent" | "failed";
  errorMessage: string | null;
  sentAt: string | null;
}

export interface BroadcastDetail extends BroadcastSummary {
  products: CatalogProductSummary[];
  targets: BroadcastTargetDetail[];
}

export interface ProcessBroadcastsResult {
  processedBroadcasts: number;
  sentTargets: number;
  failedTargets: number;
}

interface WhatsAppGroupRow {
  id: string;
  external_id: string;
  name: string;
  participant_count: number | null;
  status: string;
  zernio_conversation_id: string | null;
  connected_at: string;
}

function mapGroupRow(row: WhatsAppGroupRow): ConnectedGroup {
  return {
    id: row.id,
    externalId: row.external_id,
    name: row.name,
    participantCount: row.participant_count,
    status: row.status as ConnectedGroup["status"],
    isSendable: row.zernio_conversation_id !== null,
    connectedAt: row.connected_at,
  };
}

// ---------------------------------------------------------------------------
// Groupes — lecture
// ---------------------------------------------------------------------------

export async function listConnectedGroups(organizationId: string): Promise<ConnectedGroup[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("whatsapp_groups")
    .select("id, external_id, name, participant_count, status, zernio_conversation_id, connected_at")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });

  if (error) throw new Error(`Erreur lecture whatsapp_groups: ${error.message}`);
  return (data ?? []).map((row) => mapGroupRow(row as WhatsAppGroupRow));
}

/**
 * Liste les groupes visibles côté Zernio pour le compte connecté, en
 * signalant lesquels sont déjà connectés localement — c'est la liste
 * candidate pour l'action "Connecter" de l'UI. Ne lève jamais : les échecs
 * (provider non connecté, groupes non supportés, numéro en Coexistence...)
 * sont retournés dans `error` pour un affichage honnête plutôt qu'un crash
 * de page ou une liste vide trompeuse.
 */
export async function listAvailableGroupsFromZernio(organizationId: string): Promise<ListAvailableGroupsResult> {
  let provider;
  try {
    provider = await getMessagingProvider(organizationId);
  } catch (err) {
    return { groups: [], error: err instanceof Error ? err.message : String(err) };
  }

  if (!provider.listWhatsAppGroups) {
    return {
      groups: [],
      error: `Le provider de messagerie connecté ("${provider.providerName}") ne prend pas en charge les groupes WhatsApp.`,
    };
  }

  let raw: WhatsAppGroupSummary[];
  try {
    raw = await provider.listWhatsAppGroups(organizationId);
  } catch (err) {
    // CONFIRMÉ (docs.zernio.com/platforms/whatsapp/groups) : erreur
    // attendue en particulier si le numéro WhatsApp est connecté en mode
    // Coexistence (Cloud API + app WhatsApp Business sur le même
    // téléphone) — l'API de groupes n'y est pas disponible.
    return { groups: [], error: err instanceof Error ? err.message : String(err) };
  }

  const supabase = getSupabaseServiceClient();
  const { data: connectedRows } = await supabase
    .from("whatsapp_groups")
    .select("external_id, status")
    .eq("organization_id", organizationId);

  const connectedIds = new Set(
    (connectedRows ?? []).filter((r) => r.status === "connected").map((r) => r.external_id),
  );

  return {
    groups: raw.map((g) => ({
      externalId: g.externalId,
      name: g.name,
      createdAt: g.createdAt,
      alreadyConnected: connectedIds.has(g.externalId),
    })),
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Groupes — connexion / déconnexion
// ---------------------------------------------------------------------------

/**
 * Connecte un lot de groupes en une seule vérification de quota atomique
 * (jamais N vérifications séquentielles qui, prises isolément, passeraient
 * chacune alors que le lot entier dépasse la limite). Un groupe déjà
 * `connected` est un no-op silencieux (ne pèse pas deux fois sur le
 * quota) ; un groupe `disconnected`/`error` qu'on reconnecte compte
 * normalement.
 */
export async function connectGroups(
  organizationId: string,
  candidates: { externalId: string; name: string }[],
  _actorUserId: string,
): Promise<ConnectGroupsResult> {
  if (candidates.length === 0) {
    return { connected: [], skipped: [] };
  }

  const supabase = getSupabaseServiceClient();
  const dedupedCandidates: { externalId: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.externalId)) continue;
    seen.add(candidate.externalId);
    dedupedCandidates.push(candidate);
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("whatsapp_groups")
    .select("external_id, status")
    .eq("organization_id", organizationId)
    .in(
      "external_id",
      dedupedCandidates.map((c) => c.externalId),
    );

  if (existingError) throw new Error(`Erreur lecture whatsapp_groups: ${existingError.message}`);
  const statusByExternalId = new Map((existingRows ?? []).map((r) => [r.external_id, r.status]));

  const skipped: { externalId: string; reason: string }[] = [];
  const toUpsert: { externalId: string; name: string }[] = [];

  for (const candidate of dedupedCandidates) {
    if (statusByExternalId.get(candidate.externalId) === "connected") {
      skipped.push({ externalId: candidate.externalId, reason: "Déjà connecté" });
      continue;
    }
    toUpsert.push(candidate);
  }

  if (toUpsert.length === 0) {
    return { connected: [], skipped };
  }

  // Lot B (section 34-36/62-63) — vérifié AVANT toute écriture, serveur.
  const entitlement = await canUseFeature(organizationId, "whatsapp_groups", toUpsert.length);
  if (!entitlement.allowed) {
    throw new QuotaExceededError(
      entitlement.limit === 0
        ? "Les groupes WhatsApp ne sont pas inclus dans votre offre actuelle. Passez à un forfait supérieur pour en connecter."
        : `Vous avez atteint la limite de ${entitlement.limit} groupe(s) WhatsApp de votre offre ` +
            `(${entitlement.used} déjà connecté(s)). Déconnectez un groupe existant ou passez à un forfait supérieur.`,
    );
  }

  const rows = toUpsert.map((c) => ({
    organization_id: organizationId,
    external_id: c.externalId,
    name: c.name,
    status: "connected",
    connected_at: new Date().toISOString(),
  }));

  const { data: upserted, error: upsertError } = await supabase
    .from("whatsapp_groups")
    .upsert(rows, { onConflict: "organization_id,external_id" })
    .select("id, external_id, name, participant_count, status, zernio_conversation_id, connected_at");

  if (upsertError) throw new Error(`Erreur connexion groupe(s) WhatsApp: ${upsertError.message}`);

  return {
    connected: (upserted ?? []).map((row) => mapGroupRow(row as WhatsAppGroupRow)),
    skipped,
  };
}

/** Convenience mono-groupe au-dessus de `connectGroups` — reste idempotent si déjà connecté. */
export async function connectGroup(
  organizationId: string,
  externalId: string,
  name: string,
  actorUserId: string,
): Promise<ConnectedGroup> {
  const result = await connectGroups(organizationId, [{ externalId, name }], actorUserId);
  if (result.connected[0]) return result.connected[0];

  const existing = await listConnectedGroups(organizationId);
  const match = existing.find((g) => g.externalId === externalId);
  if (!match) throw new NotFoundError("Groupe introuvable après connexion.");
  return match;
}

/**
 * Déconnecte un groupe (soft — jamais de suppression, cohérent avec le
 * reste du projet qui ne supprime jamais l'historique). Libère
 * effectivement son quota : `entitlements-service.ts` ne compte que les
 * groupes `status = 'connected'` (voir CUMULATIVE_TABLE_BY_KEY).
 */
export async function disconnectGroup(organizationId: string, groupId: string, _actorUserId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("whatsapp_groups")
    .update({ status: "disconnected" })
    .eq("organization_id", organizationId)
    .eq("id", groupId)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Erreur déconnexion groupe: ${error.message}`);
  if (!data) throw new NotFoundError("Groupe WhatsApp introuvable pour cette organisation.");
}

/**
 * Rafraîchit les métadonnées des groupes déjà connectés depuis Zernio
 * (nom à jour) et détecte les groupes disparus côté provider (supprimés,
 * ou le compte n'y a plus accès) en les passant `status = 'error'` — pas
 * `'disconnected'`, qui reste réservé à une action délibérée du
 * commerçant (voir contrainte CHECK, 0018_whatsapp_groups.sql). Ne lève
 * jamais : erreurs provider retournées dans `error`.
 */
export async function syncGroupsFromZernio(organizationId: string): Promise<SyncGroupsResult> {
  let provider;
  try {
    provider = await getMessagingProvider(organizationId);
  } catch (err) {
    return { refreshed: 0, markedError: 0, error: err instanceof Error ? err.message : String(err) };
  }

  if (!provider.listWhatsAppGroups) {
    return {
      refreshed: 0,
      markedError: 0,
      error: `Le provider de messagerie connecté ("${provider.providerName}") ne prend pas en charge les groupes WhatsApp.`,
    };
  }

  const supabase = getSupabaseServiceClient();
  const { data: connectedRows, error: readError } = await supabase
    .from("whatsapp_groups")
    .select("id, external_id, name")
    .eq("organization_id", organizationId)
    .eq("status", "connected");

  if (readError) throw new Error(`Erreur lecture whatsapp_groups: ${readError.message}`);
  const connected = connectedRows ?? [];
  if (connected.length === 0) {
    return { refreshed: 0, markedError: 0, error: null };
  }

  let fresh: WhatsAppGroupSummary[];
  try {
    fresh = await provider.listWhatsAppGroups(organizationId);
  } catch (err) {
    return { refreshed: 0, markedError: 0, error: err instanceof Error ? err.message : String(err) };
  }

  const freshByExternalId = new Map(fresh.map((g) => [g.externalId, g]));

  let refreshed = 0;
  let markedError = 0;

  await Promise.all(
    connected.map(async (row) => {
      const match = freshByExternalId.get(row.external_id);
      if (match) {
        if (match.name !== row.name) {
          await supabase.from("whatsapp_groups").update({ name: match.name }).eq("id", row.id);
        }
        refreshed++;
      } else {
        await supabase.from("whatsapp_groups").update({ status: "error" }).eq("id", row.id);
        markedError++;
      }
    }),
  );

  return { refreshed, markedError, error: null };
}

// ---------------------------------------------------------------------------
// Diffusions
// ---------------------------------------------------------------------------

/**
 * Construit le message groupé (un seul message, produits listés — voir
 * group_broadcast_targets, une ligne PAR GROUPE, pas par produit).
 * Exportée pour être testée sans dépendance DB.
 */
export function formatGroupBroadcastMessage(products: CatalogProductSummary[]): string {
  if (products.length === 0) return "";

  const lines = ["📢 Nouveautés :", ""];
  for (const p of products) {
    lines.push(`• ${p.name} — ${p.unitPrice.toLocaleString("fr-FR")} FCFA`);
    if (p.description) lines.push(`  ${p.description}`);
    if (p.slug) lines.push(`  ${env.NEXT_PUBLIC_APP_URL}/produits/${p.slug}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

/**
 * Crée une diffusion programmée. Le quota `whatsapp_groups` a déjà été
 * appliqué au moment où chaque groupe a été CONNECTÉ (connectGroups) —
 * cette fonction cible des groupes déjà connectés, elle n'en crée aucun,
 * donc elle ne réapplique PAS `canUseFeature("whatsapp_groups", ...)`
 * (qui, avec la sémantique cumulative de ce compteur, pénaliserait à tort
 * une diffusion vers des groupes déjà existants). À la place : vérifie
 * que chaque groupe ciblé appartient réellement à cette organisation et
 * est bien `connected` — la garde utile ici est une garde d'intégrité
 * (IDOR/état), pas une garde de quota.
 */
export async function createBroadcast(
  organizationId: string,
  productIds: string[],
  groupIds: string[],
  scheduledAtIso: string,
  actorUserId: string,
): Promise<{ broadcastId: string; targetCount: number; productCount: number }> {
  const dedupedProductIds = Array.from(new Set(productIds));
  const dedupedGroupIds = Array.from(new Set(groupIds));

  if (dedupedProductIds.length === 0) {
    throw new ValidationError("Sélectionnez au moins un produit à diffuser.");
  }
  if (dedupedGroupIds.length === 0) {
    throw new ValidationError("Sélectionnez au moins un groupe WhatsApp.");
  }

  const scheduledDate = new Date(scheduledAtIso);
  if (Number.isNaN(scheduledDate.getTime())) {
    throw new ValidationError("Date de programmation invalide.");
  }
  // Marge de 60s pour tolérer un léger décalage horloge navigateur/serveur.
  if (scheduledDate.getTime() < Date.now() - 60_000) {
    throw new ValidationError("La date de diffusion doit être dans le futur.");
  }

  const supabase = getSupabaseServiceClient();

  // Défense en profondeur (IDOR, 00_CONVENTIONS_COMMUNES_V2.md, section
  // "Sécurité") : ne jamais faire confiance aux ids reçus du formulaire.
  const { data: groupRows, error: groupError } = await supabase
    .from("whatsapp_groups")
    .select("id, status")
    .eq("organization_id", organizationId)
    .in("id", dedupedGroupIds);

  if (groupError) throw new Error(`Erreur lecture groupes: ${groupError.message}`);
  const validGroupIds = (groupRows ?? []).filter((g) => g.status === "connected").map((g) => g.id);
  if (validGroupIds.length !== dedupedGroupIds.length) {
    throw new ValidationError(
      "Un ou plusieurs groupes sélectionnés sont introuvables ou déconnectés. Rafraîchissez la page et réessayez.",
    );
  }

  const products = await getProductsByIds(organizationId, dedupedProductIds);
  if (products.length !== dedupedProductIds.length) {
    throw new ValidationError("Un ou plusieurs produits sélectionnés sont introuvables.");
  }

  const { data: broadcast, error: broadcastError } = await supabase
    .from("group_broadcasts")
    .insert({
      organization_id: organizationId,
      scheduled_at: scheduledDate.toISOString(),
      status: "scheduled",
      created_by: actorUserId,
    })
    .select("id")
    .single();

  if (broadcastError || !broadcast) {
    throw new Error(`Impossible de créer la diffusion: ${broadcastError?.message}`);
  }

  const productRows = dedupedProductIds.map((productId, index) => ({
    organization_id: organizationId,
    broadcast_id: broadcast.id,
    product_id: productId,
    display_order: index,
  }));

  const { error: productsInsertError } = await supabase.from("group_broadcast_products").insert(productRows);
  if (productsInsertError) {
    throw new Error(`Impossible d'enregistrer les produits de la diffusion: ${productsInsertError.message}`);
  }

  // Une ligne PAR GROUPE — pas par (groupe x produit). 10 produits x 4
  // groupes = 4 lignes ici, jamais 40 : le message groupé liste tous les
  // produits en une seule fois.
  const targetRows = validGroupIds.map((groupId) => ({
    organization_id: organizationId,
    broadcast_id: broadcast.id,
    group_id: groupId,
    status: "pending",
  }));

  const { error: targetsInsertError } = await supabase.from("group_broadcast_targets").insert(targetRows);
  if (targetsInsertError) {
    throw new Error(`Impossible d'enregistrer les cibles de la diffusion: ${targetsInsertError.message}`);
  }

  return { broadcastId: broadcast.id, targetCount: validGroupIds.length, productCount: dedupedProductIds.length };
}

/** N'annule qu'une diffusion pas encore entrée en traitement — jamais une diffusion déjà `processing`/`completed`. */
export async function cancelBroadcast(organizationId: string, broadcastId: string, _actorUserId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("group_broadcasts")
    .update({ status: "cancelled" })
    .eq("organization_id", organizationId)
    .eq("id", broadcastId)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Erreur annulation diffusion: ${error.message}`);
  if (!data) {
    throw new ValidationError("Cette diffusion ne peut plus être annulée (déjà en cours, terminée, ou introuvable).");
  }
}

/**
 * Repasse les cibles en échec d'une diffusion terminée à `pending` et
 * reprogramme la diffusion immédiatement — utile après une erreur
 * transitoire du provider, ou dès qu'un groupe devient réellement
 * sendable (`zernio_conversation_id` renseigné par un futur lot). Ne
 * touche jamais aux cibles déjà `sent` : pas de renvoi en double.
 */
export async function retryFailedTargets(
  organizationId: string,
  broadcastId: string,
  _actorUserId: string,
): Promise<{ retried: number }> {
  const supabase = getSupabaseServiceClient();

  const { data: broadcastRow, error: broadcastError } = await supabase
    .from("group_broadcasts")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("id", broadcastId)
    .maybeSingle();

  if (broadcastError) throw new Error(`Erreur lecture diffusion: ${broadcastError.message}`);
  if (!broadcastRow) throw new NotFoundError("Diffusion introuvable.");
  if (broadcastRow.status !== "completed" && broadcastRow.status !== "failed") {
    throw new ValidationError("Seule une diffusion terminée peut être relancée sur ses cibles en échec.");
  }

  const { data: failedTargets, error: targetsError } = await supabase
    .from("group_broadcast_targets")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("broadcast_id", broadcastId)
    .eq("status", "failed");

  if (targetsError) throw new Error(`Erreur lecture cibles: ${targetsError.message}`);
  const ids = (failedTargets ?? []).map((t) => t.id);
  if (ids.length === 0) return { retried: 0 };

  const { error: resetError } = await supabase
    .from("group_broadcast_targets")
    .update({ status: "pending", error_message: null })
    .in("id", ids);
  if (resetError) throw new Error(`Erreur réinitialisation cibles: ${resetError.message}`);

  const { error: rescheduleError } = await supabase
    .from("group_broadcasts")
    .update({ status: "scheduled", scheduled_at: new Date().toISOString() })
    .eq("id", broadcastId);
  if (rescheduleError) throw new Error(`Erreur reprogrammation diffusion: ${rescheduleError.message}`);

  return { retried: ids.length };
}

/** Historique — 200 diffusions les plus récentes (garde-fou raisonnable, pas de pagination UI en V1). */
export async function listBroadcasts(organizationId: string): Promise<BroadcastSummary[]> {
  const supabase = getSupabaseServiceClient();

  const { data: broadcasts, error } = await supabase
    .from("group_broadcasts")
    .select("id, scheduled_at, status, created_at")
    .eq("organization_id", organizationId)
    .order("scheduled_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(`Erreur lecture diffusions: ${error.message}`);
  if (!broadcasts || broadcasts.length === 0) return [];

  const broadcastIds = broadcasts.map((b) => b.id);

  const [targetsResult, productsResult] = await Promise.all([
    supabase.from("group_broadcast_targets").select("broadcast_id, status").in("broadcast_id", broadcastIds),
    supabase.from("group_broadcast_products").select("broadcast_id").in("broadcast_id", broadcastIds),
  ]);

  if (targetsResult.error) throw new Error(`Erreur lecture cibles: ${targetsResult.error.message}`);
  if (productsResult.error) throw new Error(`Erreur lecture produits liés: ${productsResult.error.message}`);

  const targets = targetsResult.data ?? [];
  const products = productsResult.data ?? [];

  return broadcasts.map((b) => {
    const ownTargets = targets.filter((t) => t.broadcast_id === b.id);
    return {
      id: b.id,
      scheduledAt: b.scheduled_at,
      status: b.status as BroadcastSummary["status"],
      productCount: products.filter((p) => p.broadcast_id === b.id).length,
      targetCount: ownTargets.length,
      sentCount: ownTargets.filter((t) => t.status === "sent").length,
      failedCount: ownTargets.filter((t) => t.status === "failed").length,
      createdAt: b.created_at,
    };
  });
}

export async function getBroadcastDetail(organizationId: string, broadcastId: string): Promise<BroadcastDetail> {
  const supabase = getSupabaseServiceClient();

  const { data: broadcast, error: broadcastError } = await supabase
    .from("group_broadcasts")
    .select("id, scheduled_at, status, created_at")
    .eq("organization_id", organizationId)
    .eq("id", broadcastId)
    .maybeSingle();

  if (broadcastError) throw new Error(`Erreur lecture diffusion: ${broadcastError.message}`);
  if (!broadcast) throw new NotFoundError("Diffusion introuvable.");

  const { data: targetRows, error: targetsError } = await supabase
    .from("group_broadcast_targets")
    .select("id, group_id, status, error_message, sent_at, whatsapp_groups(name)")
    .eq("organization_id", organizationId)
    .eq("broadcast_id", broadcastId);

  if (targetsError) throw new Error(`Erreur lecture cibles: ${targetsError.message}`);

  const { data: productLinkRows, error: productLinkError } = await supabase
    .from("group_broadcast_products")
    .select("product_id, display_order")
    .eq("organization_id", organizationId)
    .eq("broadcast_id", broadcastId)
    .order("display_order", { ascending: true });

  if (productLinkError) throw new Error(`Erreur lecture produits liés: ${productLinkError.message}`);

  const productIds = (productLinkRows ?? []).map((p) => p.product_id);
  const products = await getProductsByIds(organizationId, productIds);
  const productsById = new Map(products.map((p) => [p.id, p]));
  // Réordonne selon display_order — getProductsByIds filtre par `.in()`,
  // qui ne garantit pas l'ordre de retour.
  const orderedProducts = productIds
    .map((id) => productsById.get(id))
    .filter((p): p is CatalogProductSummary => Boolean(p));

  const targets: BroadcastTargetDetail[] = (targetRows ?? []).map((t) => ({
    id: t.id,
    groupId: t.group_id,
    groupName: (t as unknown as { whatsapp_groups?: { name?: string } }).whatsapp_groups?.name ?? "Groupe supprimé",
    status: t.status as BroadcastTargetDetail["status"],
    errorMessage: t.error_message,
    sentAt: t.sent_at,
  }));

  return {
    id: broadcast.id,
    scheduledAt: broadcast.scheduled_at,
    status: broadcast.status as BroadcastSummary["status"],
    productCount: orderedProducts.length,
    targetCount: targets.length,
    sentCount: targets.filter((t) => t.status === "sent").length,
    failedCount: targets.filter((t) => t.status === "failed").length,
    createdAt: broadcast.created_at,
    products: orderedProducts,
    targets,
  };
}

// ---------------------------------------------------------------------------
// Traitement — cron (voir /api/cron/process-broadcasts)
// ---------------------------------------------------------------------------

async function markTargetFailed(targetId: string, errorMessage: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  await supabase
    .from("group_broadcast_targets")
    .update({ status: "failed", error_message: errorMessage })
    .eq("id", targetId);
}

async function processOneBroadcast(
  broadcastId: string,
  organizationId: string,
): Promise<{ sent: number; failed: number }> {
  const supabase = getSupabaseServiceClient();

  await supabase.from("group_broadcasts").update({ status: "processing" }).eq("id", broadcastId);

  const { data: targetRows, error: targetsError } = await supabase
    .from("group_broadcast_targets")
    .select("id, whatsapp_groups(external_id, name, zernio_conversation_id)")
    .eq("broadcast_id", broadcastId)
    .eq("status", "pending");

  if (targetsError) {
    await supabase.from("group_broadcasts").update({ status: "failed" }).eq("id", broadcastId);
    throw new Error(`Erreur lecture cibles pour diffusion ${broadcastId}: ${targetsError.message}`);
  }

  const targets = targetRows ?? [];
  if (targets.length === 0) {
    await supabase.from("group_broadcasts").update({ status: "completed" }).eq("id", broadcastId);
    return { sent: 0, failed: 0 };
  }

  const { data: productLinkRows } = await supabase
    .from("group_broadcast_products")
    .select("product_id")
    .eq("broadcast_id", broadcastId)
    .order("display_order", { ascending: true });

  const productIds = (productLinkRows ?? []).map((p) => p.product_id);
  const products = await getProductsByIds(organizationId, productIds);
  const productsById = new Map(products.map((p) => [p.id, p]));
  const orderedProducts = productIds
    .map((id) => productsById.get(id))
    .filter((p): p is CatalogProductSummary => Boolean(p));
  const messageContent = formatGroupBroadcastMessage(orderedProducts);

  let provider: Awaited<ReturnType<typeof getMessagingProvider>> | null = null;
  let providerError: string | null = null;
  try {
    provider = await getMessagingProvider(organizationId);
  } catch (err) {
    providerError = err instanceof Error ? err.message : String(err);
  }

  let sent = 0;
  let failed = 0;

  // Séquentiel PAR CIBLE au sein d'une même diffusion : throughput
  // suffisant à l'échelle d'une PME (quelques groupes), et évite de
  // heurter un éventuel rate-limit Zernio en parallélisant des appels sur
  // le MÊME accountId. Les diffusions de tenants différents, elles, sont
  // déjà traitées en parallèle par processScheduledBroadcasts.
  for (const target of targets) {
    const group = (
      target as unknown as {
        whatsapp_groups?: { external_id?: string; name?: string; zernio_conversation_id?: string | null };
      }
    ).whatsapp_groups;

    if (providerError || !provider) {
      await markTargetFailed(target.id, providerError ?? "Aucun provider de messagerie connecté.");
      failed++;
      continue;
    }

    if (!group?.zernio_conversation_id) {
      // NON FABRIQUÉ : CONFIRMÉ qu'il n'existe pas d'endpoint d'envoi "à
      // froid" vers un groupe côté Zernio — voir l'en-tête de ce fichier
      // et docs/ZERNIO_INTEGRATION.md.
      await markTargetFailed(
        target.id,
        "Diffusion indisponible pour ce groupe : aucune conversation Zernio n'est encore établie avec lui. " +
          "Zernio ne documente pas d'envoi initial vers un groupe — seule une réponse à un message déjà " +
          "reçu du groupe est possible pour l'instant.",
      );
      failed++;
      continue;
    }

    try {
      await provider.sendMessage(organizationId, {
        to: group.external_id ?? "",
        channel: "whatsapp",
        content: messageContent,
        externalThreadId: group.zernio_conversation_id,
      });
      await supabase
        .from("group_broadcast_targets")
        .update({ status: "sent", sent_at: new Date().toISOString(), error_message: null })
        .eq("id", target.id);
      sent++;
    } catch (err) {
      await markTargetFailed(target.id, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }

  const finalStatus = sent > 0 ? "completed" : "failed";
  await supabase.from("group_broadcasts").update({ status: finalStatus }).eq("id", broadcastId);

  // Best-effort — notifyOrgAdmins catche déjà ses propres erreurs en
  // interne (notification-service.ts), jamais bloquant pour le cron.
  await notifyOrgAdmins({
    organizationId,
    title:
      sent > 0 && failed === 0
        ? "Diffusion groupée envoyée"
        : sent > 0
          ? "Diffusion groupée partiellement envoyée"
          : "Diffusion groupée échouée",
    body: `${sent} groupe(s) atteint(s), ${failed} échec(s) sur ${targets.length} groupe(s) ciblé(s).`,
    relatedEntityType: "group_broadcast",
    relatedEntityId: broadcastId,
  });

  return { sent, failed };
}

/**
 * Point d'entrée cron (voir /api/cron/process-broadcasts). Traite toutes
 * les diffusions dues, TOUS TENANTS confondus (service-role, comme
 * admin-organizations-service.ts) — en parallèle entre diffusions
 * (tenants indépendants), jamais bloqué par l'échec d'une diffusion
 * isolée (Promise.allSettled).
 */
export async function processScheduledBroadcasts(): Promise<ProcessBroadcastsResult> {
  const supabase = getSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  const { data: dueBroadcasts, error } = await supabase
    .from("group_broadcasts")
    .select("id, organization_id")
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso);

  if (error) throw new Error(`Erreur lecture diffusions dues: ${error.message}`);
  const due = dueBroadcasts ?? [];
  if (due.length === 0) {
    return { processedBroadcasts: 0, sentTargets: 0, failedTargets: 0 };
  }

  const results = await Promise.allSettled(due.map((b) => processOneBroadcast(b.id, b.organization_id)));

  let sentTargets = 0;
  let failedTargets = 0;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      sentTargets += result.value.sent;
      failedTargets += result.value.failed;
    } else {
      console.error(`processScheduledBroadcasts: échec diffusion ${due[index]?.id}:`, result.reason);
    }
  });

  return { processedBroadcasts: due.length, sentTargets, failedTargets };
}
