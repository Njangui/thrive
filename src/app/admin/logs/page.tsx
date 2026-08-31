import Link from "next/link";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import {
  getRecentAuditLogs,
  listAuditLogFilterOptions,
} from "@/application/services/admin-observability-service";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR");
}

/**
 * `/admin/logs` (Lot H, Partie 3 — master prompt section 92). Même layout
 * que le reste de `/admin/*` (src/app/admin/layout.tsx tel quel),
 * `requirePlatformAdmin()` rappelée en tête de la page comme partout
 * ailleurs dans la console (même si le layout parent la vérifie déjà —
 * défense en profondeur documentée, voir admin/layout.tsx).
 *
 * Filtrage par `action`/`entity_type` en query param simple — un
 * `<select>` dans un `<form method="get">` classique, sans JS, cohérent
 * avec "pas de librairie de filtre" du cahier.
 */
export default async function AdminLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entityType?: string }>;
}) {
  const { action, entityType } = await searchParams;
  await requirePlatformAdmin();

  const [logs, filterOptions] = await Promise.all([
    getRecentAuditLogs(100, { action: action || undefined, entityType: entityType || undefined }),
    listAuditLogFilterOptions(),
  ]);

  const exportParams = new URLSearchParams();
  if (action) exportParams.set("action", action);
  if (entityType) exportParams.set("entityType", entityType);
  const exportHref = `/admin/logs/export${exportParams.toString() ? `?${exportParams.toString()}` : ""}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight">Journal d&apos;activité</h1>
        <Link
          href={exportHref}
          className="rounded-brand border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink hover:bg-ink/5"
        >
          Exporter en CSV
        </Link>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-brand border border-ink/10 bg-white p-4"
      >
        <label className="flex flex-col gap-1 text-xs text-muted">
          Action
          <select
            name="action"
            defaultValue={action ?? ""}
            className="rounded-brand border border-ink/15 px-3 py-2 text-sm text-ink"
          >
            <option value="">Toutes</option>
            {filterOptions.actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          Type d&apos;entité
          <select
            name="entityType"
            defaultValue={entityType ?? ""}
            className="rounded-brand border border-ink/15 px-3 py-2 text-sm text-ink"
          >
            <option value="">Tous</option>
            {filterOptions.entityTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <button type="submit" className="rounded-brand bg-ink px-4 py-2 text-sm font-medium text-white">
          Filtrer
        </button>

        {(action || entityType) && (
          <Link href="/admin/logs" className="text-xs text-muted underline">
            Réinitialiser
          </Link>
        )}
      </form>

      <div className="overflow-x-auto rounded-brand border border-ink/10 bg-white">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-ink/10 text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Entreprise</th>
              <th className="px-4 py-2 font-medium">Action</th>
              <th className="px-4 py-2 font-medium">Entité</th>
              <th className="px-4 py-2 font-medium">Acteur</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b border-ink/5 last:border-0">
                <td className="whitespace-nowrap px-4 py-2 text-muted">{formatDate(log.createdAt)}</td>
                <td className="px-4 py-2 text-ink">{log.organizationName ?? "—"}</td>
                <td className="px-4 py-2 font-medium text-ink">{log.action}</td>
                <td className="px-4 py-2 text-muted">{log.entityType ?? "—"}</td>
                <td className="px-4 py-2 text-muted">{log.actorUserId ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {logs.length === 0 && (
          <p className="p-6 text-sm text-muted">Aucune activité pour ces filtres.</p>
        )}
      </div>
    </div>
  );
}
