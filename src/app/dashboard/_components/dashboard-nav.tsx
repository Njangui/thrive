"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ModuleKey } from "@/application/config/modules";
import type { CreditStatus } from "@/application/services/ai-credits-service";
import { getIndustryUi } from "@/application/config/industry-ui";
import { CresyvaBrand } from "@/app/_components/cresyva-brand";
import {
  IconGrid,
  IconTag,
  IconBriefcase,
  IconBox,
  IconUsers,
  IconClock,
  IconChat,
  IconComment,
  IconGroupChat,
  IconMegaphone,
  IconPlug,
  IconGlobe,
  IconBot,
  IconBanknote,
  IconHelp,
  IconCard,
  IconPuzzle,
  IconLink,
  IconShield,
} from "@/app/_components/app-icons";

/**
 * Sidebar du dashboard marchand — habillage repris de `AdminSidebar`
 * (chantier d'unification design, sept. 2026) : mêmes classes
 * `adm-sidebar-link`/`adm-sidebar-link-active`/`adm-sidebar-group-label`,
 * même structure navy `#0F172A` + item actif violet `#00B98C`.
 *
 * Remplace l'ancienne nav horizontale plate de `layout.tsx` (17 liens
 * dans un `<header>`, illisible dès qu'on dépasse ~8 sections) par les 4
 * groupes ci-dessous — regroupement thématique nouveau (l'ancien
 * `NAV_ITEMS` était une liste plate), mais les 17 routes et leurs libellés
 * sont préservés à l'identique, rien n'est renommé ni retiré.
 *
 * `module` (optionnel par item) branche la nav sur le système de modules
 * PAR SECTEUR D'ACTIVITÉ qui existe déjà (`tenant_modules`/
 * `INDUSTRY_MODULE_PRESETS`, voir `application/config/modules.ts`) mais
 * n'était utilisé nulle part côté UI jusqu'ici : un item sans `module`
 * (Vue d'ensemble, Équipe, Abonnement, Add-ons) est un réglage de compte,
 * toujours visible ; un item avec `module` disparaît si ce module est
 * désactivé pour l'organisation — c'est le mécanisme "les sections
 * changent selon le domaine choisi à la création". `inventory`/
 * `analytics` n'ont pas de page dédiée : le stock vit dans Catalogue, pas
 * de gate séparé.
 */
export const DASHBOARD_NAV_GROUPS: {
  label: string | null;
  items: { href: string; label: string; icon: (p: { className?: string }) => JSX.Element; module?: ModuleKey }[];
}[] = [
  {
    label: null,
    items: [{ href: "/dashboard", label: "Vue d'ensemble", icon: IconGrid }],
  },
  {
    label: "Ventes",
    items: [
      { href: "/dashboard/products", label: "Catalogue", icon: IconTag, module: "catalog" },
      { href: "/dashboard/services", label: "Prestations", icon: IconBriefcase, module: "catalog" },
      { href: "/dashboard/orders", label: "Commandes", icon: IconBox, module: "orders" },
      { href: "/dashboard/leads", label: "Clients", icon: IconUsers, module: "crm" },
      { href: "/dashboard/appointments", label: "Rendez-vous", icon: IconClock, module: "appointments" },
    ],
  },
  {
    label: "Communication",
    items: [
      { href: "/dashboard/conversations", label: "Conversations", icon: IconChat, module: "whatsapp" },
      { href: "/dashboard/channels", label: "Canaux", icon: IconPlug, module: "whatsapp" },
      { href: "/dashboard/comments", label: "Commentaires", icon: IconComment, module: "marketing" },
      { href: "/dashboard/groups", label: "Groupes WhatsApp", icon: IconGroupChat, module: "whatsapp" },
      { href: "/dashboard/marketing", label: "Publications", icon: IconMegaphone, module: "marketing" },
      { href: "/dashboard/analytics", label: "Analytics réseaux", icon: IconGlobe, module: "marketing" },
    ],
  },
  {
    label: "Mon entreprise",
    items: [
      { href: "/dashboard/site", label: "Mon site", icon: IconGlobe, module: "landing" },
      { href: "/dashboard/ai", label: "Assistant IA", icon: IconBot, module: "ai" },
      { href: "/dashboard/finance", label: "Finance", icon: IconBanknote, module: "finance" },
      { href: "/dashboard/faq", label: "FAQ", icon: IconHelp, module: "faq" },
      { href: "/dashboard/team", label: "Équipe", icon: IconUsers },
    ],
  },
  {
    label: "Système",
    items: [
      { href: "/dashboard/subscription", label: "Mon abonnement", icon: IconCard },
      { href: "/dashboard/addons", label: "Add-ons", icon: IconPuzzle },
      { href: "/affiliate/dashboard", label: "Affiliation", icon: IconLink },
    ],
  },
];

export function isActive(pathname: string | null, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname?.startsWith(href) ?? false;
}

/** Groupes filtrés par modules activés, groupes devenus vides retirés
 * entièrement (jamais un titre "GESTION" affiché au-dessus de rien).
 *
 * `isPlatformAdmin` (optionnel) ajoute un dernier groupe "Plateforme" avec
 * le lien vers la console Super Admin (`/admin`) — jamais un `item` avec
 * `module` dans `DASHBOARD_NAV_GROUPS` (ça n'a rien à voir avec les
 * modules par secteur d'activité). Simple confort d'accès pour un compte
 * qui est À LA FOIS commerçant et admin plateforme : la vraie protection
 * de `/admin/*` reste `requirePlatformAdmin()` dans son propre layout —
 * masquer ce lien pour tout le monde d'autre n'est qu'un affichage
 * cohérent avec le choix déjà fait là-bas de ne jamais confirmer
 * l'existence de la console à qui n'y a pas droit (voir sa note). */
export function useVisibleNavGroups(enabledModules: ModuleKey[], industry?: string | null, isPlatformAdmin?: boolean) {
  const ui = getIndustryUi(industry);
  const groups = DASHBOARD_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items
      .filter((item) => !item.module || enabledModules.includes(item.module))
      .filter((item) => {
        if (item.href === "/dashboard/products") return !["beauty", "professional_services"].includes(ui.key);
        if (item.href === "/dashboard/services") return ["beauty", "professional_services"].includes(ui.key);
        return true;
      })
      .map((item) => {
        if (item.href === "/dashboard/products") return { ...item, label: ui.catalogLabel };
        if (item.href === "/dashboard/services") return { ...item, label: ui.catalogLabel };
        return item;
      }),
  })).filter((group) => group.items.length > 0);

  if (isPlatformAdmin) {
    groups.push({
      label: "Plateforme",
      items: [{ href: "/admin", label: "Console Admin", icon: IconShield }],
    });
  }

  return groups;
}

function CreditsWidget({ credits }: { credits: CreditStatus }) {
  if (credits.includedCredits === -1) return null;
  const pct = credits.includedCredits > 0 ? Math.min(100, Math.round((credits.usedCredits / credits.includedCredits) * 100)) : 0;
  return (
    <div className="mb-2 rounded-xl bg-white/5 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Crédits IA</p>
      <p className="mt-1 font-jakarta text-sm font-semibold text-white">
        {credits.usedCredits} / {credits.includedCredits} utilisés
      </p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${pct >= 90 ? "bg-warning-600" : "bg-violet-500"}`} style={{ width: `${pct}%` }} />
      </div>
      <Link href="/dashboard/subscription" className="mt-2 inline-block text-xs font-medium text-violet-300 hover:underline">
        Voir les détails
      </Link>
    </div>
  );
}

function UserCard({ displayName, roleLabel, initials }: { displayName: string; roleLabel: string; initials: string }) {
  return (
    <Link href="/dashboard/team" className="flex items-center gap-2.5 rounded-xl px-2 py-2 transition hover:bg-white/5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600 font-jakarta text-xs font-semibold text-white">
        {initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white">{displayName}</span>
        <span className="block truncate text-xs text-white/40">{roleLabel}</span>
      </span>
    </Link>
  );
}

export function DashboardSidebar({
  organizationName,
  enabledModules,
  credits,
  displayName,
  roleLabel,
  initials,
  industry,
  isPlatformAdmin,
}: {
  organizationName: string;
  enabledModules: ModuleKey[];
  credits: CreditStatus;
  displayName: string;
  roleLabel: string;
  initials: string;
  industry?: string | null;
  isPlatformAdmin?: boolean;
}) {
  const pathname = usePathname();
  const groups = useVisibleNavGroups(enabledModules, industry, isPlatformAdmin);

  return (
    <aside className="hidden w-[248px] shrink-0 flex-col bg-navy-900 px-3 py-5 lg:flex">
      <div className="mb-4 px-2 py-1.5">
        <CresyvaBrand href="/dashboard" compact dark />
        <p className="mt-2 max-w-[180px] truncate text-[11px] font-medium text-white/40">{organizationName}</p>
      </div>

      <nav className="flex-1 overflow-y-auto pb-2">
        {groups.map((group) => (
          <div key={group.label ?? "root"}>
            {group.label ? <p className="adm-sidebar-group-label">{group.label}</p> : null}
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link href={item.href} className={active ? "adm-sidebar-link-active" : "adm-sidebar-link"}>
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="mt-2 border-t border-white/5 pt-3">
        <CreditsWidget credits={credits} />
        <UserCard displayName={displayName} roleLabel={roleLabel} initials={initials} />
      </div>
    </aside>
  );
}
