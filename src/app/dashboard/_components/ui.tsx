import type { ReactNode } from "react";
import { IconArrowDown, IconArrowUp } from "@/app/_components/app-icons";
import type { TrendInfo } from "@/application/services/dashboard-service";

/**
 * Primitives visuelles du dashboard marchand (`/dashboard/*`) — miroir de
 * `admin/_components/ui.tsx`, consomme les MÊMES classes `adm-*`
 * partagées (voir la note d'en-tête de `globals.css`, chantier
 * d'unification design sept. 2026) pour que Super Admin et dashboard
 * marchand rendent EXACTEMENT pareil sans dupliquer la définition CSS.
 *
 * Seuls les composants React sont dupliqués ici plutôt qu'importés
 * depuis `admin/_components/ui.tsx` : décision volontaire pour garder le
 * dashboard marchand indépendant de la console Super Admin côté code
 * (pas de dépendance cross-module entre deux zones qui n'ont par
 * ailleurs rien en commun — permissions, données, cycle de vie), même si
 * elles partagent leur habillage visuel.
 */

export function DashCard({
  children,
  className = "",
  padding = "p-5",
}: {
  children: ReactNode;
  className?: string;
  padding?: string;
}) {
  return <div className={`adm-card ${padding} ${className}`}>{children}</div>;
}

/** Variante warning de `DashCard` — signaux "à surveiller" (produits en
 * rupture, conversations à traiter), jamais des échecs : voir
 * `.adm-card-alert` dans globals.css. */
export function DashCardAlert({
  children,
  className = "",
  padding = "p-4",
}: {
  children: ReactNode;
  className?: string;
  padding?: string;
}) {
  return <div className={`adm-card-alert ${padding} ${className}`}>{children}</div>;
}

export function DashSectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="adm-heading-1">{title}</h1>
        {description ? <p className="mt-1 text-sm adm-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

type BadgeTone = "success" | "warning" | "danger" | "neutral" | "violet";

const BADGE_CLASS: Record<BadgeTone, string> = {
  success: "adm-badge-success",
  warning: "adm-badge-warning",
  danger: "adm-badge-danger",
  neutral: "adm-badge-neutral",
  violet: "adm-badge-violet",
};

export function DashBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={BADGE_CLASS[tone]}>{children}</span>;
}

/** Carte de statistique (accueil dashboard) — réplique pixel par pixel
 * d'une référence fournie (sept. 2026) : libellé discret, chiffre en
 * gros, delta optionnel en dessous. `alert` bascule sur le traitement
 * warning de `DashCardAlert` (jamais un `trend` fabriqué quand la donnée
 * n'existe pas — voir `DashboardSummary.productsOutOfStock`, qui n'a
 * volontairement aucun delta). `trend` et `helpText` sont mutuellement
 * exclusifs : un seul est affiché, dans cet ordre de priorité. */
export function DashStatCard({
  label,
  value,
  alert = false,
  trend,
  helpText,
}: {
  label: string;
  value: string;
  alert?: boolean;
  trend?: TrendInfo | null;
  helpText?: string;
}) {
  if (alert) {
    return (
      <DashCardAlert>
        <p className="text-xs font-medium text-warning-700">{label}</p>
        <p className="mt-1 font-jakarta text-xl font-semibold text-warning-700">{value}</p>
        {helpText ? <p className="mt-1.5 text-xs text-warning-700/70">{helpText}</p> : null}
      </DashCardAlert>
    );
  }
  return (
    <DashCard>
      <p className="adm-label">{label}</p>
      <p className="adm-value mt-1">{value}</p>
      {trend ? (
        <p
          className={`mt-1.5 flex items-center gap-1 text-xs font-semibold ${
            trend.direction === "up" ? "text-success-600" : "text-danger-600"
          }`}
        >
          {trend.direction === "up" ? <IconArrowUp className="h-3 w-3" /> : <IconArrowDown className="h-3 w-3" />}
          {trend.percentLabel} <span className="font-normal adm-muted">vs période précédente</span>
        </p>
      ) : helpText ? (
        <p className="mt-1.5 text-xs adm-muted">{helpText}</p>
      ) : null}
    </DashCard>
  );
}

export function DashEmptyState({ children }: { children: ReactNode }) {
  return <p className="px-2 py-8 text-center text-sm adm-muted">{children}</p>;
}

export function DashTableCard({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <DashCard padding="p-0" className="overflow-hidden">
      {title ? (
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="adm-heading-2">{title}</h2>
          {action}
        </div>
      ) : null}
      <div className={title ? "mt-3 overflow-x-auto pb-1" : "overflow-x-auto"}>{children}</div>
    </DashCard>
  );
}
