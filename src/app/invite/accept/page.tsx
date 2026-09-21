import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";
import { acceptInvitation } from "@/application/services/team-service";
import { AppError } from "@/lib/errors";
import { SignOutButton } from "@/app/_components/sign-out-button";

/**
 * Hors `/dashboard` volontairement (cahier) : accessible avant d'avoir
 * rejoint une organisation. Le middleware (section tenant) n'impose
 * aucune contrainte de chemin — cette route fonctionne normalement sur le
 * domaine applicatif principal, comme /login et /onboarding.
 *
 * Habillage repris en violet/navy (chantier d'unification design, sept.
 * 2026), même traitement carte centrée que `/login`.
 */
export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <Centered>
        <p className="adm-alert-danger">Lien d&apos;invitation invalide (jeton manquant).</p>
      </Centered>
    );
  }

  const supabase = await getSupabaseServerSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Préserve le token à travers /login -> magic link -> /auth/callback.
    redirect(`/login?next=${encodeURIComponent(`/invite/accept?token=${token}`)}`);
  }

  let result: Awaited<ReturnType<typeof acceptInvitation>> | null = null;
  let failureMessage = "Impossible d'accepter cette invitation.";
  try {
    result = await acceptInvitation(token, user.id, user.email ?? null);
  } catch (error) {
    if (error instanceof AppError) failureMessage = error.message;
  }

  if (result) {
    return (
      <Centered>
        <h1 className="font-jakarta text-2xl font-bold tracking-tight text-navy-900">
          Bienvenue chez {result.organizationName} !
        </h1>
        <p className="mt-2 text-sm adm-muted">Vous avez rejoint l&apos;équipe avec succès.</p>
        <Link href="/dashboard" className="adm-btn-primary mt-6 inline-flex">
          Aller au tableau de bord
        </Link>
      </Centered>
    );
  }

  return (
    <Centered>
      <p className="adm-alert-danger">{failureMessage}</p>
      {/* Repasse sécurité P0 (section 7) : le cas le plus probable pour
          arriver ici est un email de session qui ne correspond pas à
          l'email invité — proposer de se déconnecter puis de se
          reconnecter directement sur cette même invitation, sinon
          l'utilisateur reste bloqué dans son compte actuel sans savoir
          comment repartir se connecter avec la bonne adresse. */}
      <SignOutButton
        className="mt-4 inline-block text-sm text-violet-600 hover:underline"
        redirectTo={`/login?next=${encodeURIComponent(`/invite/accept?token=${token}`)}`}
      />
      <Link href="/dashboard" className="mt-2 block text-sm adm-muted hover:underline">
        Aller au tableau de bord
      </Link>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="adm-shell flex min-h-screen flex-col items-center justify-center px-5 py-10 text-center">
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600 font-jakarta text-lg font-bold text-white">
          S
        </span>
        <div className="adm-card flex w-full flex-col items-center gap-1">{children}</div>
      </div>
    </main>
  );
}
