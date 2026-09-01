import { redirect } from "next/navigation";
import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";
import { requireCurrentOrganization } from "@/application/services/auth-service";
import { getUnreadNotificationCount } from "@/application/services/notification-service";
import { getOnboardingStatus } from "@/application/services/onboarding-service";
import { getCreditStatus } from "@/application/services/ai-credits-service";
import { Sidebar } from "./_components/sidebar";
import { Topbar } from "./_components/topbar";

/**
 * Dérive un nom d'affichage depuis l'email — aucune colonne "nom complet"
 * n'existe dans le schéma actuel (ni sur `auth.users`, ni de table
 * `profiles` séparée), donc rien d'autre à afficher honnêtement ici.
 */
function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getSupabaseServerSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // V1 : un seul membership actif à la fois — pas de sélecteur
  // multi-entreprise (simplification volontaire, section 62 : ne pas
  // sur-engineer avant qu'un vrai besoin apparaisse). Redirige vers
  // /onboarding si aucune organisation.
  const currentOrg = await requireCurrentOrganization();

  // Lot I, Partie 2 : redirige aussi vers /onboarding si l'organisation
  // existe mais n'a jamais terminé le wizard (onboarding_completed_at
  // null) — /onboarding la reprendra à sa dernière étape persistée, jamais
  // à l'étape 1 (voir onboarding/page.tsx). Sans danger pour les
  // organisations créées avant ce lot : la migration 0025 les a
  // rétroactivement marquées "terminé" (voir son commentaire).
  const onboardingStatus = await getOnboardingStatus(currentOrg.organizationId);
  if (!onboardingStatus.completedAt) redirect("/onboarding");

  const [unreadCount, creditStatus] = await Promise.all([
    getUnreadNotificationCount(currentOrg.organizationId, user.id),
    getCreditStatus(currentOrg.organizationId),
  ]);

  const userName = displayNameFromEmail(user.email ?? "");

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar
        organizationName={currentOrg.organizationName}
        aiCreditsUsed={creditStatus.usedCredits}
        aiCreditsLimit={creditStatus.includedCredits === -1 ? 0 : creditStatus.includedCredits}
        userName={userName}
        userRole={currentOrg.role}
        userEmail={user.email ?? ""}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar unreadCount={unreadCount} userName={userName} userRole={currentOrg.role} />
        <main className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
