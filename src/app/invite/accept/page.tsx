import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";
import { acceptInvitation } from "@/application/services/team-service";
import { AppError } from "@/lib/errors";

/**
 * Hors `/dashboard` volontairement (cahier) : accessible avant d'avoir
 * rejoint une organisation. Le middleware (section tenant) n'impose
 * aucune contrainte de chemin — cette route fonctionne normalement sur le
 * domaine applicatif principal, comme /login et /onboarding.
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
        <p className="text-sm text-clay">Lien d&apos;invitation invalide (jeton manquant).</p>
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

  try {
    const result = await acceptInvitation(token, user.id);
    return (
      <Centered>
        <h1 className="font-display text-2xl font-bold tracking-tight">Bienvenue chez {result.organizationName} !</h1>
        <p className="mt-2 text-sm text-muted">Vous avez rejoint l&apos;équipe avec succès.</p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block rounded-brand bg-leaf px-5 py-3 text-sm font-medium text-white"
        >
          Aller au tableau de bord
        </Link>
      </Centered>
    );
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Impossible d'accepter cette invitation.";
    return (
      <Centered>
        <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{message}</p>
        <Link href="/dashboard" className="mt-4 inline-block text-sm text-leaf hover:underline">
          Aller au tableau de bord
        </Link>
      </Centered>
    );
  }
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-5 text-center">{children}</main>
  );
}
