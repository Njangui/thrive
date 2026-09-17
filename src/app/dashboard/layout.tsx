import { redirect } from "next/navigation";
import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { requireCurrentOrganization } from "@/application/services/auth-service";
import { getUnreadNotificationCount } from "@/application/services/notification-service";
import { getOnboardingStatus } from "@/application/services/onboarding-service";
import { getEnabledModules } from "@/application/services/module-service";
import { getCreditStatus } from "@/application/services/ai-credits-service";
import { DashboardSidebar } from "./_components/dashboard-nav";
import { DashboardTopbar } from "./_components/topbar";
import { InstallAppBanner } from "./_components/install-app-banner";
import { ROLE_LABELS } from "./_components/role-labels";
import { DashboardHelp } from "./_components/dashboard-help";

/**
 * Coquille du dashboard marchand — sidebar navy + topbar, reprise de
 * `admin/layout.tsx` (chantier d'unification design, sept. 2026).
 * Remplace l'ancien `<header>` horizontal (17 liens à plat, illisible :
 * voir l'historique de ce fichier) par `DashboardSidebar`/
 * `DashboardTopbar`, sur `adm-shell` — même fond `#F8FAFC`, même police
 * que la console Super Admin et la landing.
 *
 * Toute la logique métier (auth, onboarding, garde-fous) est inchangée —
 * seul l'habillage visuel change. Ajoute la lecture des modules activés
 * (`getEnabledModules`) pour que la nav reflète le secteur d'activité
 * choisi à la création de l'entreprise, et du statut crédits IA pour le
 * widget de sidebar.
 */
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

  const [unreadCount, enabledModules, credits, profile, organization] = await Promise.all([
    getUnreadNotificationCount(currentOrg.organizationId, user.id),
    getEnabledModules(currentOrg.organizationId),
    getCreditStatus(currentOrg.organizationId),
    getSupabaseServiceClient().from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    getSupabaseServiceClient().from("organizations").select("industry").eq("id", currentOrg.organizationId).maybeSingle(),
  ]);

  // Aucun écran de ce projet n'écrit encore `profiles.full_name` (voir la
  // note de `landing-config-service.ts`) — reste `null` pour tout compte
  // réel aujourd'hui. Repli sur l'email plutôt qu'un nom inventé
  // ("Steve Doe" de la référence n'existe dans aucune donnée réelle ici).
  const displayName = profile.data?.full_name?.trim() || user.email || "Compte";
  const initials = displayName
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s: string) => s[0]?.toUpperCase())
    .join("") || "?";
  const roleLabel = ROLE_LABELS[currentOrg.role];

  return (
    <div className="adm-shell flex min-h-screen w-full min-w-0 overflow-x-clip">
      <DashboardSidebar
        organizationName={currentOrg.organizationName}
        enabledModules={enabledModules}
        credits={credits}
        displayName={displayName}
        roleLabel={roleLabel}
        initials={initials}
        industry={organization.data?.industry ?? null}
      />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <DashboardTopbar
          organizationName={currentOrg.organizationName}
          enabledModules={enabledModules}
          unreadCount={unreadCount}
          displayName={displayName}
          roleLabel={roleLabel}
          initials={initials}
          industry={organization.data?.industry ?? null}
        />
        <InstallAppBanner />
        <DashboardHelp />
        <main className="min-w-0 flex-1 overflow-x-clip px-3 py-5 sm:px-6 sm:py-8">
          <div className="mx-auto w-full max-w-7xl min-w-0">{children}</div>
        </main>
      </div>
    </div>
  );
}