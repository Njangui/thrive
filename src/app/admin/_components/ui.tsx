import type { ReactNode } from "react";
import { IconArrowDown, IconArrowUp } from "./icons";

/**
 * Primitives visuelles de la console Super Admin — voir la note en tête
 * de `globals.css` (namespace `adm-*`). Regroupées ici pour que les 9
 * pages `/admin/**` partagent EXACTEMENT le même rendu (carte, badge,
 * stat) plutôt que de réécrire les classes Tailwind à chaque page.
 */

export function AdminCard({ children, className = "", padding = "p-5" }: { children: ReactNode; className?: string; padding?: string }) {
  return <div className={`adm-card ${padding} ${className}`}>{children}</div>;
}

export function AdminSectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
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

export function AdminBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={BADGE_CLASS[tone]}>{children}</span>;
}

/**
 * Carte de statistique façon référence visuelle (chiffre en gros, libellé
 * discret au-dessus, delta optionnel en dessous). `trend` reste optionnel
 * et n'est affiché que si une valeur réelle est fournie par l'appelant —
 * jamais de delta fabriqué quand la donnée n'existe pas (ex : Vue globale
 * n'a pas de comparaison à la période précédente aujourd'hui).
 */
export function AdminStatCard({
  label,
  value,
  icon,
  trend,
  helpText,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  trend?: { direction: "up" | "down"; label: string } | null;
  helpText?: string;
}) {
  return (
    <AdminCard>
      <div className="flex items-start justify-between">
        <p className="adm-label">{label}</p>
        {icon ? <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600">{icon}</span> : null}
      </div>
      <p className="adm-value mt-2">{value}</p>
      {trend ? (
        <p className={`mt-1.5 flex items-center gap-1 text-xs font-semibold ${trend.direction === "up" ? "text-success-600" : "text-danger-600"}`}>
          {trend.direction === "up" ? <IconArrowUp className="h-3 w-3" /> : <IconArrowDown className="h-3 w-3" />}
          {trend.label}
        </p>
      ) : helpText ? (
        <p className="mt-1.5 text-xs adm-muted">{helpText}</p>
      ) : null}
    </AdminCard>
  );
}

export function AdminEmptyState({ children }: { children: ReactNode }) {
  return <p className="px-2 py-8 text-center text-sm adm-muted">{children}</p>;
}

export function AdminTableCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <AdminCard padding="p-0">
      <div className="flex items-center justify-between px-5 pt-5">
        <h2 className="adm-heading-2">{title}</h2>
        {action}
      </div>
      <div className="mt-3 overflow-x-auto pb-1">{children}</div>
    </AdminCard>
  );
}
