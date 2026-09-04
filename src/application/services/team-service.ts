import { randomBytes } from "node:crypto";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getEmailProvider } from "@/infrastructure/providers/registry";
import type { CurrentMembership, MemberRole } from "./auth-service";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";
import { env } from "@/lib/env";

/**
 * Lot L, Partie 1 — Gestion d'équipe. `requireMembership(organizationId,
 * ["owner","admin"])` est vérifié par l'appelant (Server Action, voir
 * app/dashboard/team/page.tsx) avant d'invoquer ces fonctions — même
 * convention que le reste du projet (ex: whatsapp-group-service.ts,
 * Lot F) plutôt qu'une double vérification dupliquée ici. Les fonctions
 * qui touchent un membre CIBLE (updateMemberRole/removeMember) vérifient
 * en plus, elles, une règle que le rôle du SEUL appelant ne peut pas
 * exprimer : "un Admin ne peut jamais toucher un Owner" — ça nécessite de
 * lire le rôle de la cible en base, donc ça vit ici et pas dans l'action.
 */

const INVITATION_TTL_HOURS = 72;

export interface TeamMember {
  userId: string;
  role: MemberRole;
  /** Résolu via Supabase Auth Admin — peut être `null` si l'API échoue (ne bloque jamais l'affichage du reste de l'équipe). */
  email: string | null;
  joinedAt: string;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: MemberRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
}

export interface InviteMemberResult {
  invitationId: string;
  inviteUrl: string;
  /** false si l'email n'a pas pu être transmis (clé absente, domaine Resend non vérifié...) — le lien reste valide et doit être affiché/partagé manuellement dans ce cas. */
  emailDelivered: boolean;
  emailError: string | null;
}

function generateInvitationToken(): string {
  // 256 bits d'entropie — cahier, section "Sécurité" : un
  // crypto.randomUUID() seul (122 bits utiles) est jugé insuffisant pour
  // un lien capacitaire à durée de vie de plusieurs jours.
  return randomBytes(32).toString("hex");
}

function buildInviteUrl(token: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/invite/accept?token=${token}`;
}

function buildInvitationEmailHtml(organizationName: string, inviteUrl: string, role: MemberRole): string {
  const roleLabel: Record<MemberRole, string> = {
    owner: "Propriétaire",
    admin: "Administrateur",
    manager: "Manager",
    sales: "Vente",
    cashier: "Caisse",
    employee: "Employé",
    accountant: "Comptable",
  };
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Vous êtes invité(e) à rejoindre ${organizationName}</h2>
      <p>Vous avez été invité(e) à rejoindre <strong>${organizationName}</strong> sur SME-OS, avec le rôle <strong>${roleLabel[role]}</strong>.</p>
      <p><a href="${inviteUrl}" style="display:inline-block;padding:12px 20px;background:#2f6b4f;color:#fff;text-decoration:none;border-radius:8px;">Rejoindre l'équipe</a></p>
      <p style="color:#666;font-size:13px;">Ce lien expire dans ${INVITATION_TTL_HOURS / 24} jours. Si vous n'attendiez pas cette invitation, ignorez cet email.</p>
    </div>
  `.trim();
}

/**
 * Crée l'invitation en base ET tente l'envoi de l'email — mais l'échec de
 * l'email ne fait JAMAIS échouer l'invitation elle-même (cahier V3 :
 * "livrez quelque chose qui marche de bout en bout" — le lien
 * d'invitation, affiché dans le dashboard, reste le chemin garanti même
 * si Resend est mal configuré ou son domaine expéditeur non vérifié).
 */
export async function inviteMember(
  organizationId: string,
  email: string,
  role: MemberRole,
  actorUserId: string,
): Promise<InviteMemberResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new ValidationError("Adresse email invalide.");
  }
  // Un Owner ne se crée jamais par invitation, seulement à la création de
  // l'organisation (onboarding-service.ts) — évite qu'un Admin s'auto-
  // élève en s'invitant lui-même comme Owner via un champ de formulaire.
  if (role === "owner") {
    throw new ValidationError("Le rôle Propriétaire ne peut pas être attribué par invitation.");
  }

  const supabase = getSupabaseServiceClient();

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .single();
  if (orgError || !org) throw new NotFoundError("Organisation introuvable.");

  // Une seule invitation "pending" à la fois par (org, email) — on
  // révoque l'ancienne plutôt que d'empiler des doublons ou d'échouer sur
  // la contrainte d'unicité partielle (0033_team_invitations.sql).
  const { data: existing } = await supabase
    .from("team_invitations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("email", normalizedEmail)
    .eq("status", "pending")
    .maybeSingle();
  if (existing) {
    await supabase.from("team_invitations").update({ status: "revoked" }).eq("id", existing.id);
  }

  const token = generateInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 3600_000).toISOString();

  const { data: invitation, error: insertError } = await supabase
    .from("team_invitations")
    .insert({
      organization_id: organizationId,
      email: normalizedEmail,
      role,
      invited_by: actorUserId,
      token,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (insertError || !invitation) {
    throw new Error(`Impossible de créer l'invitation: ${insertError?.message}`);
  }

  const inviteUrl = buildInviteUrl(token);
  let emailDelivered = false;
  let emailError: string | null = null;

  try {
    const emailProvider = await getEmailProvider();
    const result = await emailProvider.sendEmail({
      to: normalizedEmail,
      subject: `Invitation à rejoindre ${org.name} sur SME-OS`,
      html: buildInvitationEmailHtml(org.name, inviteUrl, role),
    });
    emailDelivered = result.delivered;
  } catch (err) {
    emailError = err instanceof Error ? err.message : String(err);
    console.error(`inviteMember: envoi email échoué pour ${normalizedEmail}:`, emailError);
  }

  return { invitationId: invitation.id, inviteUrl, emailDelivered, emailError };
}

/**
 * Revérifie l'expiration/statut à CET appel précis (cahier, section
 * "Sécurité" : "jamais une seule fois") — jamais une valeur mise en cache
 * d'un contrôle précédent.
 */
export async function acceptInvitation(
  token: string,
  userId: string,
): Promise<{ organizationId: string; organizationName: string }> {
  const supabase = getSupabaseServiceClient();

  const { data: invitation, error } = await supabase
    .from("team_invitations")
    .select("id, organization_id, role, status, expires_at, organizations(name)")
    .eq("token", token)
    .maybeSingle();

  if (error) throw new Error(`Erreur lecture invitation: ${error.message}`);
  if (!invitation) throw new NotFoundError("Invitation introuvable ou lien invalide.");

  if (invitation.status === "accepted") {
    throw new ValidationError("Cette invitation a déjà été acceptée.");
  }
  if (invitation.status === "revoked") {
    throw new ValidationError("Cette invitation a été révoquée.");
  }
  const isExpired = new Date(invitation.expires_at).getTime() < Date.now();
  if (invitation.status === "expired" || isExpired) {
    if (invitation.status !== "expired") {
      await supabase.from("team_invitations").update({ status: "expired" }).eq("id", invitation.id);
    }
    throw new ValidationError(
      "Cette invitation a expiré. Demandez à un administrateur de vous en envoyer une nouvelle.",
    );
  }

  // Idempotent (double clic, lien rouvert après acceptation manuelle déjà
  // en base) : upsert plutôt qu'insert, jamais d'erreur de contrainte
  // unique (organization_id, user_id) qui remonterait au client.
  const { error: upsertError } = await supabase
    .from("memberships")
    .upsert(
      { organization_id: invitation.organization_id, user_id: userId, role: invitation.role },
      { onConflict: "organization_id,user_id" },
    );
  if (upsertError) throw new Error(`Impossible de finaliser l'adhésion: ${upsertError.message}`);

  await supabase.from("team_invitations").update({ status: "accepted" }).eq("id", invitation.id);

  return {
    organizationId: invitation.organization_id,
    organizationName: (invitation as unknown as { organizations?: { name?: string } }).organizations?.name ?? "",
  };
}

export async function listMembers(organizationId: string): Promise<TeamMember[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, role, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Erreur lecture des membres: ${error.message}`);
  const rows = data ?? [];

  // Équipe d'une PME : quelques membres tout au plus (contrairement aux
  // listes paginées produits/leads/commandes) — Promise.all sur l'API
  // Admin Supabase (pas de "getUsersByIds" en masse disponible) reste
  // largement raisonnable ici, jamais un vrai risque de N+1 à l'échelle.
  const withEmails = await Promise.all(
    rows.map(async (row) => {
      const { data: userData } = await supabase.auth.admin.getUserById(row.user_id);
      return {
        userId: row.user_id,
        role: row.role as MemberRole,
        email: userData?.user?.email ?? null,
        joinedAt: row.created_at as string,
      };
    }),
  );
  return withEmails;
}

export async function listPendingInvitations(organizationId: string): Promise<PendingInvitation[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("team_invitations")
    .select("id, email, role, status, expires_at, created_at")
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Erreur lecture des invitations: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role as MemberRole,
    status: row.status as PendingInvitation["status"],
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

export async function revokeInvitation(organizationId: string, invitationId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("team_invitations")
    .update({ status: "revoked" })
    .eq("organization_id", organizationId)
    .eq("id", invitationId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Erreur révocation invitation: ${error.message}`);
  if (!data) throw new NotFoundError("Invitation introuvable ou déjà traitée.");
}

async function countOwners(organizationId: string): Promise<number> {
  const supabase = getSupabaseServiceClient();
  const { count } = await supabase
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("role", "owner");
  return count ?? 0;
}

async function getTargetMembership(
  organizationId: string,
  targetUserId: string,
): Promise<{ role: MemberRole } | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (error) throw new Error(`Erreur lecture du membre: ${error.message}`);
  return data as { role: MemberRole } | null;
}

/**
 * `actor` = la CurrentMembership de l'appelant, déjà résolue par
 * `requireMembership` côté Server Action — évite une relecture DB
 * redondante ici pour juste connaître son propre rôle.
 */
export async function updateMemberRole(
  organizationId: string,
  targetUserId: string,
  newRole: MemberRole,
  actor: CurrentMembership,
): Promise<void> {
  const target = await getTargetMembership(organizationId, targetUserId);
  if (!target) throw new NotFoundError("Membre introuvable.");

  if (target.role === "owner" && actor.role !== "owner") {
    throw new AuthorizationError("Un Propriétaire ne peut être modifié que par un autre Propriétaire.");
  }
  if (target.role === "owner" && newRole !== "owner" && (await countOwners(organizationId)) <= 1) {
    throw new ValidationError("Impossible : il doit rester au moins un Propriétaire dans l'organisation.");
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("memberships")
    .update({ role: newRole })
    .eq("organization_id", organizationId)
    .eq("user_id", targetUserId);
  if (error) throw new Error(`Impossible de changer le rôle: ${error.message}`);
}

export async function removeMember(
  organizationId: string,
  targetUserId: string,
  actor: CurrentMembership,
): Promise<void> {
  const target = await getTargetMembership(organizationId, targetUserId);
  if (!target) throw new NotFoundError("Membre introuvable.");

  if (target.role === "owner" && actor.role !== "owner") {
    throw new AuthorizationError("Un Propriétaire ne peut être retiré que par un autre Propriétaire.");
  }
  if (target.role === "owner" && (await countOwners(organizationId)) <= 1) {
    throw new ValidationError("Impossible de retirer le dernier Propriétaire de l'organisation.");
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("memberships")
    .delete()
    .eq("organization_id", organizationId)
    .eq("user_id", targetUserId);
  if (error) throw new Error(`Impossible de retirer ce membre: ${error.message}`);
}
