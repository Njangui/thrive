import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import type { MemberRole } from "./auth-service";
import { normalizeExtraPermissions, type BackofficeActor, type BackofficeChannel } from "@/application/channels/actor";
import {
  LINK_CODE_TTL_MS,
  generateLinkCode,
  hashSecret,
  normalizeExternalId,
  normalizeLinkCode,
} from "@/application/channels/channel-codes";

/**
 * Identités de canal back-office (C2) : liaison, révocation, résolution.
 *
 * Toutes les requêtes utilisent service_role (un message Telegram/WhatsApp n'a
 * pas de session) : l'isolation entre tenants est donc garantie ICI, par des
 * filtres explicites sur organization_id / membership_id (principe 5), et par
 * les fonctions SQL SECURITY DEFINER qui re-vérifient le tenant. L'autorisation
 * « qui a le droit de demander cette opération » reste à la charge de
 * l'appelant authentifié (server action : requireMembership ; webhook : identité
 * résolue) — les fonctions exportées ici reçoivent des identifiants DÉJÀ
 * authentifiés, jamais du contenu de message.
 */

/** Statuts de tenant qui interdisent tout pilotage par chat. */
const BLOCKED_TENANT_STATUSES = new Set(["suspended", "cancelled"]);
const MAX_LINK_CODES_PER_HOUR = 5;
const ADMIN_ROLES: MemberRole[] = ["owner", "admin"];

type Db = SupabaseClient;

// ---------------------------------------------------------------------------
// Génération du code de liaison (dashboard connecté)
// ---------------------------------------------------------------------------

export type GenerateLinkCodeResult =
  | { ok: true; code: string; expiresAt: string }
  | { ok: false; reason: "membership_not_found" | "rate_limited" };

/**
 * `userId` / `organizationId` proviennent de `requireMembership` (session) : un
 * membre ne génère un code QUE pour lui-même. Le code en clair est renvoyé une
 * seule fois ; seul son SHA-256 est stocké.
 */
export async function generateChannelLinkCode(
  input: { organizationId: string; userId: string; channel: BackofficeChannel },
  db: Db = getSupabaseServiceClient(),
  now: () => number = () => Date.now(),
): Promise<GenerateLinkCodeResult> {
  const { data: membership, error: membershipError } = await db
    .from("memberships")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (membershipError) throw new Error(`Identités de canal: lecture du membership impossible: ${membershipError.message}`);
  if (!membership) return { ok: false, reason: "membership_not_found" };

  // Limite anti-abus : un code se génère au plus 5 fois par heure et par canal.
  const sinceIso = new Date(now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await db
    .from("channel_link_codes")
    .select("id", { count: "exact", head: true })
    .eq("membership_id", membership.id)
    .eq("channel", input.channel)
    .gte("created_at", sinceIso);
  if (countError) throw new Error(`Identités de canal: comptage des codes impossible: ${countError.message}`);
  if ((count ?? 0) >= MAX_LINK_CODES_PER_HOUR) return { ok: false, reason: "rate_limited" };

  // Un seul code actif à la fois : les précédents non consommés sont supprimés.
  const { error: purgeError } = await db
    .from("channel_link_codes")
    .delete()
    .eq("membership_id", membership.id)
    .eq("channel", input.channel)
    .is("consumed_at", null);
  if (purgeError) throw new Error(`Identités de canal: purge des anciens codes impossible: ${purgeError.message}`);

  const code = generateLinkCode();
  const expiresAt = new Date(now() + LINK_CODE_TTL_MS).toISOString();
  const { error } = await db.from("channel_link_codes").insert({
    organization_id: input.organizationId,
    membership_id: membership.id,
    channel: input.channel,
    code_hash: hashSecret(code),
    expires_at: expiresAt,
  });
  if (error) throw new Error(`Identités de canal: création du code impossible: ${error.message}`);

  return { ok: true, code, expiresAt };
}

// ---------------------------------------------------------------------------
// Consommation du code (`/start CODE`)
// ---------------------------------------------------------------------------

export type ConsumeLinkCodeResult =
  | { ok: true; identityId: string; organizationId: string; membershipId: string }
  | { ok: false; reason: "invalid_code" | "invalid_identifier" | "code_consumed" | "code_expired" | "identity_already_linked" };

/**
 * `externalId` vient du transport (id utilisateur Telegram du message signé par
 * le webhook), jamais du texte du message. Atomique côté SQL : un code ne sert
 * qu'une fois, même sous requêtes concurrentes.
 */
export async function consumeChannelLinkCode(
  input: { code: string; channel: BackofficeChannel; externalId: string | number; label?: string },
  db: Db = getSupabaseServiceClient(),
): Promise<ConsumeLinkCodeResult> {
  const normalizedCode = normalizeLinkCode(input.code);
  const externalId = normalizeExternalId(input.channel, input.externalId);
  if (!externalId) return { ok: false, reason: "invalid_identifier" };
  if (!normalizedCode) return { ok: false, reason: "invalid_code" };

  const { data, error } = await db.rpc("consume_channel_link_code", {
    p_code_hash: hashSecret(normalizedCode),
    p_channel: input.channel,
    p_external_id: externalId,
    p_label: input.label?.slice(0, 80) ?? null,
  });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("CODE_CONSUMED")) return { ok: false, reason: "code_consumed" };
    if (message.includes("CODE_EXPIRED")) return { ok: false, reason: "code_expired" };
    if (message.includes("IDENTITY_ALREADY_LINKED")) return { ok: false, reason: "identity_already_linked" };
    if (message.includes("CODE_INVALID")) return { ok: false, reason: "invalid_code" };
    throw new Error(`Identités de canal: liaison impossible: ${message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { id: string; organization_id: string; membership_id: string }
    | null;
  if (!row) throw new Error("Identités de canal: la fonction de liaison n'a rien renvoyé.");
  return { ok: true, identityId: row.id, organizationId: row.organization_id, membershipId: row.membership_id };
}

// ---------------------------------------------------------------------------
// Révocation
// ---------------------------------------------------------------------------

export type RevokeResult = { ok: true } | { ok: false; reason: "not_found" | "forbidden" };

/**
 * Révocation depuis le dashboard. `callerUserId` vient de la session. Autorisé :
 * owner/admin du tenant, ou le propriétaire de l'identité lui-même. Un tenant
 * ne peut JAMAIS révoquer l'identité d'un autre tenant : le filtre
 * `organization_id` est appliqué avant et dans la fonction SQL.
 */
export async function revokeChannelIdentity(
  input: { organizationId: string; identityId: string; callerUserId: string; reason?: string },
  db: Db = getSupabaseServiceClient(),
): Promise<RevokeResult> {
  const { data: identity, error } = await db
    .from("channel_identities")
    .select("id, user_id, status")
    .eq("id", input.identityId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (error) throw new Error(`Identités de canal: lecture impossible: ${error.message}`);
  if (!identity || identity.status === "revoked") return { ok: false, reason: "not_found" };

  if (identity.user_id !== input.callerUserId) {
    const { data: caller, error: callerError } = await db
      .from("memberships")
      .select("role")
      .eq("organization_id", input.organizationId)
      .eq("user_id", input.callerUserId)
      .maybeSingle();
    if (callerError) throw new Error(`Identités de canal: lecture du rôle impossible: ${callerError.message}`);
    if (!caller || !ADMIN_ROLES.includes(caller.role as MemberRole)) return { ok: false, reason: "forbidden" };
  }

  const { data: revoked, error: rpcError } = await db.rpc("revoke_channel_identity", {
    p_identity_id: input.identityId,
    p_organization_id: input.organizationId,
    p_revoked_by: input.callerUserId,
    p_reason: input.reason ?? "manual",
  });
  if (rpcError) throw new Error(`Identités de canal: révocation impossible: ${rpcError.message}`);
  return revoked ? { ok: true } : { ok: false, reason: "not_found" };
}

/**
 * Révocation par commande (`/deconnecter`) : l'expéditeur retire LUI-MÊME son
 * identité sur ce canal, dans tous les tenants où elle est liée. Renvoie le
 * nombre d'identités révoquées.
 */
export async function revokeOwnChannelIdentities(
  input: { channel: BackofficeChannel; externalId: string | number; reason?: string },
  db: Db = getSupabaseServiceClient(),
): Promise<number> {
  const externalId = normalizeExternalId(input.channel, input.externalId);
  if (!externalId) return 0;

  const { data, error } = await db
    .from("channel_identities")
    .select("id, organization_id, user_id")
    .eq("channel", input.channel)
    .eq("external_id", externalId)
    .in("status", ["active", "pending"]);
  if (error) throw new Error(`Identités de canal: lecture impossible: ${error.message}`);

  let revoked = 0;
  for (const row of data ?? []) {
    const { data: ok, error: rpcError } = await db.rpc("revoke_channel_identity", {
      p_identity_id: row.id,
      p_organization_id: row.organization_id,
      p_revoked_by: row.user_id,
      p_reason: input.reason ?? "self_command",
    });
    if (rpcError) throw new Error(`Identités de canal: révocation impossible: ${rpcError.message}`);
    if (ok) revoked += 1;
  }
  return revoked;
}

// ---------------------------------------------------------------------------
// Résolution identité -> acteur
// ---------------------------------------------------------------------------

export type ResolveActorResult =
  | { kind: "resolved"; actor: BackofficeActor; identityId: string }
  | { kind: "unknown" }
  /** Identité liée à PLUSIEURS tenants : l'appelant doit demander lequel (commande /org, étape 3). */
  | { kind: "ambiguous"; organizations: { organizationId: string; organizationName: string }[] }
  /** Identité connue mais tenant suspendu/résilié : aucun pilotage par chat. */
  | { kind: "tenant_inactive" };

interface IdentityRow {
  id: string;
  organization_id: string;
  membership_id: string;
  user_id: string;
  memberships: { role: MemberRole; extra_permissions: unknown } | { role: MemberRole; extra_permissions: unknown }[] | null;
  organizations: { status: string; name: string } | { status: string; name: string }[] | null;
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Point d'entrée UNIQUE message entrant -> acteur. Seules les identités
 * `active` résolvent (jamais `pending` ni `revoked`). Le rôle et les permissions
 * sont relus à CHAQUE message : un changement de rôle ou une révocation prend
 * effet immédiatement, sans cache.
 */
export async function resolveActor(
  input: { channel: BackofficeChannel; externalId: string | number; organizationId?: string },
  db: Db = getSupabaseServiceClient(),
): Promise<ResolveActorResult> {
  const externalId = normalizeExternalId(input.channel, input.externalId);
  if (!externalId) return { kind: "unknown" };

  let query = db
    .from("channel_identities")
    .select("id, organization_id, membership_id, user_id, memberships!inner(role, extra_permissions), organizations!inner(status, name)")
    .eq("channel", input.channel)
    .eq("external_id", externalId)
    .eq("status", "active");
  if (input.organizationId) query = query.eq("organization_id", input.organizationId);

  const { data, error } = await query;
  if (error) throw new Error(`Identités de canal: résolution impossible: ${error.message}`);

  const rows = ((data ?? []) as unknown as IdentityRow[]).flatMap((row) => {
    const membership = one(row.memberships);
    const organization = one(row.organizations);
    return membership && organization ? [{ row, membership, organization }] : [];
  });
  if (rows.length === 0) return { kind: "unknown" };

  const usable = rows.filter((r) => !BLOCKED_TENANT_STATUSES.has(r.organization.status));
  if (usable.length === 0) return { kind: "tenant_inactive" };
  if (usable.length > 1) {
    return {
      kind: "ambiguous",
      organizations: usable.map((r) => ({ organizationId: r.row.organization_id, organizationName: r.organization.name })),
    };
  }

  const { row, membership } = usable[0]!;
  // Best-effort : la fraîcheur de last_seen_at ne doit jamais bloquer un message.
  void Promise.resolve(db.from("channel_identities").update({ last_seen_at: new Date().toISOString() }).eq("id", row.id)).then(
    ({ error: seenError }) => {
      if (seenError) console.warn("[channel-identity] last_seen_at non mis à jour:", seenError.message);
    },
  );

  return {
    kind: "resolved",
    identityId: row.id,
    actor: {
      userId: row.user_id,
      tenantId: row.organization_id,
      membershipId: row.membership_id,
      role: membership.role,
      extraPermissions: normalizeExtraPermissions(membership.extra_permissions),
      channel: input.channel,
    },
  };
}

// ---------------------------------------------------------------------------
// Liste pour l'écran Sécurité
// ---------------------------------------------------------------------------

export interface ChannelIdentityListItem {
  id: string;
  channel: BackofficeChannel;
  label: string | null;
  linkedAt: string;
  lastSeenAt: string | null;
  mine: boolean;
  /** Renseigné uniquement pour les identités des AUTRES membres (vue owner/admin). */
  memberName: string | null;
}

/**
 * Identités actives visibles par l'appelant : les siennes toujours ; celles du
 * tenant entier seulement pour owner/admin. L'identifiant externe (numéro, id
 * Telegram) n'est jamais renvoyé : il n'a aucune utilité à l'écran.
 */
export async function listChannelIdentities(
  actor: { tenantId: string; userId: string; role: MemberRole },
  db: Db = getSupabaseServiceClient(),
): Promise<ChannelIdentityListItem[]> {
  const isAdmin = ADMIN_ROLES.includes(actor.role);
  let query = db
    .from("channel_identities")
    .select("id, channel, display_label, linked_at, last_seen_at, user_id")
    .eq("organization_id", actor.tenantId)
    .in("status", ["active", "pending"])
    .order("linked_at", { ascending: false });
  if (!isAdmin) query = query.eq("user_id", actor.userId);
  const { data, error } = await query;
  if (error) throw new Error(`Identités de canal: liste impossible: ${error.message}`);
  const rows = (data ?? []) as { id: string; channel: BackofficeChannel; display_label: string | null; linked_at: string; last_seen_at: string | null; user_id: string }[];

  const others = [...new Set(rows.filter((r) => r.user_id !== actor.userId).map((r) => r.user_id))];
  const names = new Map<string, string>();
  if (others.length > 0) {
    const { data: profiles, error: profileError } = await db.from("profiles").select("id, full_name").in("id", others);
    if (profileError) throw new Error(`Identités de canal: lecture des profils impossible: ${profileError.message}`);
    for (const p of (profiles ?? []) as { id: string; full_name: string | null }[]) if (p.full_name) names.set(p.id, p.full_name);
  }
  return rows.map((r) => ({
    id: r.id, channel: r.channel, label: r.display_label, linkedAt: r.linked_at, lastSeenAt: r.last_seen_at,
    mine: r.user_id === actor.userId,
    memberName: r.user_id === actor.userId ? null : (names.get(r.user_id) ?? "Membre"),
  }));
}
