import { redirect } from "next/navigation";
import { requireCurrentOrganization, requireMembership, type MemberRole } from "@/application/services/auth-service";
import {
  listMembers,
  listPendingInvitations,
  inviteMember,
  revokeInvitation,
  updateMemberRole,
  removeMember,
} from "@/application/services/team-service";
import { AppError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  manager: "Manager",
  sales: "Vente",
  cashier: "Caisse",
  employee: "Employé",
  accountant: "Comptable",
};

// Un Owner ne s'attribue jamais par invitation ni par changement de rôle
// depuis cet écran (team-service.ts::inviteMember le refuse déjà
// côté serveur — cette liste ne fait qu'éviter de proposer l'option dans
// le formulaire, la vraie barrière reste serveur).
const INVITABLE_ROLES: MemberRole[] = ["admin", "manager", "sales", "cashier", "employee", "accountant"];

function flashRedirect(kind: "success" | "error", message: string, extra?: Record<string, string>): never {
  const params = new URLSearchParams({ [kind]: message, ...extra });
  redirect(`/dashboard/team?${params.toString()}`);
}

async function inviteMemberAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);

  const email = String(formData.get("email") ?? "");
  const role = String(formData.get("role") ?? "") as MemberRole;

  try {
    const result = await inviteMember(organizationId, email, role, membership.userId);
    if (result.emailDelivered) {
      flashRedirect("success", `Invitation envoyée à ${email}.`);
    } else {
      // Email non transmis (clé absente, domaine Resend non vérifié...) —
      // le lien reste garanti, affiché pour un partage manuel plutôt que
      // de laisser croire qu'un email est parti (cahier V3, EmailProvider).
      flashRedirect(
        "error",
        `Invitation créée pour ${email}, mais l'email n'a pas pu être envoyé. Partagez ce lien manuellement :`,
        { inviteUrl: result.inviteUrl },
      );
    }
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'invitation.";
    flashRedirect("error", message);
  }
}

async function revokeInvitationAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin"]);

  const invitationId = String(formData.get("invitationId") ?? "");
  try {
    await revokeInvitation(organizationId, invitationId);
    flashRedirect("success", "Invitation révoquée.");
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la révocation.";
    flashRedirect("error", message);
  }
}

async function updateMemberRoleAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);

  const targetUserId = String(formData.get("targetUserId") ?? "");
  const newRole = String(formData.get("role") ?? "") as MemberRole;

  try {
    await updateMemberRole(organizationId, targetUserId, newRole, membership);
    flashRedirect("success", "Rôle mis à jour.");
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors du changement de rôle.";
    flashRedirect("error", message);
  }
}

async function removeMemberAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);

  const targetUserId = String(formData.get("targetUserId") ?? "");
  try {
    await removeMember(organizationId, targetUserId, membership);
    flashRedirect("success", "Membre retiré.");
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors du retrait.";
    flashRedirect("error", message);
  }
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string; inviteUrl?: string }>;
}) {
  const { success, error, inviteUrl } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();

  const [members, invitations] = await Promise.all([
    listMembers(organizationId),
    listPendingInvitations(organizationId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Équipe</h1>
        <p className="mt-1 text-sm text-muted">Invitez des collègues et gérez leurs accès.</p>
      </div>

      {success && <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">{success}</p>}
      {error && (
        <div className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">
          <p>{error}</p>
          {inviteUrl && (
            <input
              readOnly
              value={inviteUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-2 w-full rounded-brand border border-clay/20 bg-white px-3 py-2 text-xs text-ink"
            />
          )}
        </div>
      )}

      <section className="flex flex-col gap-3 rounded-brand border border-ink/10 bg-white p-4">
        <h2 className="font-display text-lg font-semibold">Membres ({members.length})</h2>
        <table className="w-full text-sm">
          <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-2 py-2">Email</th>
              <th className="px-2 py-2">Rôle</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className="border-b border-ink/5 last:border-0">
                <td className="px-2 py-2">{m.email ?? "—"}</td>
                <td className="px-2 py-2">
                  {m.role === "owner" ? (
                    <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs">{ROLE_LABELS.owner}</span>
                  ) : (
                    <form action={updateMemberRoleAction} className="flex items-center gap-2">
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="targetUserId" value={m.userId} />
                      <select name="role" defaultValue={m.role} className="rounded-brand border border-ink/15 px-2 py-1 text-xs">
                        {INVITABLE_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                      <SubmitButton pendingLabel="..." className="text-xs font-medium text-leaf hover:underline disabled:opacity-60">
                        Enregistrer
                      </SubmitButton>
                    </form>
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  {m.role !== "owner" && (
                    <form action={removeMemberAction}>
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="targetUserId" value={m.userId} />
                      <SubmitButton pendingLabel="..." className="text-xs font-medium text-clay hover:underline disabled:opacity-60">
                        Retirer
                      </SubmitButton>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-3 rounded-brand border border-ink/10 bg-white p-4">
        <h2 className="font-display text-lg font-semibold">Inviter quelqu&apos;un</h2>
        <form action={inviteMemberAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="organizationId" value={organizationId} />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase text-muted" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              name="email"
              required
              placeholder="collegue@entreprise.com"
              className="rounded-brand border border-ink/15 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase text-muted" htmlFor="role">Rôle</label>
            <select id="role" name="role" defaultValue="employee" className="rounded-brand border border-ink/15 px-3 py-2 text-sm">
              {INVITABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <SubmitButton pendingLabel="Envoi..." className="rounded-brand bg-leaf px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
            Envoyer l&apos;invitation
          </SubmitButton>
        </form>
      </section>

      {invitations.length > 0 && (
        <section className="flex flex-col gap-3 rounded-brand border border-ink/10 bg-white p-4">
          <h2 className="font-display text-lg font-semibold">Invitations en attente</h2>
          <table className="w-full text-sm">
            <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-2 py-2">Email</th>
                <th className="px-2 py-2">Rôle</th>
                <th className="px-2 py-2">Expire le</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-2 py-2">{inv.email}</td>
                  <td className="px-2 py-2">{ROLE_LABELS[inv.role]}</td>
                  <td className="px-2 py-2 text-muted">{new Date(inv.expiresAt).toLocaleDateString("fr-FR")}</td>
                  <td className="px-2 py-2 text-right">
                    <form action={revokeInvitationAction}>
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="invitationId" value={inv.id} />
                      <SubmitButton pendingLabel="..." className="text-xs font-medium text-clay hover:underline disabled:opacity-60">
                        Révoquer
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
